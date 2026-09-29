import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const BASE_ENV = { DOCUMENSO_URL: "http://localhost:3000/" };

describe("loadConfig", () => {
  it("reads the environment, strips trailing slashes and applies defaults", () => {
    expect(loadConfig(BASE_ENV)).toEqual({ documensoUrl: "http://localhost:3000", documensoTimeoutMs: 10000 });
  });

  it("names invalid variables without echoing their values", () => {
    expect(() => loadConfig({})).toThrow("DOCUMENSO_URL");
    expect(() => loadConfig({ DOCUMENSO_URL: "file:///etc/passwd" })).toThrow(
      /^Invalid configuration: DOCUMENSO_URL\. See \.env\.example\.$/,
    );
  });

  it("requires public https URLs in production", () => {
    const production = { NODE_ENV: "production", DOCUMENSO_URL: "https://sign.example.com" };

    expect(() => loadConfig(production)).toThrow("MCP_URL");
    expect(() => loadConfig({ ...production, MCP_URL: "http://mcp.example.com" })).toThrow("MCP_URL");
    expect(() => loadConfig({ ...production, MCP_URL: "https://mcp.example.com", DOCUMENSO_URL: "http://sign.example.com" })).toThrow(
      "DOCUMENSO_URL",
    );
    expect(loadConfig({ ...production, MCP_URL: "https://mcp.example.com" }).documensoUrl).toBe("https://sign.example.com");
  });

  it("rejects an out-of-range timeout", () => {
    expect(() => loadConfig({ ...BASE_ENV, DOCUMENSO_TIMEOUT_MS: "5" })).toThrow("DOCUMENSO_TIMEOUT_MS");
  });
});
