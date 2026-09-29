import { createHash } from "node:crypto";

import { OAuthError, OAuthErrorCode, oauthCustomProvider, type OAuthProvider } from "mcp-use/oauth";
import { z } from "zod";

/** The Documenso user and team an access token acts for. */
export type DocumensoUser = {
  /** Documenso user ID. */
  id: string;
  /** The team the user chose on Documenso's consent page. Every Documenso call is limited to it. */
  teamId: number;
};

/** Scopes this server's tools use. Write and send scopes are added with the tools that need them. */
export const REQUIRED_SCOPES = ["envelopes:read"] as const;

const ACCESS_TOKEN_PREFIX = "doa_";

// Documenso answers with RFC 7662 fields plus `team_id`. Only an active token parses.
const TokenInfoSchema = z.object({
  active: z.literal(true),
  sub: z.string().min(1),
  client_id: z.string().min(1),
  team_id: z.number().int(),
  scope: z.string(),
  aud: z.string(),
  exp: z.number(),
});

type TokenVerifierOptions = {
  documensoUrl: string;
  /** This server's canonical MCP resource URL. Tokens must have been issued for it. */
  resource: URL;
  /** How long a result is reused. Bounds how long a revoked token keeps working here. */
  cacheTtlMs?: number;
  maxEntries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type AuthInfo = Awaited<ReturnType<ReturnType<OAuthProvider<DocumensoUser>["createTokenVerifier"]>["verifyAccessToken"]>>;

/** Same canonical form Documenso uses for resource indicators: lower-case host, no trailing slash. */
export function normalizeResource(value: string): string {
  const url = new URL(value);

  return url.href.replace(/\/$/, "");
}

function invalidToken(description: string): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, description);
}

/**
 * Validates Documenso OAuth access tokens with Documenso's `tokeninfo` endpoint.
 *
 * A token is accepted only if Documenso says it is active and it was issued for this MCP server
 * (`aud`). Without the audience check, a token a user granted to a different MCP server that trusts
 * the same Documenso would work here too.
 */
export function createDocumensoTokenVerifier({
  documensoUrl,
  resource,
  cacheTtlMs = 30_000,
  maxEntries = 1000,
  timeoutMs = 5000,
  fetchImpl = fetch,
  now = Date.now,
}: TokenVerifierOptions) {
  const expectedAudience = normalizeResource(resource.href);

  // Keyed by a hash so raw tokens are not kept in memory longer than the request.
  const cache = new Map<string, { authInfo: AuthInfo | null; expiresAt: number }>();

  function remember(key: string, authInfo: AuthInfo | null, expiresAt: number) {
    cache.delete(key);
    cache.set(key, { authInfo, expiresAt });

    if (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;

      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
  }

  async function lookUp(token: string): Promise<AuthInfo | null> {
    const response = await fetchImpl(`${documensoUrl}/api/oauth/tokeninfo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 401) {
      return null;
    }

    if (response.status !== 200) {
      // Fail closed without caching: this request errors and the next one asks Documenso again.
      throw new Error(`Documenso token check failed with HTTP ${response.status}`);
    }

    const info = TokenInfoSchema.safeParse(await response.json().catch(() => null));

    if (!info.success) {
      return null;
    }

    const { sub, client_id: clientId, team_id: teamId, scope, aud, exp } = info.data;

    if (normalizeResource(aud) !== expectedAudience) {
      throw invalidToken("This token was issued for another resource");
    }

    return {
      token,
      clientId,
      scopes: scope.split(" ").filter(Boolean),
      expiresAt: exp,
      resource: new URL(aud),
      extra: { sub, team_id: teamId },
    };
  }

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (!token.startsWith(ACCESS_TOKEN_PREFIX)) {
        throw invalidToken("Not a Documenso access token");
      }

      const key = createHash("sha256").update(token).digest("hex");
      const cached = cache.get(key);
      let authInfo: AuthInfo | null;

      if (cached && cached.expiresAt > now()) {
        authInfo = cached.authInfo;
      } else {
        authInfo = await lookUp(token);

        const tokenExpiresAt = authInfo?.expiresAt ? authInfo.expiresAt * 1000 : Infinity;

        remember(key, authInfo, Math.min(now() + cacheTtlMs, tokenExpiresAt));
      }

      if (!authInfo) {
        throw invalidToken("The token is invalid, expired or revoked");
      }

      if (authInfo.expiresAt !== undefined && authInfo.expiresAt * 1000 <= now()) {
        throw invalidToken("The token has expired");
      }

      return authInfo;
    },
  };
}

type DocumensoProviderOptions = {
  documensoUrl: string;
  fetchImpl?: typeof fetch;
};

/**
 * Makes Documenso (with the OAuth server from the documenso fork) this MCP server's authorization
 * server. MCP clients discover it from the protected resource metadata, register, and send the user to
 * Documenso's consent page; this server only validates the resulting tokens.
 */
export function oauthDocumensoProvider({ documensoUrl, fetchImpl }: DocumensoProviderOptions): OAuthProvider<DocumensoUser> {
  return oauthCustomProvider<DocumensoUser>({
    createTokenVerifier: (resource) => createDocumensoTokenVerifier({ documensoUrl, resource, fetchImpl }),
    oauthMetadata: {
      issuer: documensoUrl,
      authorization_endpoint: `${documensoUrl}/api/oauth/authorize`,
      token_endpoint: `${documensoUrl}/api/oauth/token`,
      registration_endpoint: `${documensoUrl}/api/oauth/register`,
      revocation_endpoint: `${documensoUrl}/api/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["envelopes:read", "envelopes:write", "envelopes:send"],
    },
    mapAuthInfo: (authInfo) => {
      const sub = authInfo.extra?.sub;
      const teamId = authInfo.extra?.team_id;

      if (typeof sub !== "string" || typeof teamId !== "number") {
        throw invalidToken("The token has no Documenso user or team");
      }

      return { user: { id: sub, teamId }, payload: { sub, team_id: teamId }, permissions: [] };
    },
    requiredScopes: REQUIRED_SCOPES,
    scopesSupported: REQUIRED_SCOPES,
    resourceName: "Documenso",
  });
}
