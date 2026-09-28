# documenso-mcp

A team-scoped [MCP](https://modelcontextprotocol.io) server for [Documenso](https://github.com/documenso/documenso), built with [mcp-use](https://docs.mcp-use.com). It lets ChatGPT and Claude list, inspect, prepare and send Documenso envelopes for the caller's own team.

> **Status: early work in progress.** Only a health tool exists so far. This is an independent project, not an official Documenso integration. See [ADR 0001](docs/adr/0001-external-adapter.md) for why it is a separate adapter.

## Tools

| Tool | Status | Behavior |
|---|---|---|
| `documenso-health` | Done | Reports server version and Documenso reachability. Returns no team data and needs no Documenso connection. |
| `list-envelopes`, `get-envelope-status`, `list-templates` | Planned | Read-only, scoped to the caller's team. |
| `prepare-from-template`, `preview-distribution`, `distribute-envelope` | Planned | Draft first; sending requires an explicit, single-use confirmation. |

## Run locally

Requirements: Node 24, and a Documenso instance (see [docs/local-backend.md](docs/local-backend.md)).

```bash
npm ci
cp .env.example .env
npm run dev
```

- MCP endpoint: http://localhost:3100/mcp
- Inspector: http://localhost:3100/mcp/inspector

Call the server from a terminal:

```bash
npx mcp-use client connect local http://localhost:3100/mcp --no-oauth
npx mcp-use client local tools list
npx mcp-use client local tools call documenso-health
```

## Checks

```bash
npm run typecheck
npm test
./scripts/check-team-isolation.sh
```

`check-team-isolation.sh` checks Documenso's own team boundaries with two team API tokens; see [docs/api-map.md](docs/api-map.md).

## Security notes

- There is no shared Documenso token on the server. Every Documenso call requires the calling user's own team token.
- Documenso error bodies, which include stack traces and server paths in development, are never forwarded to the model. The client maps them to fixed messages (`src/documenso/errors.ts`).
- Redirects from Documenso are refused, so a token is never sent to another host.

## License

MIT
