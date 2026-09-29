import { z } from "zod";

// Allowlists for Documenso envelope responses. `z.object` drops every key not listed here, which
// removes fields the model must never see: each recipient's signing `token`, owner `user` details,
// `authOptions`, `formValues`, document metadata and field contents.

export const ENVELOPE_STATUSES = ["DRAFT", "PENDING", "COMPLETED", "REJECTED", "CANCELLED"] as const;

const RecipientSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  role: z.enum(["CC", "SIGNER", "VIEWER", "APPROVER", "ASSISTANT"]),
  signingStatus: z.enum(["NOT_SIGNED", "SIGNED", "REJECTED"]),
  readStatus: z.enum(["NOT_OPENED", "OPENED"]),
  sendStatus: z.enum(["NOT_SENT", "SENT"]),
  signedAt: z.string().nullable(),
  signingOrder: z.number().int().nullable(),
});

export const EnvelopeSchema = z.object({
  id: z.string(),
  type: z.enum(["DOCUMENT", "TEMPLATE"]),
  title: z.string(),
  status: z.enum(ENVELOPE_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  recipients: z.array(RecipientSchema),
});

export const FindEnvelopesResponseSchema = z.object({
  data: z.array(EnvelopeSchema),
  count: z.number().int(),
  currentPage: z.number().int(),
  perPage: z.number().int(),
  totalPages: z.number().int(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;
export type Recipient = z.infer<typeof RecipientSchema>;
export type FindEnvelopesResponse = z.infer<typeof FindEnvelopesResponseSchema>;

/** Keeps the first two characters of the local part: "example@documenso.com" becomes "ex***@documenso.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");

  if (at <= 0) {
    return "***";
  }

  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

/** Recipients who must act. CC recipients only receive a copy. */
export function actingRecipients(recipients: Recipient[]): Recipient[] {
  return recipients.filter((recipient) => recipient.role !== "CC");
}

export function findEnvelopesPath(params: {
  type: "DOCUMENT" | "TEMPLATE";
  page: number;
  perPage: number;
  status?: string;
  query?: string;
}): string {
  const search = new URLSearchParams({
    type: params.type,
    page: String(params.page),
    perPage: String(params.perPage),
  });

  if (params.status) {
    search.set("status", params.status);
  }

  if (params.query) {
    search.set("query", params.query);
  }

  return `/envelope?${search.toString()}`;
}
