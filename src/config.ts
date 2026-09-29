import { z } from "zod";

const httpUrl = z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, ""));

const ConfigSchema = z
  .object({
    DOCUMENSO_URL: httpUrl,
    DOCUMENSO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
    MCP_URL: z.preprocess((value) => (value === "" ? undefined : value), httpUrl.optional()),
    NODE_ENV: z.string().optional(),
  })
  // Deployed servers must know their public HTTPS origin: it is the OAuth resource that Documenso issues
  // tokens for, and Documenso only accepts https resources (or localhost).
  .refine((env) => env.NODE_ENV !== "production" || env.MCP_URL?.startsWith("https://"), {
    path: ["MCP_URL"],
    message: "MCP_URL must be the public https:// origin in production",
  })
  // Documenso is the authorization server, and the user's browser is sent to it to sign in.
  .refine((env) => env.NODE_ENV !== "production" || env.DOCUMENSO_URL.startsWith("https://"), {
    path: ["DOCUMENSO_URL"],
    message: "DOCUMENSO_URL must be https in production",
  });

export type Config = {
  /** Public URL of the Documenso instance. It is also the OAuth issuer, so it must match Documenso's own URL. */
  documensoUrl: string;
  documensoTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    throw new Error(`Invalid configuration: ${fields}. See .env.example.`);
  }

  return {
    documensoUrl: parsed.data.DOCUMENSO_URL,
    documensoTimeoutMs: parsed.data.DOCUMENSO_TIMEOUT_MS,
  };
}
