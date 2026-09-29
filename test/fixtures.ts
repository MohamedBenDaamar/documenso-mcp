import type { DocumensoClient } from "../src/documenso/client.js";

// Documenso OAuth access tokens, one per user and team.
export const TOKEN_A = "doa_teamAtoken0000000000000000000000000000";
export const TOKEN_B = "doa_teamBtoken0000000000000000000000000000";

// Shaped like a real GET /api/v2/envelope/{id} response, including the fields that must never reach the model.
export const RECIPIENT_SIGNING_TOKEN = "SC_48aooSk2z-bsPOojz2";

export function envelopeFixture(overrides: Record<string, unknown> = {}) {
  return {
    internalVersion: 2,
    type: "DOCUMENT",
    status: "PENDING",
    source: "DOCUMENT",
    visibility: "EVERYONE",
    id: "envelope_nuwxdimowvbthehz",
    secondaryId: "document_14",
    createdAt: "2026-09-28T20:48:19.626Z",
    updatedAt: "2026-09-28T20:48:19.626Z",
    completedAt: null,
    title: "Envelope Full Field Test",
    authOptions: { accessAuth: ["ACCOUNT"] },
    formValues: { salary: "secret" },
    userId: 3,
    teamId: 3,
    user: { id: 3, name: "Owner Person", email: "owner@example.com" },
    team: { id: 3, name: "Team A" },
    documentMeta: { message: "private message", redirectUrl: "https://internal.example" },
    recipients: [
      {
        envelopeId: "envelope_nuwxdimowvbthehz",
        role: "SIGNER",
        readStatus: "OPENED",
        signingStatus: "SIGNED",
        sendStatus: "SENT",
        id: 21,
        email: "example@documenso.com",
        name: "Example User",
        token: RECIPIENT_SIGNING_TOKEN,
        signedAt: "2026-09-28T21:00:00.000Z",
        signingOrder: null,
        authOptions: null,
      },
      {
        envelopeId: "envelope_nuwxdimowvbthehz",
        role: "SIGNER",
        readStatus: "NOT_OPENED",
        signingStatus: "NOT_SIGNED",
        sendStatus: "SENT",
        id: 22,
        email: "second.signer@example.com",
        name: "Second Signer",
        token: "SC_second_signing_token",
        signedAt: null,
        signingOrder: null,
        authOptions: null,
      },
      {
        envelopeId: "envelope_nuwxdimowvbthehz",
        role: "CC",
        readStatus: "NOT_OPENED",
        signingStatus: "NOT_SIGNED",
        sendStatus: "NOT_SENT",
        id: 23,
        email: "cc@example.com",
        name: "Copied Person",
        token: "SC_cc_token",
        signedAt: null,
        signingOrder: null,
        authOptions: null,
      },
    ],
    ...overrides,
  };
}

export function findResponse(data: unknown[]) {
  return { data, count: data.length, currentPage: 1, perPage: 10, totalPages: 1 };
}

/** Documenso client double that answers per token, like Documenso's team-scoped API. */
export function fakeDocumenso(handler: (path: string, token: string) => unknown) {
  const requests: { path: string; token: string }[] = [];

  const client: DocumensoClient = {
    async getHealth() {
      return { status: "ok", checks: { database: { status: "ok" }, certificate: { status: "ok" } }, latencyMs: 1 };
    },
    async request({ path, token, schema }) {
      requests.push({ path, token });
      return schema.parse(handler(path, token));
    },
  };

  return { client, requests };
}
