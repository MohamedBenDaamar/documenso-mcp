# ADR 0002: Use Documenso itself as the OAuth authorization server

**Status:** Accepted, 2026-09-29. Supersedes the authentication part of [ADR 0001](0001-external-adapter.md).

## Context

In v0.2.0, users signed in to this server through a separate Supabase account, then pasted a Documenso team API token on a consent page. That worked, but it had four problems:

1. **Two accounts and a copied secret.** Connecting from Claude or ChatGPT meant creating a Supabase account and copying an API token out of Documenso's settings. Products such as GitHub and ClickUp connect in one click because they run their own OAuth server.
2. **Weak identity link.** The server could check that a pasted token worked, but not that it belonged to the person signed in to Supabase. The real guarantee was "access is limited to whatever token was pasted".
3. **Narrow onboarding.** Documenso only lets team admins and managers create API tokens, so ordinary members could not connect at all.
4. **No permission boundary for writes.** Supabase's OAuth server only issues OpenID scopes. Adding send tools under the same grant would have widened what already-connected clients could do without asking the user again.

ADR 0001 ruled out changing Documenso, because upstream does not accept external pull requests and has no OAuth server. That is still true, but a fork removes the obstacle: the OAuth server can live in [MohamedBenDaamar/documenso](https://github.com/MohamedBenDaamar/documenso) ([OAUTH.md](https://github.com/MohamedBenDaamar/documenso/blob/main/OAUTH.md)).

## Decision

- **Documenso is the authorization server.** The fork implements OAuth 2.1 for MCP: metadata (RFC 8414), dynamic client registration (RFC 7591), PKCE `S256`, resource indicators (RFC 8707), rotating refresh tokens and revocation. Users approve access on Documenso's consent page, for one team, with explicit scopes (`envelopes:read`, `envelopes:write`, `envelopes:send`).
- **This server is only a resource server.** It advertises Documenso in its protected resource metadata, and it validates each bearer token with Documenso's `tokeninfo` endpoint (`src/auth/documenso-oauth.ts`):
  - the token must be active,
  - its `aud` must be this server's resource URL, so a token granted to another MCP server that trusts the same Documenso is refused here,
  - results are cached for at most 30 seconds, and never past the token's expiry.
- **The verified token is used for Documenso calls.** Documenso issued it for its own API, and the API enforces the team, the scopes and the user's role on every call. This server stores no tokens at all.
- **Supabase and token linking are removed.** Their pages, the encrypted connection table and `CONNECTION_ENCRYPTION_KEY` are gone. The old flow is kept at the `v0.2.0` tag.
- **Everything else in ADR 0001 stands:** this is a separate MIT project that talks to Documenso only over HTTP, with allowlisted output and safe error messages.

## Consequences

- One-click connection: add the connector, sign in to Documenso, choose a team, allow.
- Identity is Documenso's: the token acts for the Documenso user who approved it, and audit logs name that user. Any team member can connect, and their role still limits what they see.
- Write and send tools can require `envelopes:write` or `envelopes:send`. A client with only `envelopes:read` gets `403 insufficient_scope` and must send the user back to the consent page, so existing grants never gain new powers silently.
- Revocation is Documenso's: Settings → Security → Connected apps, the revocation endpoint, or leaving the team. Documenso refuses the token immediately; this server stops accepting it within 30 seconds.
- **It only works with the fork.** Stock self-hosted Documenso and documenso.com have no OAuth server. Supporting them again would mean bringing back a token-based mode.
- The fork is AGPL-3.0 and must stay public when deployed; users of a hosted instance must be able to get its source.
- Documenso must be reachable at a stable public HTTPS URL, because users' browsers are sent to its sign-in and consent pages and registered clients remember its endpoints.
- Each new token costs one `tokeninfo` call (then cached). If Documenso is down, requests fail closed.
