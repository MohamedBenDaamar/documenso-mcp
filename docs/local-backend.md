# Running Documenso locally as the test backend

This server needs the [Documenso fork](https://github.com/MohamedBenDaamar/documenso) with the OAuth authorization server ([OAUTH.md](https://github.com/MohamedBenDaamar/documenso/blob/main/OAUTH.md)). Stock Documenso has no OAuth server, so MCP clients could not sign in.

These steps were first tested against upstream commit `a1d4bec` (2026-09-26), and the fork against upstream v2.19.0, on macOS with Docker 29.1.3.

**Use Node 24 LTS and npm 11.17 or newer.** Node 25 breaks `prisma generate`: `zod-prisma-types` calls `fs.rmdirSync(path, { recursive: true })`, which Node 25 removed. The error is `The property 'options.recursive' is no longer supported`. npm 12 does not support Node 25 either.

```bash
git clone https://github.com/MohamedBenDaamar/documenso.git
cd documenso
cp -n .env.example .env

# Allow this MCP server as an OAuth resource. The OAuth server is off without it.
echo 'NEXT_PRIVATE_OAUTH_RESOURCES="http://localhost:3100/mcp"' >> .env

npm ci

# Start only Postgres, Inbucket (mail) and Redis.
# We skip MinIO: minio/minio is no longer published on Docker Hub, and the default
# .env uses NEXT_PUBLIC_UPLOAD_TRANSPORT="database", so S3 is not needed.
# We also skip Gotenberg: NEXT_PRIVATE_DOCUMENT_CONVERSION_URL is commented out by default.
docker compose -f docker/development/compose.yml up -d database inbucket redis

npm run prisma:migrate-dev
npm run prisma:seed

npm run dev
```

| Service | URL |
|---|---|
| Documenso app | http://localhost:3000 |
| Test inbox (Inbucket) | http://localhost:9000 |
| Postgres | `localhost:54320` (user `documenso`, password `password`) |
| API v2 spec | http://localhost:3000/api/v2/openapi.json |

Seeded test accounts (local only), both with password `password`:
- `example@documenso.com`
- `admin@documenso.com`

All outgoing email lands in Inbucket, so nothing reaches a real inbox.

Check that the OAuth server is on:

```bash
curl -s http://localhost:3000/.well-known/oauth-authorization-server
```

It should print JSON starting with `{"issuer":"http://localhost:3000"`. A `404` means `NEXT_PRIVATE_OAUTH_RESOURCES` is not set.

## Accounts for the flow check

`scripts/check-oauth-flow.ts` signs in with two ordinary accounts in different teams. Sign up two users in the Documenso UI (confirm their emails in Inbucket), or use the seeded `example@documenso.com` for user A. Put the credentials in `.env.test.local` as shown in [`.env.test.example`](../.env.test.example).
