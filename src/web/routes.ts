import { z } from "zod";

import { ConnectionStoreError, type ConnectionStore, type DocumensoConnection } from "../connections/store.js";
import type { DocumensoClient } from "../documenso/client.js";
import { DocumensoError } from "../documenso/errors.js";
import type { AuthApi, WebSession } from "./auth-api.js";
import {
  accountPage,
  consentPage,
  isNoticeCode,
  messagePage,
  PAGE_HEADERS,
  signInPage,
  type NoticeCode,
} from "./pages.js";
import { clearedSessionCookie, readSessionCookie, sessionCookie } from "./session-cookie.js";

export type WebDeps = {
  auth: AuthApi;
  store: ConnectionStore;
  documenso: DocumensoClient;
  /** Public origin of this server. POST requests must come from it. */
  publicUrl: string;
};

const ACCOUNT_PATH = "/auth/account";
// Supabase Auth generates authorization IDs with crypto.SecureAlphanumeric(32): 32 lowercase base32 characters.
const AUTHORIZATION_ID = /^[a-z0-9]{32}$/;
// OAuth client IDs are UUIDs.
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const API_TOKEN = /^api_[A-Za-z0-9_-]{8,128}$/;
const MAX_FORM_BYTES = 8 * 1024;

/** Only these destinations are accepted after a form post, so `next` can never redirect off-site. */
export function safeNext(value: FormDataEntryValue | string | null): string {
  if (typeof value !== "string") {
    return ACCOUNT_PATH;
  }

  const match = /^\/auth\/consent\?authorization_id=([^&#]+)$/.exec(value);

  if (match?.[1] && AUTHORIZATION_ID.test(match[1])) {
    return value;
  }

  return ACCOUNT_PATH;
}

function withNotice(path: string, notice: NoticeCode): string {
  return `${path}${path.includes("?") ? "&" : "?"}notice=${notice}`;
}

export function createWebHandler({ auth, store, documenso, publicUrl }: WebDeps) {
  const origin = new URL(publicUrl).origin;
  const secure = origin.startsWith("https://");

  function html(body: string, status = 200, cookies: string[] = []): Response {
    const headers = new Headers(PAGE_HEADERS);

    for (const cookie of cookies) {
      headers.append("Set-Cookie", cookie);
    }

    return new Response(body, { status, headers });
  }

  function redirect(location: string, cookies: string[] = []): Response {
    const headers = new Headers({ Location: location, "Cache-Control": "no-store", "Referrer-Policy": "same-origin" });

    for (const cookie of cookies) {
      headers.append("Set-Cookie", cookie);
    }

    return new Response(null, { status: 303, headers });
  }

  /** Restores the browser session. `cookies` carries a refreshed or cleared cookie to send back. */
  async function currentSession(request: Request): Promise<{ session: WebSession | null; cookies: string[] }> {
    const stored = readSessionCookie(request.headers.get("Cookie"));

    if (!stored) {
      return { session: null, cookies: [] };
    }

    const session = await auth.restore(stored.accessToken, stored.refreshToken);

    if (!session) {
      return { session: null, cookies: [clearedSessionCookie(secure)] };
    }

    const rotated = session.accessToken !== stored.accessToken || session.refreshToken !== stored.refreshToken;

    return { session, cookies: rotated ? [sessionCookie(session, secure)] : [] };
  }

  async function connectionOf(session: WebSession): Promise<DocumensoConnection | null> {
    return store.get({ id: session.userId, accessToken: session.accessToken });
  }

  async function readForm(request: Request): Promise<FormData | null> {
    const length = Number(request.headers.get("Content-Length") ?? "0");

    if (length > MAX_FORM_BYTES) {
      return null;
    }

    try {
      return await request.formData();
    } catch {
      return null;
    }
  }

  async function showConsent(url: URL, request: Request): Promise<Response> {
    const authorizationId = url.searchParams.get("authorization_id") ?? "";

    if (!AUTHORIZATION_ID.test(authorizationId)) {
      return html(messagePage("Invalid request", "This authorization link is not valid."), 400);
    }

    const next = `/auth/consent?authorization_id=${authorizationId}`;
    const { session, cookies } = await currentSession(request);

    if (!session) {
      return html(signInPage(next), 200, cookies);
    }

    const authorization = await auth.getAuthorizationRequest(session, authorizationId);

    if (authorization.kind === "redirect") {
      return redirect(authorization.url, cookies);
    }

    if (authorization.kind === "invalid") {
      return html(
        messagePage(
          "Request expired",
          "This authorization request is invalid or has expired. Start connecting again from ChatGPT or Claude.",
        ),
        400,
        cookies,
      );
    }

    const notice = url.searchParams.get("notice");

    return html(
      consentPage({
        authorizationId,
        clientName: authorization.clientName,
        redirectUri: authorization.redirectUri,
        scopes: authorization.scopes,
        email: session.email,
        connection: await connectionOf(session),
        notice: isNoticeCode(notice) ? notice : undefined,
      }),
      200,
      cookies,
    );
  }

  async function showAccount(url: URL, request: Request): Promise<Response> {
    const { session, cookies } = await currentSession(request);

    if (!session) {
      return html(signInPage(ACCOUNT_PATH), 200, cookies);
    }

    const [connection, grants] = await Promise.all([connectionOf(session), auth.listGrants(session)]);
    const notice = url.searchParams.get("notice");

    return html(
      accountPage({
        email: session.email,
        connection,
        grants,
        notice: isNoticeCode(notice) ? notice : undefined,
      }),
      200,
      cookies,
    );
  }

  async function signIn(form: FormData): Promise<Response> {
    const next = safeNext(form.get("next"));
    const email = form.get("email");
    const password = form.get("password");

    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return html(signInPage(next, true), 400);
    }

    const session = await auth.signIn(email.trim(), password);

    if (!session) {
      return html(signInPage(next, true), 401);
    }

    return redirect(next, [sessionCookie(session, secure)]);
  }

  async function connectDocumenso(form: FormData, session: WebSession, cookies: string[]): Promise<Response> {
    const next = safeNext(form.get("next"));
    const token = form.get("token");
    const trimmed = typeof token === "string" ? token.trim() : "";

    if (!API_TOKEN.test(trimmed)) {
      return redirect(withNotice(next, "token_invalid"), cookies);
    }

    try {
      await documenso.request({
        path: "/envelope?perPage=1",
        token: trimmed,
        schema: z.object({ count: z.number() }),
      });
    } catch (error) {
      const rejected = error instanceof DocumensoError && error.kind === "unauthorized";
      return redirect(withNotice(next, rejected ? "token_rejected" : "documenso_unavailable"), cookies);
    }

    await store.save({ id: session.userId, accessToken: session.accessToken }, trimmed, new Date());

    return redirect(withNotice(next, "connected"), cookies);
  }

  async function decide(form: FormData, session: WebSession, cookies: string[]): Promise<Response> {
    const authorizationId = form.get("authorization_id");
    const decision = form.get("decision");

    if (typeof authorizationId !== "string" || !AUTHORIZATION_ID.test(authorizationId)) {
      return html(messagePage("Invalid request", "This authorization request is not valid."), 400, cookies);
    }

    if (decision !== "approve" && decision !== "deny") {
      return html(messagePage("Invalid request", "Choose Allow or Deny."), 400, cookies);
    }

    if (decision === "approve" && !(await connectionOf(session))) {
      return redirect(
        withNotice(`/auth/consent?authorization_id=${authorizationId}`, "connection_required"),
        cookies,
      );
    }

    const redirectUrl = await auth.decide(session, authorizationId, decision === "approve");

    if (!redirectUrl) {
      return html(
        messagePage("Request expired", "This authorization request could not be completed. Start again from ChatGPT or Claude."),
        400,
        cookies,
      );
    }

    return redirect(redirectUrl, cookies);
  }

  /**
   * CSRF check for form posts. Browsers send our exact Origin on same-origin posts. When a browser or
   * extension withholds it (`Origin: null` or no header), accept the browser-set `Sec-Fetch-Site:
   * same-origin`, which page scripts cannot forge. Any other origin is refused.
   */
  function isSameOriginPost(request: Request): boolean {
    const requestOrigin = request.headers.get("Origin");

    if (requestOrigin === origin) {
      return true;
    }

    const withheld = requestOrigin === null || requestOrigin === "null";

    return withheld && request.headers.get("Sec-Fetch-Site") === "same-origin";
  }

  async function handlePost(url: URL, request: Request): Promise<Response> {
    if (!isSameOriginPost(request)) {
      return html(messagePage("Request blocked", "This form was not submitted from this site."), 403);
    }

    const form = await readForm(request);

    if (!form) {
      return html(messagePage("Invalid request", "The form could not be read."), 400);
    }

    if (url.pathname === "/auth/signin") {
      return signIn(form);
    }

    if (url.pathname === "/auth/signout") {
      return redirect(ACCOUNT_PATH, [clearedSessionCookie(secure)]);
    }

    const { session, cookies } = await currentSession(request);

    if (!session) {
      return html(signInPage(safeNext(form.get("next"))), 401, cookies);
    }

    const user = { id: session.userId, accessToken: session.accessToken };

    switch (url.pathname) {
      case "/auth/consent":
        return decide(form, session, cookies);
      case "/auth/documenso":
        return connectDocumenso(form, session, cookies);
      case "/auth/documenso/disconnect":
        await store.remove(user);
        return redirect(withNotice(safeNext(form.get("next")), "disconnected"), cookies);
      case "/auth/grants/revoke": {
        const clientId = form.get("client_id");
        const revoked = typeof clientId === "string" && CLIENT_ID.test(clientId) && (await auth.revokeGrant(session, clientId));
        return redirect(withNotice(ACCOUNT_PATH, revoked ? "revoked" : "revoke_failed"), cookies);
      }
      default:
        return html(messagePage("Not found", "This page does not exist."), 404, cookies);
    }
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/auth/consent") {
        return await showConsent(url, request);
      }

      if (request.method === "GET" && url.pathname === ACCOUNT_PATH) {
        return await showAccount(url, request);
      }

      if (request.method === "POST") {
        return await handlePost(url, request);
      }

      return html(messagePage("Not found", "This page does not exist."), 404);
    } catch (error) {
      if (error instanceof ConnectionStoreError) {
        return html(messagePage("Something went wrong", error.message), 503);
      }

      return html(messagePage("Something went wrong", "The request could not be completed. Try again."), 500);
    }
  };
}
