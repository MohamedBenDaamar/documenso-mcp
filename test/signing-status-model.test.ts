import { describe, expect, it } from "vitest";

import {
  formatDate,
  nextStep,
  progressPercent,
  recipientState,
  waitingOn,
  type EnvelopeStatus,
  type RecipientStatus,
} from "../views/signing-status/model.js";

function recipient(overrides: Partial<RecipientStatus>): RecipientStatus {
  return {
    id: 1,
    name: "Ada Signer",
    email: "ad***@example.com",
    role: "SIGNER",
    signingStatus: "NOT_SIGNED",
    readStatus: "NOT_OPENED",
    sendStatus: "SENT",
    signedAt: null,
    signingOrder: null,
    ...overrides,
  };
}

function envelope(overrides: Partial<EnvelopeStatus>): EnvelopeStatus {
  return {
    id: "envelope_abc",
    type: "DOCUMENT",
    title: "Contract",
    status: "PENDING",
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    completedAt: null,
    progress: { total: 2, signed: 1, rejected: 0, pending: 1 },
    recipients: [],
    recipientsTruncated: false,
    ...overrides,
  };
}

describe("recipientState", () => {
  it.each([
    [{ role: "SIGNER", signingStatus: "SIGNED" }, "Signed", "success"],
    [{ role: "APPROVER", signingStatus: "SIGNED" }, "Approved", "success"],
    [{ role: "VIEWER", signingStatus: "SIGNED" }, "Viewed", "success"],
    [{ signingStatus: "REJECTED" }, "Rejected", "danger"],
    [{ sendStatus: "NOT_SENT" }, "Not sent yet", "neutral"],
    [{ readStatus: "OPENED" }, "Opened, not finished", "info"],
    [{}, "Not opened yet", "info"],
    [{ role: "CC", sendStatus: "NOT_SENT" }, "Gets a copy when done", "neutral"],
  ] as const)("%o is %s", (overrides, label, tone) => {
    expect(recipientState(recipient(overrides))).toEqual({ label, tone });
  });
});

describe("nextStep", () => {
  it("names everyone still to act when there is no signing order", () => {
    const result = nextStep(
      envelope({
        recipients: [
          recipient({ id: 1, name: "Ada" }),
          recipient({ id: 2, name: "Grace" }),
          recipient({ id: 3, name: "Linus", signingStatus: "SIGNED" }),
          recipient({ id: 4, name: "Copy", role: "CC" }),
        ],
      }),
    );

    expect(result).toBe("Waiting for Ada and Grace.");
  });

  it("names only the next position when a signing order is set", () => {
    const current = envelope({
      recipients: [
        recipient({ id: 1, name: "First", signingOrder: 1, signingStatus: "SIGNED" }),
        recipient({ id: 2, name: "Second", signingOrder: 2 }),
        recipient({ id: 3, name: "Third", signingOrder: 3 }),
      ],
    });

    expect(waitingOn(current).map((r) => r.name)).toEqual(["Second"]);
    expect(nextStep(current)).toBe("Waiting for Second.");
  });

  it("falls back to the masked email when a recipient has no name", () => {
    expect(nextStep(envelope({ recipients: [recipient({ name: "" })] }))).toBe("Waiting for ad***@example.com.");
  });

  it.each([
    ["DRAFT", "This document has not been sent yet."],
    ["COMPLETED", "Everyone has finished. The signed document is ready in Documenso."],
    ["CANCELLED", "This document was cancelled and can no longer be signed."],
  ] as const)("%s", (status, text) => {
    expect(nextStep(envelope({ status }))).toBe(text);
  });

  it("names who rejected", () => {
    const rejected = envelope({ status: "REJECTED", recipients: [recipient({ name: "Ada", signingStatus: "REJECTED" })] });

    expect(nextStep(rejected)).toBe("Rejected by Ada.");
  });
});

describe("progressPercent", () => {
  it("rounds and handles envelopes with no acting recipients", () => {
    expect(progressPercent(envelope({ progress: { total: 3, signed: 1, rejected: 0, pending: 2 } }))).toBe(33);
    expect(progressPercent(envelope({ progress: { total: 0, signed: 0, rejected: 0, pending: 0 } }))).toBe(0);
  });
});

describe("formatDate", () => {
  it("formats in the host's locale and time zone, and ignores missing or invalid dates", () => {
    expect(formatDate("2026-09-29T10:00:00.000Z", "en-GB", "Europe/Zurich")).toBe("29 Sept 2026, 12:00");
    expect(formatDate(null)).toBeNull();
    expect(formatDate("not a date")).toBeNull();
  });

  it("falls back to ISO when the host sends an unknown time zone", () => {
    expect(formatDate("2026-09-29T10:00:00.000Z", "en-GB", "Mars/Olympus")).toBe("2026-09-29 10:00");
  });
});
