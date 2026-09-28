# Documenso API map

Pinned to upstream commit [`a1d4bec`](https://github.com/documenso/documenso/tree/a1d4bec1430a937395db9a4aae28979cd71c2831) (2026-09-26).
Base URL: `<DOCUMENSO_URL>/api/v2`. Full spec: `GET /api/v2/openapi.json`.

## Authentication and team scope

- Header: `Authorization: Bearer api_xxx` (or the bare token).
- An API token belongs to exactly one **team** and one **user**. The team comes from the token itself, not from a request header (`packages/trpc/server/trpc.ts`).
- Token lookup rejects disabled users, disabled organisation owners, and expired tokens (`packages/lib/server-only/public-api/get-api-token-by-token.ts`).
- On each request, handlers call `getTeamById({ userId, teamId })`, which checks membership again. If the token's user is removed from the team, the token stops working immediately.
- Envelope visibility is filtered by the caller's team role, and owners always see their own envelopes (`packages/lib/server-only/envelope/find-envelopes.ts`).
- Rate limiting is per organisation (`assertOrganisationRatesAndLimits`).
- Only team `ADMIN` or `MANAGER` members can **create** a token (`MANAGE_TEAM` check in `packages/lib/server-only/public-api/create-api-token.ts`). A plain `MEMBER` cannot create one. Once a token exists, its access follows the user's *current* role and membership, so a demoted or removed user loses access.

## Endpoints used by the MCP server

| MCP tool | Method and path | Notes |
|---|---|---|
| `list-envelopes` | `GET /envelope?type=DOCUMENT&status=&query=&page=&perPage=` | Paginated (`ZFindSearchParamsSchema`). Filters: `type`, `status`, `source`, `templateId`, `folderId`. |
| `list-templates` | `GET /envelope?type=TEMPLATE` | `/template*` endpoints are deprecated. |
| `get-envelope-status` | `GET /envelope/{envelopeId}` | Returns `ZEnvelopeSchema`, including recipients. The MCP server strips PII before responding. |
| `prepare-from-template` | `POST /envelope/use` (multipart, `payload` JSON) | Set `distributeDocument: false` to create a draft. The **response includes recipient signing URLs**, which must never reach the model. |
| `preview-distribution` | `GET /envelope/{envelopeId}` | Read only. |
| `distribute-envelope` | `POST /envelope/distribute` `{ envelopeId, meta? }` | The response includes signing URLs, so strip them. See the send semantics below. |
| `download-completed` | `GET /envelope/item/{envelopeItemId}/download` | Stream through an authorized, short-lived MCP link. Never expose the API token. |

Envelope IDs are prefixed strings (`envelope_…`, `packages/lib/universal/id.ts`).

## Observed team isolation (2026-09-28)

Tested with `scripts/check-team-isolation.sh` against a local instance, using two teams, each with its own API token.

| Case | Result |
|---|---|
| Each token lists envelopes | Only its own team's envelopes (`teamId` 3 vs 4) |
| Token A asks for a Team B envelope ID | `404 Envelope could not be found`, the same as for an ID that doesn't exist, so nothing leaks about whether it exists |
| Token A sends `x-team-id: 4` | Ignored: the team comes from the token |
| Token A distributes a Team B envelope | Denied, and the envelope stays `DRAFT` / `NOT_SENT` |
| Made-up or missing token | `401` |

Two consequences for the MCP server:

- **Status codes are inconsistent.** A cross-team distribute is refused with **HTTP 500** `Document not found`: `sendDocument` throws a plain `Error`, not an `AppError`. The MCP server must not treat 500 as "retry". It maps it to a safe "not found or not allowed" error.
- **Error bodies include stack traces and absolute server paths** in dev mode. The MCP server never forwards Documenso's raw error bodies to the model. It returns its own short error messages.

## Send semantics (`sendDocument`)

Source: `packages/lib/server-only/document/send-document.ts`.

- Completed envelopes are rejected.
- A `PENDING` envelope is **not** rejected. A second call:
  - skips recipients whose `sendStatus` is already `SENT`, so it sends no duplicate email in the sequential case, but
  - fires the `DOCUMENT_SENT` webhook again, and
  - has no lock, so two concurrent calls can both see `NOT_SENT` and queue duplicate signing emails.
- Conclusion: Documenso gives the MCP server no idempotency guarantee. The server needs its own single-use confirmation token plus a per-envelope lock, and must re-read the envelope state before calling distribute.
