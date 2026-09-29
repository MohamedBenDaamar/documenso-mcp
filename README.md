# documenso-mcp

A team-scoped [MCP](https://modelcontextprotocol.io) server for [Documenso](https://github.com/documenso/documenso), built with [mcp-use](https://docs.mcp-use.com). It lets ChatGPT and Claude list, inspect, prepare and send Documenso envelopes for the caller's own team.

> **Status: work in progress.** The read-only tools and sign-in are done; drafting and sending are next. This is an independent project, not an official Documenso integration. See [ADR 0001](docs/adr/0001-external-adapter.md) for why it is a separate adapter.

## Tools

| Tool | Sign-in | Behavior |
|---|---|---|
| `documenso-health` | Not required | Server version and Documenso reachability. No team data. |
| `list-envelopes` | Required | The caller's team documents, filterable by status and text, paginated. |
| `get-envelope-status` | Required | Signing progress of one envelope. Recipient emails are masked. |
| `list-templates` | Required | Team templates and the recipient roles each expects. |
| `prepare-from-template`, `preview-distribution`, `distribute-envelope` | Planned | Draft first; sending requires an explicit, single-use confirmation. |

## How access works

Users sign in through Supabase (OAuth 2.1 with dynamic client registration), then link **their own** Documenso team API token on the consent page. The token is checked with Documenso, encrypted with AES-256-GCM and stored in a Supabase table that row level security limits to its owner. Every Documenso call uses the caller's own token, so Documenso's team boundaries apply. There is no shared token and no Supabase admin key on the server. Details: [docs/auth.md](docs/auth.md).

## Run locally

Requirements: Node 24, a Documenso instance ([docs/local-backend.md](docs/local-backend.md)) and a Supabase project.

1. In Supabase, enable **Authentication → OAuth Server** with dynamic client registration, set the **Authorization Path** to `/auth/consent` and the **Site URL** to `http://localhost:3100`.
2. Run [`supabase/migrations/20260929000000_documenso_connections.sql`](supabase/migrations/20260929000000_documenso_connections.sql) in the Supabase SQL editor.
3. Configure and start:

```bash
npm ci
cp .env.example .env
npm run dev
```

Fill in `.env` from [.env.example](.env.example). `CONNECTION_ENCRYPTION_KEY` is 32 random bytes in base64.

- MCP endpoint: http://localhost:3100/mcp
- Account page: http://localhost:3100/auth/account
- Inspector: http://localhost:3100/mcp/inspector

## Checks

```bash
npm run typecheck
npm test
./scripts/check-team-isolation.sh
./scripts/check-auth-wiring.sh
```

- `check-team-isolation.sh` checks Documenso's own team boundaries with two team API tokens.
- `check-auth-wiring.sh` checks the running server's sign-in boundary over HTTP: public health tool, 401 for Documenso tools without a valid token, cross-site form posts blocked.

## Security notes

- Documenso error bodies, which include stack traces and server paths in development, are never forwarded to the model (`src/documenso/errors.ts`).
- Documenso returns each recipient's signing token in envelope responses. Tools output only allowlisted fields, so signing tokens never reach the model ([docs/api-map.md](docs/api-map.md)).
- Redirects from Documenso are refused, so a token is never sent to another host.
- Consent and account pages: HttpOnly SameSite=Lax session cookie, an Origin check on every form post (with a `Sec-Fetch-Site: same-origin` fallback when a browser withholds Origin), strict CSP with `frame-ancestors 'none'`, and a fixed allowlist for post-login redirects.

## License

MIT
