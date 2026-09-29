import { describe, expect, it, vi } from "vitest";

import { DocumensoError } from "../src/documenso/errors.js";
import type { AuthApi, AuthorizationRequest, WebSession } from "../src/web/auth-api.js";
import { createWebHandler, safeNext } from "../src/web/routes.js";
import { sessionCookie } from "../src/web/session-cookie.js";
import { fakeDocumenso, findResponse, memoryStore, TOKEN_A, USER_A } from "./fixtures.js";

const ORIGIN = "http://localhost:3100";
// Same shape as Supabase: 32 lowercase base32 characters.
const AUTHORIZATION_ID = "k7qzd2m4vx3n6p5rtw2yb7cf4hj6ls3a";
const CONSENT_PATH = `/auth/consent?authorization_id=${AUTHORIZATION_ID}`;
const CLIENT_REDIRECT = "https://chatgpt.com/connector/oauth/callback?code=abc&state=xyz";

const SESSION: WebSession = {
  userId: USER_A.id,
  email: "papoibd+teama@gmail.com",
  accessToken: USER_A.accessToken,
  refreshToken: "refresh-a",
};

function fakeAuth(authorization: AuthorizationRequest = { kind: "consent", clientName: "ChatGPT", redirectUri: "https://chatgpt.com/connector/oauth/callback", scopes: ["email", "profile"] }) {
  return {
    signIn: vi.fn<AuthApi["signIn"]>(async (email, password) =>
      email === SESSION.email && password === "correct horse" ? SESSION : null,
    ),
    restore: vi.fn<AuthApi["restore"]>(async (accessToken) => (accessToken === SESSION.accessToken ? SESSION : null)),
    getAuthorizationRequest: vi.fn<AuthApi["getAuthorizationRequest"]>(async () => authorization),
    decide: vi.fn<AuthApi["decide"]>(async () => CLIENT_REDIRECT),
    listGrants: vi.fn<AuthApi["listGrants"]>(async () => [
      { clientId: "9d2b6f1e-2c4a-4b8e-8f3d-0a1b2c3d4e5f", clientName: "ChatGPT", scopes: ["email"], grantedAt: "2026-09-29T10:00:00Z" },
    ]),
    revokeGrant: vi.fn<AuthApi["revokeGrant"]>(async () => true),
  } satisfies AuthApi;
}

function setup(options: { tokens?: Record<string, string>; authorization?: AuthorizationRequest; documenso?: ReturnType<typeof fakeDocumenso> } = {}) {
  const auth = fakeAuth(options.authorization);
  const store = memoryStore(options.tokens ?? {});
  const documenso = options.documenso ?? fakeDocumenso(() => findResponse([]));
  const handle = createWebHandler({ auth, store: store.store, documenso: documenso.client, publicUrl: ORIGIN });

  return { auth, store, documenso, handle };
}

const SIGNED_IN = sessionCookie(SESSION, false).split(";")[0]!;

