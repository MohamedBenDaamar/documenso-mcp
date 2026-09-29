import { describe, expect, it } from "vitest";

import { createDocumensoTokenVerifier, normalizeResource, oauthDocumensoProvider } from "../src/auth/documenso-oauth.js";

const DOCUMENSO_URL = "https://sign.example.com";
const RESOURCE = new URL("https://mcp.example.com/mcp");
const TOKEN = "doa_0123456789abcdefghijklmnopqrstuvwxyzABCD";
const NOW = 1_790_000_000_000;

function activeInfo(overrides: Record<string, unknown> = {}) {
  return {
    active: true,
    iss: DOCUMENSO_URL,
    sub: "42",
    client_id: "client123",
    team_id: 7,
    scope: "envelopes:read",
    aud: "https://mcp.example.com/mcp",
    iat: NOW / 1000 - 60,
    exp: NOW / 1000 + 3600,
    token_type: "Bearer",
    ...overrides,
  };
}

/** Documenso tokeninfo double that records every call. */
function fakeTokenInfo(answer: () => Response) {
  const calls: { url: string; authorization: string | null }[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") });
    return answer();
  };

  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function verifierWith(answer: () => Response, now = () => NOW) {
  const documenso = fakeTokenInfo(answer);
  const verifier = createDocumensoTokenVerifier({
    documensoUrl: DOCUMENSO_URL,
    resource: RESOURCE,
    fetchImpl: documenso.fetchImpl,
    now,
  });

  return { verifier, calls: documenso.calls };
}

describe("createDocumensoTokenVerifier", () => {
  it("accepts an active token issued for this server and maps its user, team and scopes", async () => {
    const { verifier, calls } = verifierWith(() => json(activeInfo()));

    const authInfo = await verifier.verifyAccessToken(TOKEN);

    expect(calls).toEqual([{ url: `${DOCUMENSO_URL}/api/oauth/tokeninfo`, authorization: `Bearer ${TOKEN}` }]);
    expect(authInfo).toMatchObject({
      token: TOKEN,
      clientId: "client123",
      scopes: ["envelopes:read"],
      expiresAt: NOW / 1000 + 3600,
      extra: { sub: "42", team_id: 7 },
    });
    expect(authInfo.resource?.href).toBe("https://mcp.example.com/mcp");
  });

  it("refuses a token issued for another MCP server", async () => {
    const { verifier } = verifierWith(() => json(activeInfo({ aud: "https://other-mcp.example.com/mcp" })));

    await expect(verifier.verifyAccessToken(TOKEN)).rejects.toThrow("issued for another resource");
  });

  it("refuses revoked, expired or unknown tokens that Documenso reports as inactive", async () => {
    const { verifier } = verifierWith(() => json({ active: false }, 401));

    await expect(verifier.verifyAccessToken(TOKEN)).rejects.toThrow("invalid, expired or revoked");
  });

  it("refuses tokens that are not Documenso access tokens without calling Documenso", async () => {
    const { verifier, calls } = verifierWith(() => json(activeInfo()));

    for (const token of ["api_legacyteamtoken", "eyJhbGciOiJub25lIn0.e30.", "dor_refreshtoken"]) {
      await expect(verifier.verifyAccessToken(token)).rejects.toThrow("Not a Documenso access token");
    }

    expect(calls).toEqual([]);
  });

  it("refuses a malformed tokeninfo answer", async () => {
    const { verifier } = verifierWith(() => json({ active: true, sub: "42" }));

    await expect(verifier.verifyAccessToken(TOKEN)).rejects.toThrow("invalid, expired or revoked");
  });

  it("fails closed, without caching, when Documenso cannot answer", async () => {
    let status = 503;
    const { verifier, calls } = verifierWith(() => (status === 503 ? new Response("down", { status }) : json(activeInfo())));

    await expect(verifier.verifyAccessToken(TOKEN)).rejects.toThrow("HTTP 503");

    status = 200;
    await expect(verifier.verifyAccessToken(TOKEN)).resolves.toMatchObject({ token: TOKEN });
    expect(calls).toHaveLength(2);
  });

  it("reuses a result for 30 seconds, then asks Documenso again", async () => {
    let now = NOW;
    let active = true;
    const { verifier, calls } = verifierWith(
      () => (active ? json(activeInfo()) : json({ active: false }, 401)),
      () => now,
    );

    await verifier.verifyAccessToken(TOKEN);
    active = false;
    now += 29_000;
    await expect(verifier.verifyAccessToken(TOKEN)).resolves.toMatchObject({ token: TOKEN });
    expect(calls).toHaveLength(1);

    now += 2_000;
    await expect(verifier.verifyAccessToken(TOKEN)).rejects.toThrow("invalid, expired or revoked");
    expect(calls).toHaveLength(2);
  });

  it("does not keep accepting a cached token after it expires", async () => {
    let now = NOW;
    const { verifier } = verifierWith(() => json(activeInfo({ exp: NOW / 1000 + 10 })), () => now);

    await verifier.verifyAccessToken(TOKEN);
    now += 11_000;

    // The cache entry ends with the token; Documenso is asked again and still says exp is past.
    await expect(verifier.verifyAccessToken(TOKEN)).rejects.toThrow("expired");
  });
});

describe("normalizeResource", () => {
  it("compares resources the way Documenso stores them", () => {
    expect(normalizeResource("https://MCP.example.com/mcp/")).toBe("https://mcp.example.com/mcp");
    expect(normalizeResource("http://localhost:3100/mcp")).toBe("http://localhost:3100/mcp");
  });
});

describe("oauthDocumensoProvider", () => {
  it("points clients at Documenso's endpoints and requires the read scope", () => {
    const provider = oauthDocumensoProvider({ documensoUrl: DOCUMENSO_URL });

    expect(provider.oauthMetadata).toMatchObject({
      issuer: DOCUMENSO_URL,
      authorization_endpoint: `${DOCUMENSO_URL}/api/oauth/authorize`,
      token_endpoint: `${DOCUMENSO_URL}/api/oauth/token`,
      registration_endpoint: `${DOCUMENSO_URL}/api/oauth/register`,
      code_challenge_methods_supported: ["S256"],
    });
    expect(provider.requiredScopes).toEqual(["envelopes:read"]);
  });

  it("maps a verified token to the Documenso user and team", () => {
    const provider = oauthDocumensoProvider({ documensoUrl: DOCUMENSO_URL });

    const mapped = provider.mapAuthInfo({
      token: TOKEN,
      clientId: "client123",
      scopes: ["envelopes:read"],
      extra: { sub: "42", team_id: 7 },
    });

    expect(mapped.user).toEqual({ id: "42", teamId: 7 });
    expect(() => provider.mapAuthInfo({ token: TOKEN, clientId: "c", scopes: [] })).toThrow("no Documenso user or team");
  });
});
