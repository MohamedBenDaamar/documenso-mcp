import { describe, expect, it } from "vitest";

import { ConnectionStoreError } from "../src/connections/store.js";
import { DocumensoError } from "../src/documenso/errors.js";
import {
  EnvelopeStatusOutputSchema,
  getEnvelopeStatus,
  listEnvelopes,
  ListEnvelopesOutputSchema,
  listTemplates,
  ListTemplatesOutputSchema,
  type EnvelopeToolDeps,
} from "../src/tools/envelopes.js";
import {
  envelopeFixture,
  fakeDocumenso,
  findResponse,
  memoryStore,
  RECIPIENT_SIGNING_TOKEN,
  TOKEN_A,
  TOKEN_B,
  USER_A,
  USER_B,
} from "./fixtures.js";

const ACCOUNT_URL = "https://mcp.example.com/auth/account";

function depsWith(documenso: ReturnType<typeof fakeDocumenso>, store = memoryStore({ [USER_A.id]: TOKEN_A }).store) {
  return { client: documenso.client, store, accountUrl: ACCOUNT_URL } satisfies EnvelopeToolDeps;
}

function everything(result: unknown): string {
  return JSON.stringify(result);
}

describe("list-envelopes", () => {
  it("calls Documenso with the caller's own token and paginates", async () => {
    const documenso = fakeDocumenso(() => findResponse([envelopeFixture()]));

    const result = await listEnvelopes(depsWith(documenso), USER_A, { page: 2, perPage: 5, status: "PENDING" });

    expect(result.isError).toBeFalsy();
    expect(documenso.requests).toEqual([
      { path: "/envelope?type=DOCUMENT&page=2&perPage=5&status=PENDING", token: TOKEN_A },
    ]);
  });

  it("returns only allowlisted fields and counts CC recipients out of progress", async () => {
    const documenso = fakeDocumenso(() => findResponse([envelopeFixture()]));

    const result = await listEnvelopes(depsWith(documenso), USER_A, { page: 1, perPage: 10 });

    if (result.isError) {
      throw new Error("expected success");
    }
    expect(ListEnvelopesOutputSchema.parse(result.structuredContent)).toEqual(result.structuredContent);
    expect(result.structuredContent.envelopes[0]).toEqual({
      id: "envelope_nuwxdimowvbthehz",
      title: "Envelope Full Field Test",
      status: "PENDING",
      createdAt: "2026-09-28T20:48:19.626Z",
      updatedAt: "2026-09-28T20:48:19.626Z",
      completedAt: null,
      progress: { total: 2, signed: 1, rejected: 0, pending: 1 },
    });
    expect(result.content[0]?.text).toContain("Envelope Full Field Test (PENDING, 1/2 signed)");
  });

  it("never exposes recipient signing tokens, owner details, form values or message text", async () => {
    const documenso = fakeDocumenso(() => findResponse([envelopeFixture()]));

    const serialized = everything(await listEnvelopes(depsWith(documenso), USER_A, { page: 1, perPage: 10 }));

    for (const secret of [RECIPIENT_SIGNING_TOKEN, "owner@example.com", "secret", "private message", TOKEN_A]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("tells a user with no connected team where to connect one, without calling Documenso", async () => {
    const documenso = fakeDocumenso(() => findResponse([]));

    const result = await listEnvelopes(depsWith(documenso), USER_B, { page: 1, perPage: 10 });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: `No Documenso team is connected to this account yet. Connect one at ${ACCOUNT_URL}, then try again.`,
        },
      ],
    });
    expect(documenso.requests).toEqual([]);
  });

  it("uses each user's own token, never another user's", async () => {
    const documenso = fakeDocumenso(() => findResponse([]));
    const store = memoryStore({ [USER_A.id]: TOKEN_A, [USER_B.id]: TOKEN_B }).store;

    await listEnvelopes(depsWith(documenso, store), USER_A, { page: 1, perPage: 10 });
    await listEnvelopes(depsWith(documenso, store), USER_B, { page: 1, perPage: 10 });

    expect(documenso.requests.map((request) => request.token)).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("asks the user to reconnect when Documenso rejects the saved token", async () => {
    const documenso = fakeDocumenso(() => {
      throw new DocumensoError("unauthorized", 401);
    });

    const result = await listEnvelopes(depsWith(documenso), USER_A, { page: 1, perPage: 10 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(`Connect a new token at ${ACCOUNT_URL}`);
  });

  it("reports storage failures without their details", async () => {
    const documenso = fakeDocumenso(() => findResponse([]));
    const failing = memoryStore().store;
    failing.get = async () => {
      throw new ConnectionStoreError();
    };

    const result = await listEnvelopes(depsWith(documenso, failing), USER_A, { page: 1, perPage: 10 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      `The Documenso connection could not be read or saved. Try again, or reconnect at ${ACCOUNT_URL}.`,
    );
  });

  it("hides unexpected errors behind a generic message", async () => {
    const documenso = fakeDocumenso(() => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432 at /srv/app/internal.ts");
    });

    const result = await listEnvelopes(depsWith(documenso), USER_A, { page: 1, perPage: 10 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Something went wrong while talking to Documenso." }],
    });
  });
});

describe("get-envelope-status", () => {
  it("returns recipient progress with masked emails and no signing tokens", async () => {
    const documenso = fakeDocumenso(() => envelopeFixture());

    const result = await getEnvelopeStatus(depsWith(documenso), USER_A, { envelopeId: "envelope_nuwxdimowvbthehz" });

    if (result.isError) {
      throw new Error("expected success");
    }
    expect(documenso.requests).toEqual([{ path: "/envelope/envelope_nuwxdimowvbthehz", token: TOKEN_A }]);
    expect(EnvelopeStatusOutputSchema.parse(result.structuredContent)).toEqual(result.structuredContent);
    expect(result.structuredContent.progress).toEqual({ total: 2, signed: 1, rejected: 0, pending: 1 });
    expect(result.structuredContent.recipients.map((recipient) => recipient.email)).toEqual([
      "ex***@documenso.com",
      "se***@example.com",
      "cc***@example.com",
    ]);

    const serialized = everything(result);
    for (const secret of [RECIPIENT_SIGNING_TOKEN, "SC_second_signing_token", "second.signer@example.com", "owner@example.com"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("returns the same not-found message for another team's envelope as for a missing one", async () => {
    const documenso = fakeDocumenso(() => {
      throw new DocumensoError("not_found_or_forbidden", 404);
    });

    const result = await getEnvelopeStatus(depsWith(documenso), USER_A, { envelopeId: "envelope_oztivihvcuexaaxa" });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "That Documenso item does not exist or your team cannot access it." }],
    });
  });
});

describe("list-templates", () => {
  it("lists templates with recipient roles but no placeholder emails", async () => {
    const documenso = fakeDocumenso(() => findResponse([envelopeFixture({ type: "TEMPLATE", status: "DRAFT" })]));

    const result = await listTemplates(depsWith(documenso), USER_A, { page: 1, perPage: 10 });

    if (result.isError) {
      throw new Error("expected success");
    }
    expect(documenso.requests[0]?.path).toBe("/envelope?type=TEMPLATE&page=1&perPage=10");
    expect(ListTemplatesOutputSchema.parse(result.structuredContent)).toEqual(result.structuredContent);
    expect(result.structuredContent.templates[0]?.recipients).toEqual([
      { id: 21, role: "SIGNER", label: "Example User" },
      { id: 22, role: "SIGNER", label: "Second Signer" },
      { id: 23, role: "CC", label: "Copied Person" },
    ]);
    expect(everything(result)).not.toContain("@");
  });
});
