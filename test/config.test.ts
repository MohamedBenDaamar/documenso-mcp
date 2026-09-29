import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("reads the Documenso URL, strips trailing slashes and defaults the timeout", () => {
    expect(loadConfig({ DOCUMENSO_URL: "http://localhost:3000/" })).toEqual({
      documensoUrl: "http://localhost:3000",
      documensoTimeoutMs: 10000,
    });
  });

  it("rejects a missing or non-http URL without echoing values", () => {
    expect(() => loadConfig({})).toThrow("Invalid configuration: DOCUMENSO_URL");
    expect(() => loadConfig({ DOCUMENSO_URL: "file:///etc/passwd" })).toThrow("DOCUMENSO_URL");
  });

  it("rejects an out-of-range timeout", () => {
    expect(() => loadConfig({ DOCUMENSO_URL: "http://localhost:3000", DOCUMENSO_TIMEOUT_MS: "5" })).toThrow(
      "DOCUMENSO_TIMEOUT_MS",
    );
  });
});
