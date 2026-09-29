import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const KEY = randomBytes(32).toString("base64");

const BASE_ENV = {
  DOCUMENSO_URL: "http://localhost:3000/",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  CONNECTION_ENCRYPTION_KEY: KEY,
};

describe("loadConfig", () => {
  it("reads the environment, strips trailing slashes and applies defaults", () => {
    expect(loadConfig(BASE_ENV)).toEqual({
      documensoUrl: "http://localhost:3000",
      documensoTimeoutMs: 10000,
      publicUrl: "http://localhost:3100",
      supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
      supabasePublishableKey: "sb_publishable_example",
      connectionEncryptionKey: Buffer.from(KEY, "base64"),
    });
  });

  it("uses MCP_URL as the public URL and derives the Supabase URL from a project ID", () => {
    const config = loadConfig({
      ...BASE_ENV,
      SUPABASE_URL: "",
      SUPABASE_PROJECT_ID: "zyxwvutsrqponmlkjihg",
      MCP_URL: "https://mcp.example.com/",
    });

    expect(config.publicUrl).toBe("https://mcp.example.com");
    expect(config.supabaseUrl).toBe("https://zyxwvutsrqponmlkjihg.supabase.co");
  });

  it("names invalid variables without echoing their values", () => {
    expect(() => loadConfig({})).toThrow("DOCUMENSO_URL");
    expect(() => loadConfig({ ...BASE_ENV, DOCUMENSO_URL: "file:///etc/passwd" })).toThrow("DOCUMENSO_URL");
    expect(() => loadConfig({ ...BASE_ENV, SUPABASE_URL: undefined })).toThrow("SUPABASE_URL");
    expect(() => loadConfig({ ...BASE_ENV, SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" })).toThrow(
      "SUPABASE_PUBLISHABLE_KEY",
    );

    expect(() => loadConfig({ ...BASE_ENV, CONNECTION_ENCRYPTION_KEY: "short-secret-value" })).toThrow(
      /^Invalid configuration: CONNECTION_ENCRYPTION_KEY\. See \.env\.example\.$/,
    );
  });

  it("rejects an out-of-range timeout", () => {
    expect(() => loadConfig({ ...BASE_ENV, DOCUMENSO_TIMEOUT_MS: "5" })).toThrow("DOCUMENSO_TIMEOUT_MS");
  });
});
