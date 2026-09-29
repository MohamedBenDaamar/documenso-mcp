import { describe, expect, it } from "vitest";

import type { DocumensoClient } from "../src/documenso/client.js";
import { DocumensoError } from "../src/documenso/errors.js";
import { checkHealth, HealthOutputSchema, summarizeHealth } from "../src/tools/health.js";

const serverInfo = { name: "documenso-mcp", version: "0.1.0" };

function clientReturning(getHealth: DocumensoClient["getHealth"]): DocumensoClient {
  return {
    getHealth,
    request: async () => {
      throw new Error("not used");
    },
  };
}

describe("documenso-health", () => {
  it("returns output that matches the declared output schema", async () => {
    const health = await checkHealth({
      serverInfo,
      client: clientReturning(async () => ({
        status: "ok",
        checks: { database: { status: "ok" }, certificate: { status: "warning" } },
        latencyMs: 12,
      })),
    });

    expect(HealthOutputSchema.parse(health)).toEqual(health);
    expect(health.documenso).toEqual({ status: "ok", database: "ok", signingCertificate: "warning", latencyMs: 12 });
    expect(summarizeHealth(health)).toContain("Documenso status: ok");
  });

  it("reports unreachable instead of failing when Documenso is down", async () => {
    const health = await checkHealth({
      serverInfo,
      client: clientReturning(async () => {
        throw new DocumensoError("unavailable");
      }),
    });

    expect(HealthOutputSchema.parse(health).documenso.status).toBe("unreachable");
    expect(summarizeHealth(health)).toBe("documenso-mcp 0.1.0 is running, but Documenso is not reachable.");
  });
});
