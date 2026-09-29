import { describe, expect, it } from "vitest";

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
  RECIPIENT_SIGNING_TOKEN,
  TOKEN_A,
  TOKEN_B,
} from "./fixtures.js";

function depsWith(documenso: ReturnType<typeof fakeDocumenso>) {
  return { client: documenso.client } satisfies EnvelopeToolDeps;
}

function everything(result: unknown): string {
  return JSON.stringify(result);
}

describe("list-envelopes", () => {
  it("calls Documenso with the caller's own token and paginates", async () => {
    const documenso = fakeDocumenso(() => findResponse([envelopeFixture()]));

    const result = await listEnvelopes(depsWith(documenso), TOKEN_A, { page: 2, perPage: 5, status: "PENDING" });

    expect(result.isError).toBeFalsy();
    expect(documenso.requests).toEqual([
      { path: "/envelope?type=DOCUMENT&page=2&perPage=5&status=PENDING", token: TOKEN_A },
    ]);
  });

  it("returns only allowlisted fields and counts CC recipients out of progress", async () => {
    const documenso = fakeDocumenso(() => findResponse([envelopeFixture()]));

    const result = await listEnvelopes(depsWith(documenso), TOKEN_A, { page: 1, perPage: 10 });

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

    const serialized = everything(await listEnvelopes(depsWith(documenso), TOKEN_A, { page: 1, perPage: 10 }));

    for (const secret of [RECIPIENT_SIGNING_TOKEN, "owner@example.com", "secret", "private message", TOKEN_A]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("refuses without calling Documenso when the request carries no token", async () => {
    const documenso = fakeDocumenso(() => findResponse([]));

    const result = await listEnvelopes(depsWith(documenso), undefined, { page: 1, perPage: 10 });

    expect(result).toEqual({ isError: true, content: [{ type: "text", text: "Connect Documenso to use this tool." }] });
    expect(documenso.requests).toEqual([]);
  });

  it("uses each caller's own token, never another caller's", async () => {
    const documenso = fakeDocumenso(() => findResponse([]));

    await listEnvelopes(depsWith(documenso), TOKEN_A, { page: 1, perPage: 10 });
    await listEnvelopes(depsWith(documenso), TOKEN_B, { page: 1, perPage: 10 });

    expect(documenso.requests.map((request) => request.token)).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("asks the user to reconnect when Documenso rejects the token", async () => {
    const documenso = fakeDocumenso(() => {
      throw new DocumensoError("unauthorized", 401);
    });

    const result = await listEnvelopes(depsWith(documenso), TOKEN_A, { page: 1, perPage: 10 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Reconnect Documenso");
  });

  it("hides unexpected errors behind a generic message", async () => {
    const documenso = fakeDocumenso(() => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432 at /srv/app/internal.ts");
    });

    const result = await listEnvelopes(depsWith(documenso), TOKEN_A, { page: 1, perPage: 10 });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "Something went wrong while talking to Documenso." }],
    });
  });
});

describe("get-envelope-status", () => {
  it("returns recipient progress with masked emails and no signing tokens", async () => {
    const documenso = fakeDocumenso(() => envelopeFixture());

    const result = await getEnvelopeStatus(depsWith(documenso), TOKEN_A, { envelopeId: "envelope_nuwxdimowvbthehz" });

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

  it("masks recipient names that are email addresses (found testing the View in ChatGPT)", async () => {
    const fixture = envelopeFixture();
    fixture.recipients[1] = { ...fixture.recipients[1], name: "second.signer@example.com" };
    const documenso = fakeDocumenso(() => fixture);

    const result = await getEnvelopeStatus(depsWith(documenso), TOKEN_A, { envelopeId: "envelope_nuwxdimowvbthehz" });

    if (result.isError) {
      throw new Error("expected success");
    }
    expect(result.structuredContent.recipients[1]).toMatchObject({ name: "se***@example.com", email: "se***@example.com" });
    expect(everything(result)).not.toContain("second.signer@example.com");
  });

  it("reports a signing time only for recipients who have signed", async () => {
    const fixture = envelopeFixture();
    fixture.recipients[1] = { ...fixture.recipients[1], signedAt: "2026-09-28T20:48:19.626Z" };
    const documenso = fakeDocumenso(() => fixture);

    const result = await getEnvelopeStatus(depsWith(documenso), TOKEN_A, { envelopeId: "envelope_nuwxdimowvbthehz" });

    if (result.isError) {
      throw new Error("expected success");
    }
    expect(result.structuredContent.recipients.map((recipient) => [recipient.signingStatus, recipient.signedAt])).toEqual([
      ["SIGNED", "2026-09-28T21:00:00.000Z"],
      ["NOT_SIGNED", null],
      ["NOT_SIGNED", null],
    ]);
  });

  it("returns the same not-found message for another team's envelope as for a missing one", async () => {
    const documenso = fakeDocumenso(() => {
      throw new DocumensoError("not_found_or_forbidden", 404);
    });

    const result = await getEnvelopeStatus(depsWith(documenso), TOKEN_A, { envelopeId: "envelope_oztivihvcuexaaxa" });

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "That Documenso item does not exist or your team cannot access it." }],
    });
  });
});

describe("list-templates", () => {
  it("lists templates with recipient roles but no placeholder emails", async () => {
    const documenso = fakeDocumenso(() => findResponse([envelopeFixture({ type: "TEMPLATE", status: "DRAFT" })]));

    const result = await listTemplates(depsWith(documenso), TOKEN_A, { page: 1, perPage: 10 });

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
