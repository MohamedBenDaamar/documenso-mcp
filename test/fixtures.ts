import type { ConnectionStore, DocumensoConnection, UserSession } from "../src/connections/store.js";
import type { DocumensoClient } from "../src/documenso/client.js";

export const USER_A: UserSession = { id: "11111111-1111-4111-8111-111111111111", accessToken: "supabase-access-a" };
export const USER_B: UserSession = { id: "22222222-2222-4222-8222-222222222222", accessToken: "supabase-access-b" };

export const TOKEN_A = "api_teamatoken00000";
export const TOKEN_B = "api_teambtoken00000";

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

/** In-memory store keyed by user ID, recording calls. */
export function memoryStore(initial: Record<string, string> = {}) {
  const tokens = new Map(Object.entries(initial));
  const calls: { op: string; userId: string }[] = [];

  const store: ConnectionStore = {
    async get(user) {
      calls.push({ op: "get", userId: user.id });
      const token = tokens.get(user.id);
      return token ? ({ token, tokenHint: token.slice(-4), verifiedAt: "2026-09-29T10:00:00.000Z" } satisfies DocumensoConnection) : null;
    },
    async save(user, token) {
      calls.push({ op: "save", userId: user.id });
      tokens.set(user.id, token);
    },
    async remove(user) {
      calls.push({ op: "remove", userId: user.id });
      tokens.delete(user.id);
    },
  };

  return { store, tokens, calls };
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
