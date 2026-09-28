# Running Documenso locally as the test backend

These steps are tested against upstream commit `a1d4bec` (2026-09-26) on macOS with Docker 29.1.3.

**Use Node 24 LTS and npm 11.17 or newer.** Node 25 breaks `prisma generate`: `zod-prisma-types` calls `fs.rmdirSync(path, { recursive: true })`, which Node 25 removed. The error is `The property 'options.recursive' is no longer supported`. npm 12 does not support Node 25 either.

```bash
git clone https://github.com/documenso/documenso.git
cd documenso
git remote rename origin upstream
cp -n .env.example .env

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
