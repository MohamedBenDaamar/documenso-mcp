import { z } from "zod";

const optional = (schema: z.ZodString) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), schema.optional());

const httpUrl = z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, ""));

const ConfigSchema = z
  .object({
    DOCUMENSO_URL: httpUrl,
    DOCUMENSO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
    MCP_URL: z.preprocess((value) => (value === "" ? undefined : value), httpUrl.optional()),
    PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    NODE_ENV: z.string().optional(),
    SUPABASE_URL: z.preprocess((value) => (value === "" ? undefined : value), httpUrl.optional()),
    SUPABASE_PROJECT_ID: optional(z.string().regex(/^[a-z0-9]{20}$/)),
    SUPABASE_PUBLISHABLE_KEY: z.string().startsWith("sb_publishable_"),
    CONNECTION_ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  })
  .refine((env) => env.SUPABASE_URL !== undefined || env.SUPABASE_PROJECT_ID !== undefined, {
    path: ["SUPABASE_URL"],
    message: "Set SUPABASE_URL or SUPABASE_PROJECT_ID",
  })
  // Deployed servers must know their public HTTPS origin: it is the OAuth resource, the origin form posts
  // are checked against, and it decides whether cookies are Secure.
  .refine((env) => env.NODE_ENV !== "production" || env.MCP_URL?.startsWith("https://"), {
    path: ["MCP_URL"],
    message: "MCP_URL must be the public https:// origin in production",
  });

export type Config = {
  documensoUrl: string;
  documensoTimeoutMs: number;
  /** Public origin of this server, used in links shown to users. */
  publicUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  connectionEncryptionKey: Buffer;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    throw new Error(`Invalid configuration: ${fields}. See .env.example.`);
  }

  const data = parsed.data;

  return {
    documensoUrl: data.DOCUMENSO_URL,
    documensoTimeoutMs: data.DOCUMENSO_TIMEOUT_MS,
    publicUrl: data.MCP_URL ?? `http://localhost:${data.PORT}`,
    supabaseUrl: data.SUPABASE_URL ?? `https://${data.SUPABASE_PROJECT_ID}.supabase.co`,
    supabasePublishableKey: data.SUPABASE_PUBLISHABLE_KEY,
    connectionEncryptionKey: Buffer.from(data.CONNECTION_ENCRYPTION_KEY, "base64"),
  };
}
