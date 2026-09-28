# ADR 0001: Build the MCP server as a separate adapter, not inside a Documenso fork

**Status:** Accepted, 2026-09-28

## Context

We want a remote MCP server that lets ChatGPT and Claude users list, inspect, prepare and send Documenso envelopes for their own team, with per-user authorization.

What we found in upstream Documenso (commit `a1d4bec`):

1. **External PRs are closed.** `CONTRIBUTING.md` says: "We are no longer accepting external pull requests." Upstream work would only happen by invitation.
2. **Documenso cannot issue tokens to other apps.** `packages/auth` only lets users sign in with Google or OIDC. There is no authorization server. MCP remote auth needs one: protected-resource metadata, PKCE, client registration, and access tokens bound to one audience. A native integration would mean adding that to Documenso's auth code, which is a large, security-sensitive change that could not be upstreamed.
3. **The public API is already per team.** v2 API tokens belong to one team and one user, and Documenso checks team membership and role visibility on every request (see [api-map.md](../api-map.md)).
4. **It is a large monorepo.** Deploying a sub-app to Manufact would add Prisma, Remix and shared-package build weight to a server that only needs HTTP calls.

## Decision

Build `documenso-mcp` as a standalone TypeScript server using `mcp-use`, deployed on Manufact. It talks to Documenso **only** through `/api/v2`.

- **MCP identity:** the MCP server has its own OAuth provider for sign-in. That login is *not* Documenso OAuth and is never presented as such.
- **Linking to Documenso:** after signing in, a user links a Documenso **team API token** they created. It is stored encrypted and keyed by (MCP subject, team). Users can unlink it, and revoking the MCP grant deletes the stored token.
- **Authorization:** Documenso remains the source of truth. Every tool call uses the linked token of the calling user. We never use a shared or global token for multiple users, and we never forward an MCP access token to Documenso.
- **Output:** results are kept minimal. Signing URLs, API tokens and PDF bytes never appear in model-visible content or logs.

## Consequences

- Deployment and review are simple. Documenso stays unmodified and runs as a self-hosted test backend.
- Users need an extra step to link a token. Its permissions are those of the team member who created it, which is Documenso's model, not ours.
- Documenso does not make distribution idempotent, so the MCP server must add confirmation tokens and locking.
- Because the adapter calls Documenso only over HTTP and includes none of its code, the AGPL does not extend to it.
- If Documenso maintainers later invite a native integration, the tool contract and tests can move over, with Documenso's own auth replacing the token-linking step.
