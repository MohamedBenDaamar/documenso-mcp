import type { DocumensoConnection } from "../connections/store.js";
import type { Grant } from "./auth-api.js";

export const NOTICES = {
  connected: { tone: "ok", text: "Documenso team connected." },
  disconnected: { tone: "ok", text: "Documenso team disconnected. Its token was deleted from this server." },
  revoked: { tone: "ok", text: "Access revoked. That application must connect again to use this server." },
  token_invalid: { tone: "error", text: "That does not look like a Documenso API token. Tokens start with api_." },
  token_rejected: {
    tone: "error",
    text: "Documenso rejected this token. Check that it is still valid and belongs to your team.",
  },
  documenso_unavailable: { tone: "error", text: "Documenso could not be reached to check the token. Try again." },
  connection_required: { tone: "error", text: "Connect a Documenso team before allowing access." },
  storage_failed: { tone: "error", text: "The connection could not be saved. Try again." },
  revoke_failed: { tone: "error", text: "Access could not be revoked. Try again." },
} as const;

export type NoticeCode = keyof typeof NOTICES;

export function isNoticeCode(value: string | null): value is NoticeCode {
  return value !== null && Object.hasOwn(NOTICES, value);
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

const STYLES = `
  :root { color-scheme: light; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f4f5; color: #18181b; }
  main { background: #fff; width: min(440px, calc(100vw - 32px)); padding: 28px; border-radius: 10px; box-shadow: 0 1px 4px rgb(0 0 0 / 0.08); }
  h1 { font-size: 1.3rem; margin: 0 0 12px; }
  h2 { font-size: 1rem; margin: 22px 0 8px; }
  p, li { line-height: 1.5; }
  label { display: block; font-weight: 600; margin: 12px 0 4px; }
  input[type=email], input[type=password], input[type=text] { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #d4d4d8; border-radius: 6px; font: inherit; }
  button { font: inherit; padding: 10px 16px; border-radius: 6px; border: 0; cursor: pointer; }
  button.primary { background: #16a34a; color: #fff; }
  button.primary:disabled { background: #a1a1aa; cursor: not-allowed; }
  button.secondary { background: #e4e4e7; color: #18181b; }
  .row { display: flex; gap: 10px; margin-top: 18px; }
  .row form { flex: 1; }
  .row button { width: 100%; }
  .notice { padding: 10px 12px; border-radius: 6px; margin-bottom: 14px; }
  .notice.ok { background: #dcfce7; }
  .notice.error { background: #fee2e2; }
  .muted { color: #52525b; font-size: 0.9rem; }
  code { background: #f4f4f5; padding: 1px 4px; border-radius: 4px; }
  ul { padding-left: 18px; }
`;

export const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
} as const;

function layout(title: string, body: string, notice?: NoticeCode): string {
  const noticeHtml = notice
    ? `<p class="notice ${NOTICES[notice].tone}" role="status">${escapeHtml(NOTICES[notice].text)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Documenso MCP</title>
<style>${STYLES}</style>
</head>
<body><main>${noticeHtml}${body}</main></body>
</html>`;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

function connectionSection(connection: DocumensoConnection | null, next: string): string {
  if (connection) {
    return `<h2>Documenso team</h2>
<p>Connected with the token ending in <code>${escapeHtml(connection.tokenHint)}</code>, checked ${escapeHtml(
      connection.verifiedAt.slice(0, 10),
    )}.</p>`;
  }

  return `<h2>Connect your Documenso team</h2>
<p class="muted">In Documenso, open <strong>Team settings → API tokens</strong>, create a token and paste it here.
It is checked with Documenso, then stored encrypted. Only your account can use it.</p>
<form method="post" action="/auth/documenso">
  ${hidden("next", next)}
  <label for="token">Team API token</label>
  <input id="token" name="token" type="password" autocomplete="off" required placeholder="api_...">
  <div class="row"><button class="primary" type="submit">Connect team</button></div>
</form>`;
}

export function signInPage(next: string, failed = false): string {
  const error = failed ? `<p class="notice error" role="alert">Wrong email or password.</p>` : "";

  return layout(
    "Sign in",
    `${error}<h1>Sign in</h1>
<p>Sign in to connect ChatGPT or Claude to your Documenso team.</p>
<form method="post" action="/auth/signin">
  ${hidden("next", next)}
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" required>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <div class="row"><button class="primary" type="submit">Sign in</button></div>
</form>`,
  );
}

type ConsentPageOptions = {
  authorizationId: string;
  clientName: string;
  redirectUri: string;
  scopes: string[];
  email: string | null;
  connection: DocumensoConnection | null;
  notice?: NoticeCode;
};

export function consentPage(options: ConsentPageOptions): string {
  const next = `/auth/consent?authorization_id=${options.authorizationId}`;
  const scopes = options.scopes.length
    ? `<ul>${options.scopes.map((scope) => `<li><code>${escapeHtml(scope)}</code></li>`).join("")}</ul>`
    : "";

  return layout(
    "Allow access",
    `<h1>Allow ${escapeHtml(options.clientName)}?</h1>
<p><strong>${escapeHtml(options.clientName)}</strong> wants to use your Documenso team through this server as
${escapeHtml(options.email ?? "your account")}. It will be able to list your team's documents and templates and read
their signing status.</p>
<p class="muted">After you decide, you will be sent back to <code>${escapeHtml(options.redirectUri)}</code>.</p>
${scopes}
${connectionSection(options.connection, next)}
<div class="row">
  <form method="post" action="/auth/consent">
    ${hidden("authorization_id", options.authorizationId)}${hidden("decision", "deny")}
    <button class="secondary" type="submit">Deny</button>
  </form>
  <form method="post" action="/auth/consent">
    ${hidden("authorization_id", options.authorizationId)}${hidden("decision", "approve")}
    <button class="primary" type="submit"${options.connection ? "" : " disabled"}>Allow</button>
  </form>
</div>`,
    options.notice,
  );
}

type AccountPageOptions = {
  email: string | null;
  connection: DocumensoConnection | null;
  grants: Grant[] | null;
  notice?: NoticeCode;
};

export function accountPage(options: AccountPageOptions): string {
  const next = "/auth/account";

  const disconnect = options.connection
    ? `<form method="post" action="/auth/documenso/disconnect">${hidden("next", next)}
<div class="row"><button class="secondary" type="submit">Disconnect team and delete token</button></div></form>`
    : "";

  let grants: string;

  if (options.grants === null) {
    grants = `<p class="muted">Connected applications could not be loaded.</p>`;
  } else if (options.grants.length === 0) {
    grants = `<p class="muted">No applications have access.</p>`;
  } else {
    grants = options.grants
      .map(
        (grant) => `<form method="post" action="/auth/grants/revoke">${hidden("client_id", grant.clientId)}
<p><strong>${escapeHtml(grant.clientName)}</strong>, allowed ${escapeHtml(grant.grantedAt.slice(0, 10))}</p>
<button class="secondary" type="submit">Revoke access</button></form>`,
      )
      .join("");
  }

  return layout(
    "Account",
    `<h1>Documenso MCP account</h1>
<p>Signed in as ${escapeHtml(options.email ?? "unknown")}.</p>
${connectionSection(options.connection, next)}
${disconnect}
<h2>Applications with access</h2>
${grants}
<form method="post" action="/auth/signout"><div class="row"><button class="secondary" type="submit">Sign out</button></div></form>`,
    options.notice,
  );
}

export function messagePage(title: string, text: string): string {
  return layout(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>`);
}
