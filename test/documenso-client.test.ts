import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createDocumensoClient } from "../src/documenso/client.js";
import { classifyFailure, DocumensoError } from "../src/documenso/errors.js";

const BASE_URL = "http://documenso.test";
const TOKEN = "api_secrettoken0000";

// Shape of a real Documenso dev-mode error body, including the stack trace and server paths it leaks.
const LEAKY_ERROR_BODY = {
  message: "Envelope could not be found",
  code: "INTERNAL_SERVER_ERROR",
  data: {
    code: "NOT_FOUND",
    httpStatus: 404,
    stack: "AppError: Envelope could not be found\n    at getEnvelopeById (/srv/documenso/packages/lib/get-envelope-by-id.ts:73:11)",
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function clientWith(fetchImpl: typeof fetch, timeoutMs = 1000) {
  return createDocumensoClient({ baseUrl: BASE_URL, timeoutMs, fetchImpl });
}

async function captureError(promise: Promise<unknown>): Promise<DocumensoError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DocumensoError);
    return error as DocumensoError;
  }
  throw new Error("Expected the promise to reject");
}

describe("getHealth", () => {
  it("returns Documenso's health checks and a latency", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "ok",
        timestamp: "2026-09-28T21:18:58.247Z",
        checks: { database: { status: "ok" }, certificate: { status: "ok" } },
      }),
    );

    const health = await clientWith(fetchImpl).getHealth();

    expect(fetchImpl).toHaveBeenCalledWith(`${BASE_URL}/api/health`, expect.objectContaining({ method: "GET" }));
    expect(health).toMatchObject({ status: "ok", checks: { database: { status: "ok" } } });
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reads the health body when Documenso answers 500 because a check failed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: "error", checks: { database: { status: "error" }, certificate: { status: "ok" } } }, 500),
    );

    const health = await clientWith(fetchImpl).getHealth();

    expect(health.status).toBe("error");
    expect(health.checks.database.status).toBe("error");
  });

  it("reports unavailable when Documenso cannot be reached", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });

    const error = await captureError(clientWith(fetchImpl).getHealth());

    expect(error.kind).toBe("unavailable");
  });

  it("reports unavailable when Documenso does not answer before the timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );

    const error = await captureError(clientWith(fetchImpl, 20).getHealth());

    expect(error.kind).toBe("unavailable");
  });
});

describe("request", () => {
  const EnvelopeSchema = z.object({ id: z.string() });

  it("sends the caller's token and validates the response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ id: "envelope_abc", extra: true }));

    const result = await clientWith(fetchImpl).request({
      path: "/envelope/envelope_abc",
      token: TOKEN,
      schema: EnvelopeSchema,
    });

    expect(result).toEqual({ id: "envelope_abc" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/api/v2/envelope/envelope_abc`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(init?.redirect).toBe("error");
  });

  it("refuses to call Documenso without a token", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await captureError(
      clientWith(fetchImpl).request({ path: "/envelope", token: "", schema: EnvelopeSchema }),
    );

    expect(error.kind).toBe("unauthorized");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never exposes Documenso's error body, stack trace or the token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(LEAKY_ERROR_BODY, 404));

    const error = await captureError(
      clientWith(fetchImpl).request({ path: "/envelope/envelope_other_team", token: TOKEN, schema: EnvelopeSchema }),
    );

    expect(error.kind).toBe("not_found_or_forbidden");
    const serialized = `${error.message} ${JSON.stringify(error)} ${String(error.stack)}`;
    expect(serialized).not.toContain("getEnvelopeById");
    expect(serialized).not.toContain("/srv/documenso");
    expect(serialized).not.toContain(TOKEN);
  });

  it("treats a response that does not match the schema as unexpected", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ unexpected: "shape" }));

    const error = await captureError(
      clientWith(fetchImpl).request({ path: "/envelope/envelope_abc", token: TOKEN, schema: EnvelopeSchema }),
    );

    expect(error.kind).toBe("unexpected");
  });
});

describe("classifyFailure", () => {
  it.each([
    [401, undefined, undefined, "unauthorized"],
    [401, "EXPIRED_CODE", "Expired token", "unauthorized"],
    [404, "NOT_FOUND", "Envelope could not be found", "not_found_or_forbidden"],
    [403, "FORBIDDEN", undefined, "not_found_or_forbidden"],
    // Observed: cross-team POST /envelope/distribute answers 500 "Document not found".
    [500, "INTERNAL_SERVER_ERROR", "Document not found", "not_found_or_forbidden"],
    [500, "INTERNAL_SERVER_ERROR", "Something broke", "unexpected"],
    [400, "INVALID_BODY", undefined, "invalid_request"],
    [429, undefined, undefined, "rate_limited"],
    [503, undefined, undefined, "unavailable"],
  ] as const)("HTTP %i with code %s and message %s is %s", (status, appCode, message, expected) => {
    expect(classifyFailure(status, appCode, message)).toBe(expected);
  });
});