function get(path: string, cookie?: string) {
  return new Request(`${ORIGIN}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}

function post(
  path: string,
  fields: Record<string, string>,
  options: { cookie?: string; origin?: string | null; secFetchSite?: string } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const origin = options.origin === undefined ? ORIGIN : options.origin;

  if (origin !== null) {
    headers.Origin = origin;
  }
  if (options.secFetchSite) {
    headers["Sec-Fetch-Site"] = options.secFetchSite;
  }
  if (options.cookie) {
    headers.Cookie = options.cookie;
  }

  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: new URLSearchParams(fields) });
}

describe("safeNext", () => {
  it.each([
    [CONSENT_PATH, CONSENT_PATH],
    ["/auth/account", "/auth/account"],
    ["https://evil.example/phish", "/auth/account"],
    ["//evil.example", "/auth/account"],
    [`${CONSENT_PATH}&next=https://evil.example`, "/auth/account"],
    ["/auth/consent?authorization_id=0f8c2a4e-3b1d-4c5e-9f7a-1234567890ab", "/auth/account"],
    ["/auth/consent?authorization_id=K7QZD2M4VX3N6P5RTW2YB7CF4HJ6LS3A", "/auth/account"],
    [null, "/auth/account"],
  ])("%s becomes %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe("consent page", () => {
  it("asks a signed-out user to sign in and keeps the authorization request", async () => {
    const { handle } = setup();

    const response = await handle(get(CONSENT_PATH));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('action="/auth/signin"');
    expect(body).toContain(`value="${CONSENT_PATH}"`);
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("disables Allow until a Documenso team is connected", async () => {
    const { handle } = setup();

    const body = await (await handle(get(CONSENT_PATH, SIGNED_IN))).text();

    expect(body).toContain("Connect your Documenso team");
    expect(body).toMatch(/<button class="primary" type="submit" disabled>Allow<\/button>/);
  });

  it("enables Allow and shows only the token hint once a team is connected", async () => {
    const { handle } = setup({ tokens: { [USER_A.id]: TOKEN_A } });

    const body = await (await handle(get(CONSENT_PATH, SIGNED_IN))).text();

    expect(body).toMatch(/<button class="primary" type="submit">Allow<\/button>/);
    expect(body).toContain(`<code>${TOKEN_A.slice(-4)}</code>`);
    expect(body).not.toContain(TOKEN_A);
  });

  it("escapes the client name registered by the connecting application", async () => {
    const { handle } = setup({
      authorization: { kind: "consent", clientName: '<script>alert("x")</script>', redirectUri: "https://x.example", scopes: [] },
    });

    const body = await (await handle(get(CONSENT_PATH, SIGNED_IN))).text();

    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("follows Supabase's redirect when the user already consented", async () => {
    const { handle } = setup({ authorization: { kind: "redirect", url: CLIENT_REDIRECT } });

    const response = await handle(get(CONSENT_PATH, SIGNED_IN));

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(CLIENT_REDIRECT);
  });

  it("rejects malformed authorization IDs", async () => {
    const { handle } = setup();

    const response = await handle(get("/auth/consent?authorization_id=../../etc"));

    expect(response.status).toBe(400);
  });
});

describe("form posts", () => {
  it("block requests from another origin or without an Origin header", async () => {
    const { handle, auth } = setup();

    const crossSite = await handle(post("/auth/signin", { email: SESSION.email!, password: "correct horse" }, { origin: "https://evil.example" }));
    const noOrigin = await handle(post("/auth/signin", { email: SESSION.email!, password: "correct horse" }, { origin: null }));

    expect(crossSite.status).toBe(403);
    expect(noOrigin.status).toBe(403);
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("accept a withheld Origin only when the browser marks the post as same-origin", async () => {
    const { handle, auth } = setup();
    const fields = { email: SESSION.email!, password: "correct horse" };

    const nullSameOrigin = await handle(post("/auth/signin", fields, { origin: "null", secFetchSite: "same-origin" }));
    const nullCrossSite = await handle(post("/auth/signin", fields, { origin: "null", secFetchSite: "cross-site" }));
    const foreignSameOrigin = await handle(
      post("/auth/signin", fields, { origin: "https://evil.example", secFetchSite: "same-origin" }),
    );

    expect(nullSameOrigin.status).toBe(303);
    expect(nullCrossSite.status).toBe(403);
    expect(foreignSameOrigin.status).toBe(403);
    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });

  it("pages use a same-origin referrer policy, so browsers send Origin on our own form posts", async () => {
    const { handle } = setup();

    const response = await handle(get("/auth/account"));

    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  });

  it("sign in sets an HttpOnly session cookie and returns to the consent page", async () => {
    const { handle } = setup();

    const response = await handle(post("/auth/signin", { email: SESSION.email!, password: "correct horse", next: CONSENT_PATH }));

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(CONSENT_PATH);
    expect(response.headers.get("Set-Cookie")).toMatch(/^dmcp_session=.+; Path=\/auth; HttpOnly; SameSite=Lax; Max-Age=3600$/);
  });

  it("sign in never redirects off-site", async () => {
    const { handle } = setup();

    const response = await handle(post("/auth/signin", { email: SESSION.email!, password: "correct horse", next: "https://evil.example" }));

    expect(response.headers.get("Location")).toBe("/auth/account");
  });

  it("wrong password shows a generic error and sets no cookie", async () => {
    const { handle } = setup();

    const response = await handle(post("/auth/signin", { email: SESSION.email!, password: "wrong" }));

    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Wrong email or password.");
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("refuses to approve before a Documenso team is connected", async () => {
    const { handle, auth } = setup();

    const response = await handle(post("/auth/consent", { authorization_id: AUTHORIZATION_ID, decision: "approve" }, { cookie: SIGNED_IN }));

    expect(response.headers.get("Location")).toBe(`${CONSENT_PATH}&notice=connection_required`);
    expect(auth.decide).not.toHaveBeenCalled();
  });

  it("approves and sends the user back to the application", async () => {
    const { handle, auth } = setup({ tokens: { [USER_A.id]: TOKEN_A } });

    const response = await handle(post("/auth/consent", { authorization_id: AUTHORIZATION_ID, decision: "approve" }, { cookie: SIGNED_IN }));

    expect(auth.decide).toHaveBeenCalledWith(SESSION, AUTHORIZATION_ID, true);
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(CLIENT_REDIRECT);
  });

  it("lets a user deny without a connected team", async () => {
    const { handle, auth } = setup();

    await handle(post("/auth/consent", { authorization_id: AUTHORIZATION_ID, decision: "deny" }, { cookie: SIGNED_IN }));

    expect(auth.decide).toHaveBeenCalledWith(SESSION, AUTHORIZATION_ID, false);
  });

  it("requires a session for everything except sign in and sign out", async () => {
    const { handle, store } = setup();

    const response = await handle(post("/auth/documenso", { token: TOKEN_A, next: CONSENT_PATH }));

    expect(response.status).toBe(401);
    expect(store.calls).toEqual([]);
  });
});

describe("connecting a Documenso token", () => {
  it("checks the token with Documenso, then stores it for the signed-in user only", async () => {
    const { handle, store, documenso } = setup();

    const response = await handle(post("/auth/documenso", { token: `  ${TOKEN_A}  `, next: CONSENT_PATH }, { cookie: SIGNED_IN }));

    expect(documenso.requests).toEqual([{ path: "/envelope?perPage=1", token: TOKEN_A }]);
    expect(store.tokens.get(USER_A.id)).toBe(TOKEN_A);
    expect(store.calls).toEqual([{ op: "save", userId: USER_A.id }]);
    expect(response.headers.get("Location")).toBe(`${CONSENT_PATH}&notice=connected`);
  });

  it("does not store a token Documenso rejects", async () => {
    const documenso = fakeDocumenso(() => {
      throw new DocumensoError("unauthorized", 401);
    });
    const { handle, store } = setup({ documenso });

    const response = await handle(post("/auth/documenso", { token: TOKEN_A, next: CONSENT_PATH }, { cookie: SIGNED_IN }));

    expect(response.headers.get("Location")).toBe(`${CONSENT_PATH}&notice=token_rejected`);
    expect(store.tokens.size).toBe(0);
  });

  it("rejects values that are not API tokens before contacting Documenso", async () => {
    const { handle, documenso } = setup();

    const response = await handle(post("/auth/documenso", { token: "not a token" }, { cookie: SIGNED_IN }));

    expect(response.headers.get("Location")).toBe("/auth/account?notice=token_invalid");
    expect(documenso.requests).toEqual([]);
  });

  it("disconnecting deletes the stored token", async () => {
    const { handle, store } = setup({ tokens: { [USER_A.id]: TOKEN_A } });

    await handle(post("/auth/documenso/disconnect", { next: "/auth/account" }, { cookie: SIGNED_IN }));

    expect(store.tokens.has(USER_A.id)).toBe(false);
  });
});

describe("account page", () => {
  it("lists applications with access and revokes one", async () => {
    const { handle, auth } = setup({ tokens: { [USER_A.id]: TOKEN_A } });

    const page = await (await handle(get("/auth/account", SIGNED_IN))).text();
    const revoke = await handle(post("/auth/grants/revoke", { client_id: "9d2b6f1e-2c4a-4b8e-8f3d-0a1b2c3d4e5f" }, { cookie: SIGNED_IN }));

    expect(page).toContain("<strong>ChatGPT</strong>");
    expect(page).toContain("Disconnect team and delete token");
    expect(auth.revokeGrant).toHaveBeenCalledWith(SESSION, "9d2b6f1e-2c4a-4b8e-8f3d-0a1b2c3d4e5f");
    expect(revoke.headers.get("Location")).toBe("/auth/account?notice=revoked");
  });

  it("only renders known notices, so the query string cannot inject text", async () => {
    const { handle } = setup();

    const body = await (await handle(get("/auth/account?notice=<b>pwned</b>", SIGNED_IN))).text();

    expect(body).not.toContain("pwned");
  });

  it("clears an invalid session cookie", async () => {
    const { handle } = setup();
    const stale = sessionCookie({ ...SESSION, accessToken: "expired", refreshToken: "revoked" }, false).split(";")[0]!;

    const response = await handle(get("/auth/account", stale));

    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(await response.text()).toContain('action="/auth/signin"');
  });
});
