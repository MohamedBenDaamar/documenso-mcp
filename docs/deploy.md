# Deploying

Two things are deployed: this MCP server (on [Manufact](#mcp-server-on-manufact) or [with Docker](#self-hosting-with-docker)), and the [Documenso fork](https://github.com/MohamedBenDaamar/documenso) it uses as its authorization server. Each must know the other's public URL.

| Side | Setting | Value |
|---|---|---|
| Documenso | `NEXT_PUBLIC_WEBAPP_URL` | Documenso's public https URL, e.g. `https://sign.example.com` |
| Documenso | `NEXT_PRIVATE_OAUTH_RESOURCES` | This server's MCP endpoint, e.g. `https://mcp.example.com/mcp` |
| MCP server | `DOCUMENSO_URL` | Exactly Documenso's `NEXT_PUBLIC_WEBAPP_URL` (it is the OAuth issuer) |
| MCP server | `MCP_URL` | This server's public https origin, e.g. `https://mcp.example.com` |
| MCP server | `DOCUMENSO_TIMEOUT_MS` | Optional, default `10000` |

In production the server refuses to start unless both `MCP_URL` and `DOCUMENSO_URL` are `https://`.

Documenso's URL must be **stable**. Users' browsers are sent to its sign-in and consent pages, and every registered client remembers its endpoints, so changing it disconnects everyone. A temporary tunnel URL is not enough for a demo that has to stay up.

## MCP server on Manufact

The server deploys from this GitHub repository with the Manufact GitHub App.

- Current endpoint: `https://keen-wave-4xpwv.run.mcp-use.com/mcp`
- Build: `npm run build` (`mcp-use build`: server plus the `signing-status` View)
- Start: `npm start` (`mcp-use start`, `NODE_ENV=production`)

```bash
npx mcp-use login
npx mcp-use deploy --name documenso-mcp --env-file .env.production --yes
npx mcp-use deployments logs <deployment-id> --build
```

- `.env.production` is git-ignored and holds `DOCUMENSO_URL` (and optionally `DOCUMENSO_TIMEOUT_MS`).
- **`MCP_URL` is set by Manufact.**
- To change a variable later: `npx mcp-use servers env set <server-id> KEY=VALUE`, then `npx mcp-use deploy`.
- Moving from v0.2.0: delete `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `CONNECTION_ENCRYPTION_KEY` from the server's environment. They are no longer read. The Supabase project and its `documenso_connections` table can be deleted.

## Self-hosting with Docker

[`docker/Dockerfile`](../docker/Dockerfile) builds a small production image (Node 24, non-root) that runs `mcp-use start --with-inspector` on port 3000:

```bash
docker build -f docker/Dockerfile -t documenso-mcp .
docker run -p 127.0.0.1:3311:3000 \
  -e DOCUMENSO_URL=https://sign.example.com \
  -e MCP_URL=https://mcp.example.com \
  documenso-mcp
```

Put it behind a TLS reverse proxy. MCP responses are streamed as server-sent events, so turn off response buffering and allow long-lived connections; for nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3311;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection        "";
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

Behind a proxy, open the Inspector with the public URL spelled out (`/mcp/inspector?server=https%3A%2F%2Fmcp.example.com%2Fmcp`). Without it, the Inspector builds the server address from the proxied request and tries plain `http://`.

### The live demo

`https://documenso-mcp.unheld.io` runs this way on a VPS, next to the Documenso fork at `https://documenso.unheld.io`: one Docker Compose project with three containers (Documenso, its Postgres, and this server), each bound to localhost, behind nginx and Cloudflare. Documenso's `NEXT_PRIVATE_OAUTH_RESOURCES` lists both MCP deployments, this one and Manufact's.

## Documenso

Run the fork like any self-hosted Documenso ([Documenso's self-hosting docs](https://docs.documenso.com/docs/self-hosting)), from the fork's branch with the OAuth server, then:

1. Set `NEXT_PRIVATE_OAUTH_RESOURCES` to this server's MCP endpoint.
2. Apply the database migrations (`npm run prisma:migrate-deploy`).
3. Check `https://<documenso>/.well-known/oauth-authorization-server` returns the metadata.

The fork is AGPL-3.0: users of a public instance must be able to get its source, which the public fork repository provides.

## Verifying a deployment

```bash
./scripts/check-auth-wiring.sh https://mcp.example.com
node --env-file=.env.test.local scripts/check-oauth-flow.ts https://mcp.example.com
```

The first needs no credentials. The second signs in with two test accounts on the deployed Documenso and runs the whole flow, including team isolation and revocation.
