# Deploying to Manufact

The server is deployed from this GitHub repository with the Manufact GitHub App, which is installed on this repository only.

- MCP endpoint: `https://keen-wave-4xpwv.run.mcp-use.com/mcp`
- Build: `npm run build` (`mcp-use build`: server plus the `signing-status` View)
- Start: `npm start` (`mcp-use start`, `NODE_ENV=production`)

## First deployment

```bash
npx mcp-use login
npx mcp-use deploy --name documenso-mcp --env-file .env.production --yes
npx mcp-use deployments get <deployment-id>
npx mcp-use deployments logs <deployment-id> --build
```

`.env.production` is git-ignored and holds:

| Variable | Value |
|---|---|
| `DOCUMENSO_URL` | Public URL of the Documenso instance |
| `DOCUMENSO_TIMEOUT_MS` | `15000` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_…`), never the secret key |
| `CONNECTION_ENCRYPTION_KEY` | 32 random bytes, base64, **different from development** |

- **`MCP_URL` is set by Manufact** (the published OAuth resource is `https://keen-wave-4xpwv.run.mcp-use.com/mcp`). The server refuses to start in production without an `https://` `MCP_URL`.
- The **EU region** needs a paid Manufact plan, so the free plan uses the default region.
- To change a variable later: `npx mcp-use servers env set <server-id> KEY=VALUE --secret`, then `npx mcp-use deploy`.

## Supabase

- **Authentication → URL Configuration → Site URL:** `https://keen-wave-4xpwv.run.mcp-use.com`
- **Authentication → OAuth Server → Authorization Path:** `/auth/consent`

Supabase has one Site URL per project, so while it points at production, local sign-ins also land on the deployed consent page. A separate Supabase project for local development avoids this.

## Documenso for the demo

The deployed server reaches the local Documenso test instance through an ngrok tunnel:

```bash
ngrok http 3000 --host-header=rewrite
```

- `--host-header=rewrite` is required because Documenso's Vite dev server rejects unknown `Host` headers.
- ngrok's free-plan browser warning does not affect server-to-server calls: Node `fetch` gets HTTP 200.
- Tokens linked in development cannot be decrypted with the production key. The server treats them as "not connected" (logged as `{"event":"connection_undecryptable"}`), and users link a token again on the consent page.

## Verifying a deployment

```bash
./scripts/check-auth-wiring.sh https://keen-wave-4xpwv.run.mcp-use.com
```

Result on the first deployment: 12 PASS, 1 WARN (the known mcp-use `kid` issue), 0 FAIL. `documenso-health` through Manufact → ngrok → Documenso returned `status: ok`.
