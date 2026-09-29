import { createHash } from "node:crypto";

import { OAuthError, OAuthErrorCode, type OAuthProvider } from "mcp-use/oauth";

export type SessionChecker = {
  /** True while the Supabase session behind this access token still exists. */
  isActive(accessToken: string): Promise<boolean>;
};

type SessionCheckerOptions = {
  supabaseUrl: string;
  publishableKey: string;
  /** How long a result is reused. Bounds how long a revoked session keeps working. */
  cacheTtlMs?: number;
  maxEntries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/**
 * Asks Supabase Auth whether a token's session still exists.
 *
 * Supabase access tokens are signed JWTs that stay valid until they expire (up to an hour), even after
 * the user revokes the application's grant. `GET /auth/v1/user` checks the `session_id` claim against
 * live sessions and answers 403 `session_not_found` once the grant is revoked.
 */
export function createSupabaseSessionChecker({
  supabaseUrl,
  publishableKey,
  cacheTtlMs = 30_000,
  maxEntries = 1000,
  timeoutMs = 5000,
  fetchImpl = fetch,
  now = Date.now,
}: SessionCheckerOptions): SessionChecker {
  // Keyed by a hash so raw access tokens are not kept in memory longer than the request.
  const cache = new Map<string, { active: boolean; expiresAt: number }>();

  return {
    async isActive(accessToken) {
      const key = createHash("sha256").update(accessToken).digest("hex");
      const cached = cache.get(key);

      if (cached && cached.expiresAt > now()) {
        return cached.active;
      }

      const response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });

      let active: boolean;

      if (response.status === 200) {
        active = true;
      } else if (response.status === 401 || response.status === 403) {
        active = false;
      } else {
        // Fail closed without caching: the request errors and the next one asks Supabase again.
        throw new Error(`Supabase session check failed with HTTP ${response.status}`);
      }

      cache.delete(key);
      cache.set(key, { active, expiresAt: now() + cacheTtlMs });

      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;

        if (oldest !== undefined) {
          cache.delete(oldest);
        }
      }

      return active;
    },
  };
}

/**
 * Wraps an OAuth provider so that a token is accepted only if its signature is valid (checked by the
 * provider) and its session has not been revoked. A revoked session is rejected as `invalid_token`,
 * which mcp-use answers with 401, so clients sign the user in again.
 */
export function withSessionCheck<TUser>(provider: OAuthProvider<TUser>, sessions: SessionChecker): OAuthProvider<TUser> {
  return {
    ...provider,
    createTokenVerifier(resource) {
      const verifier = provider.createTokenVerifier(resource);

      return {
        async verifyAccessToken(token) {
          const authInfo = await verifier.verifyAccessToken(token);

          if (!(await sessions.isActive(token))) {
            throw new OAuthError(OAuthErrorCode.InvalidToken, "The session for this token has been revoked");
          }

          return authInfo;
        },
      };
    },
  };
}
