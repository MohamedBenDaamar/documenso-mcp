import { OAuthError, OAuthErrorCode, type OAuthProvider } from "mcp-use/oauth";
import { describe, expect, it, vi } from "vitest";

import { createSupabaseSessionChecker, withSessionCheck, type SessionChecker } from "../src/auth/session-check.js";

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const TOKEN = "header.payload.signature";

function checkerAnswering(status: number, clock = { now: 0 }) {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status }));
  const checker = createSupabaseSessionChecker({
    supabaseUrl: SUPABASE_URL,
    publishableKey: "sb_publishable_example",
    cacheTtlMs: 30_000,
    fetchImpl,
    now: () => clock.now,
  });

  return { checker, fetchImpl, clock };
}

describe("Supabase session checker", () => {
  it("asks Supabase Auth with the access token and the publishable key", async () => {
    const { checker, fetchImpl } = checkerAnswering(200);

    expect(await checker.isActive(TOKEN)).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${SUPABASE_URL}/auth/v1/user`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(new Headers(init?.headers).get("apikey")).toBe("sb_publishable_example");
  });

  it.each([401, 403])("treats HTTP %i (for example session_not_found after a revoke) as inactive", async (status) => {
    const { checker } = checkerAnswering(status);

    expect(await checker.isActive(TOKEN)).toBe(false);
  });

  it("fails closed without caching when Supabase errors", async () => {
    const { checker, fetchImpl } = checkerAnswering(503);

    await expect(checker.isActive(TOKEN)).rejects.toThrow("HTTP 503");
    await expect(checker.isActive(TOKEN)).rejects.toThrow("HTTP 503");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reuses a result for the cache period, then asks again", async () => {
    const { checker, fetchImpl, clock } = checkerAnswering(200);

    await checker.isActive(TOKEN);
    clock.now = 29_999;
    await checker.isActive(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock.now = 30_001;
    await checker.isActive(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("withSessionCheck", () => {
  const authInfo = { token: TOKEN, clientId: "client", scopes: [], expiresAt: 4102444800 };

  function providerAccepting(): OAuthProvider<{ id: string }> {
    return {
      oauthMetadata: { issuer: `${SUPABASE_URL}/auth/v1` } as OAuthProvider<{ id: string }>["oauthMetadata"],
      createTokenVerifier: () => ({ verifyAccessToken: async () => authInfo }),
      mapAuthInfo: () => ({ user: { id: "user" }, payload: {}, permissions: [] }),
    };
  }

  function sessions(active: boolean): SessionChecker & { isActive: ReturnType<typeof vi.fn> } {
    return { isActive: vi.fn(async () => active) };
  }

  it("accepts a valid token whose session is live", async () => {
    const verifier = withSessionCheck(providerAccepting(), sessions(true)).createTokenVerifier(new URL("http://localhost:3100/mcp"));

    await expect(verifier.verifyAccessToken(TOKEN)).resolves.toEqual(authInfo);
  });

  it("rejects a valid token whose session was revoked as invalid_token", async () => {
    const verifier = withSessionCheck(providerAccepting(), sessions(false)).createTokenVerifier(new URL("http://localhost:3100/mcp"));

    const error = await verifier.verifyAccessToken(TOKEN).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe(OAuthErrorCode.InvalidToken);
  });

  it("never asks Supabase about tokens the provider already rejected", async () => {
    const provider = providerAccepting();
    provider.createTokenVerifier = () => ({
      verifyAccessToken: async () => {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "bad signature");
      },
    });
    const live = sessions(true);

    await expect(withSessionCheck(provider, live).createTokenVerifier(new URL("http://localhost:3100/mcp")).verifyAccessToken(TOKEN)).rejects.toThrow("bad signature");
    expect(live.isActive).not.toHaveBeenCalled();
  });

  it("keeps the provider's metadata and identity mapping", () => {
    const provider = providerAccepting();
    const wrapped = withSessionCheck(provider, sessions(true));

    expect(wrapped.oauthMetadata).toBe(provider.oauthMetadata);
    expect(wrapped.mapAuthInfo).toBe(provider.mapAuthInfo);
  });
});
