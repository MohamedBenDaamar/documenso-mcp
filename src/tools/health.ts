import type { MCPServer } from "mcp-use";
import { z } from "zod";

import type { DocumensoClient } from "../documenso/client.js";
import { DocumensoError } from "../documenso/errors.js";

const CheckStatusSchema = z.enum(["ok", "warning", "error", "unreachable"]);

export const HealthOutputSchema = z.object({
  server: z.object({ name: z.string(), version: z.string() }),
  documenso: z.object({
    status: CheckStatusSchema.describe("Overall Documenso status, or unreachable if it did not answer."),
    database: CheckStatusSchema,
    signingCertificate: CheckStatusSchema,
    latencyMs: z.number().int().nullable(),
  }),
});

export type HealthOutput = z.infer<typeof HealthOutputSchema>;

type HealthToolOptions = {
  client: DocumensoClient;
  serverInfo: { name: string; version: string };
};

export async function checkHealth(
  { client, serverInfo }: HealthToolOptions,
  signal?: AbortSignal,
): Promise<HealthOutput> {
  try {
    const health = await client.getHealth(signal);

    return {
      server: serverInfo,
      documenso: {
        status: health.status,
        database: health.checks.database.status,
        signingCertificate: health.checks.certificate.status,
        latencyMs: health.latencyMs,
      },
    };
  } catch (error) {
    if (!(error instanceof DocumensoError)) {
      throw error;
    }

    return {
      server: serverInfo,
      documenso: {
        status: "unreachable",
        database: "unreachable",
        signingCertificate: "unreachable",
        latencyMs: null,
      },
    };
  }
}

export function summarizeHealth(health: HealthOutput): string {
  const { documenso, server } = health;

  if (documenso.status === "unreachable") {
    return `${server.name} ${server.version} is running, but Documenso is not reachable.`;
  }

  return (
    `${server.name} ${server.version} is running. Documenso status: ${documenso.status} ` +
    `(database ${documenso.database}, signing certificate ${documenso.signingCertificate}, ${documenso.latencyMs} ms).`
  );
}

export function registerHealthTool(server: MCPServer, options: HealthToolOptions) {
  return server.tool(
    {
      name: "documenso-health",
      title: "Check Documenso connection",
      description:
        "Check that this MCP server is running and that the Documenso instance behind it is reachable and healthy. " +
        "Does not require a Documenso connection and returns no team data.",
      inputSchema: z.object({}),
      outputSchema: HealthOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (_input, ctx) => {
      const health = await checkHealth(options, ctx.signal);

      return {
        content: [{ type: "text", text: summarizeHealth(health) }],
        structuredContent: health,
      };
    },
  );
}
