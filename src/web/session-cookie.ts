import type { WebSession } from "./auth-api.js";

const COOKIE_NAME = "dmcp_session";
const MAX_AGE_SECONDS = 60 * 60;

type StoredTokens = { accessToken: string; refreshToken: string };

export function readSessionCookie(cookieHeader: string | null): StoredTokens | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");

    if (name !== COOKIE_NAME) {
      continue;
    }

    try {
      const decoded: unknown = JSON.parse(Buffer.from(rest.join("="), "base64url").toString("utf8"));

      if (
        typeof decoded === "object" &&
        decoded !== null &&
        "a" in decoded &&
        "r" in decoded &&
        typeof decoded.a === "string" &&
        typeof decoded.r === "string"
      ) {
        return { accessToken: decoded.a, refreshToken: decoded.r };
      }
    } catch {
      return null;
    }
  }

  return null;
}

/** HttpOnly, SameSite=Lax, scoped to /auth, and Secure whenever the server is served over HTTPS. */
export function sessionCookie(session: WebSession, secure: boolean): string {
  const value = Buffer.from(JSON.stringify({ a: session.accessToken, r: session.refreshToken })).toString("base64url");

  return `${COOKIE_NAME}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}
