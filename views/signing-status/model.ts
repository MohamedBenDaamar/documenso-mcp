import type { EnvelopeStatusOutput } from "../../src/tools/envelopes.js";

export type EnvelopeStatus = EnvelopeStatusOutput;
export type RecipientStatus = EnvelopeStatusOutput["recipients"][number];

export type Tone = "neutral" | "info" | "success" | "danger";

export const ENVELOPE_LABELS: Record<EnvelopeStatus["status"], { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PENDING: { label: "Waiting for signatures", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

const ROLE_LABELS: Record<string, string> = {
  SIGNER: "Signer",
  APPROVER: "Approver",
  VIEWER: "Viewer",
  ASSISTANT: "Assistant",
  CC: "Receives a copy",
};

const DONE_LABELS: Record<string, string> = {
  SIGNER: "Signed",
  APPROVER: "Approved",
  VIEWER: "Viewed",
  ASSISTANT: "Done",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** One short, text-only status per recipient, so colour is never the only signal. */
export function recipientState(recipient: RecipientStatus): { label: string; tone: Tone } {
  if (recipient.role === "CC") {
    return { label: recipient.sendStatus === "SENT" ? "Copy sent" : "Gets a copy when done", tone: "neutral" };
  }

  if (recipient.signingStatus === "SIGNED") {
    return { label: DONE_LABELS[recipient.role] ?? "Done", tone: "success" };
  }

  if (recipient.signingStatus === "REJECTED") {
    return { label: "Rejected", tone: "danger" };
  }

  if (recipient.sendStatus === "NOT_SENT") {
    return { label: "Not sent yet", tone: "neutral" };
  }

  return { label: recipient.readStatus === "OPENED" ? "Opened, not finished" : "Not opened yet", tone: "info" };
}

function displayName(recipient: RecipientStatus): string {
  return recipient.name || recipient.email;
}

/**
 * Recipients who still have to act, in the order they are expected to act. With a signing order,
 * only the lowest pending position can act now.
 */
export function waitingOn(envelope: EnvelopeStatus): RecipientStatus[] {
  const pending = envelope.recipients.filter(
    (recipient) => recipient.role !== "CC" && recipient.signingStatus === "NOT_SIGNED",
  );
  const ordered = pending.filter((recipient) => recipient.signingOrder !== null);

  if (ordered.length === 0) {
    return pending;
  }

  const next = Math.min(...ordered.map((recipient) => recipient.signingOrder ?? Number.POSITIVE_INFINITY));

  return pending.filter((recipient) => recipient.signingOrder === null || recipient.signingOrder === next);
}

/** What happens next, in one sentence. Read-only: this View never sends or changes anything. */
export function nextStep(envelope: EnvelopeStatus): string {
  switch (envelope.status) {
    case "DRAFT":
      return "This document has not been sent yet.";
    case "PENDING": {
      const waiting = waitingOn(envelope);

      if (waiting.length === 0) {
        return "All recipients have finished. Documenso is completing the document.";
      }

      const names = waiting.map(displayName);
      return names.length === 1
        ? `Waiting for ${names[0]}.`
        : `Waiting for ${names.slice(0, -1).join(", ")} and ${names.at(-1)}.`;
    }
    case "COMPLETED":
      return "Everyone has finished. The signed document is ready in Documenso.";
    case "REJECTED": {
      const rejectedBy = envelope.recipients.filter((recipient) => recipient.signingStatus === "REJECTED").map(displayName);
      return rejectedBy.length > 0 ? `Rejected by ${rejectedBy.join(", ")}.` : "A recipient rejected this document.";
    }
    case "CANCELLED":
      return "This document was cancelled and can no longer be signed.";
  }
}

export function progressPercent(envelope: EnvelopeStatus): number {
  const { total, signed } = envelope.progress;

  return total === 0 ? 0 : Math.round((signed / total) * 100);
}

export function formatDate(value: string | null, locale?: string, timeZone?: string): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}
