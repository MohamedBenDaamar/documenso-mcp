import { z } from "zod";

const ConfigSchema = z.object({
  DOCUMENSO_URL: z
    .url({ protocol: /^https?$/ })
    .transform((url) => url.replace(/\/+$/, "")),
  DOCUMENSO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
});

export type Config = {
  documensoUrl: string;
  documensoTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);

  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid configuration: ${fields}. See .env.example.`);
  }

  return {
    documensoUrl: parsed.data.DOCUMENSO_URL,
    documensoTimeoutMs: parsed.data.DOCUMENSO_TIMEOUT_MS,
  };
}
