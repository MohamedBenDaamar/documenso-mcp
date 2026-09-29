import { z } from "zod";

import type { AppServer } from "../app-server.js";
import { ConnectionStoreError, type ConnectionStore, type UserSession } from "../connections/store.js";
import type { DocumensoClient } from "../documenso/client.js";
import {
  actingRecipients,
  ENVELOPE_STATUSES,
  EnvelopeSchema,
  findEnvelopesPath,
  FindEnvelopesResponseSchema,
  maskEmail,
  type Envelope,
} from "../documenso/envelopes.js";
import { DocumensoError } from "../documenso/errors.js";

export type EnvelopeToolDeps = {
  client: DocumensoClient;
  store: ConnectionStore;
  /** Page where users connect or replace their Documenso team token. */
  accountUrl: string;
};

type TextContent = { type: "text"; text: string };

export type ToolResult<T> =
  | { content: TextContent[]; structuredContent: T; isError?: false }
  | { content: TextContent[]; isError: true };

const MAX_RECIPIENTS = 100;

const ProgressSchema = z.object({
  total: z.number().int().describe("Recipients who must sign, approve or view. CC recipients are not counted."),
  signed: z.number().int(),
  rejected: z.number().int(),
  pending: z.number().int(),
});

const PaginationSchema = {
  page: z.number().int(),
  perPage: z.number().int(),
  totalPages: z.number().int(),
  total: z.number().int(),
};

const ListEnvelopesInputSchema = z.object({
  status: z.enum(ENVELOPE_STATUSES).optional().describe("Only return documents with this status."),
  query: z.string().trim().min(1).max(100).optional().describe("Search text matched against titles and recipients."),
  page: z.number().int().min(1).max(1000).default(1),
  perPage: z.number().int().min(1).max(50).default(10),
});

export const ListEnvelopesOutputSchema = z.object({
  envelopes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(ENVELOPE_STATUSES),
      createdAt: z.string(),
      updatedAt: z.string(),
      completedAt: z.string().nullable(),
      progress: ProgressSchema,
    }),
  ),
  ...PaginationSchema,
});

const GetEnvelopeStatusInputSchema = z.object({
  envelopeId: z
    .string()
    .regex(/^envelope_[a-z0-9]{1,64}$/, "Expected a Documenso envelope ID such as envelope_abc123.")
    .describe("Envelope ID returned by list-envelopes."),
});

export const EnvelopeStatusOutputSchema = z.object({
  id: z.string(),
  type: z.enum(["DOCUMENT", "TEMPLATE"]),
  title: z.string(),
  status: z.enum(ENVELOPE_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  progress: ProgressSchema,
  recipients: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      email: z.string().describe("Masked email address."),
      role: z.string(),
      signingStatus: z.string(),
      readStatus: z.string(),
      sendStatus: z.string(),
      signedAt: z.string().nullable(),
      signingOrder: z.number().int().nullable(),
    }),
  ),
  recipientsTruncated: z.boolean(),
});

const ListTemplatesInputSchema = z.object({
  query: z.string().trim().min(1).max(100).optional().describe("Search text matched against template titles."),
  page: z.number().int().min(1).max(1000).default(1),
  perPage: z.number().int().min(1).max(50).default(10),
});

export const ListTemplatesOutputSchema = z.object({
  templates: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      recipients: z.array(
        z.object({
          id: z.number().int().describe("Template recipient ID, used later to fill in real recipients."),
          role: z.string(),
          label: z.string().describe("Placeholder name set on the template, if any."),
        }),
      ),
    }),
  ),
  ...PaginationSchema,
});

export type ListEnvelopesOutput = z.infer<typeof ListEnvelopesOutputSchema>;
export type EnvelopeStatusOutput = z.infer<typeof EnvelopeStatusOutputSchema>;
export type ListTemplatesOutput = z.infer<typeof ListTemplatesOutputSchema>;

function errorResult(text: string): { content: TextContent[]; isError: true } {
  return { content: [{ type: "text", text }], isError: true };
}

function progressOf(envelope: Envelope) {
  const acting = actingRecipients(envelope.recipients);
  const signed = acting.filter((recipient) => recipient.signingStatus === "SIGNED").length;
  const rejected = acting.filter((recipient) => recipient.signingStatus === "REJECTED").length;

  return { total: acting.length, signed, rejected, pending: acting.length - signed - rejected };
}

/**
 * Loads the caller's own Documenso token and runs `run` with it. Every failure becomes a fixed,
 * safe message: no Documenso or Supabase error text, and never the token.
 */
async function withDocumensoToken<T>(
  deps: EnvelopeToolDeps,
  user: UserSession | undefined,
  run: (token: string) => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  if (!user) {
    return errorResult("Sign in to use this tool.");
  }

  try {
    const connection = await deps.store.get(user);

    if (!connection) {
      return errorResult(
        `No Documenso team is connected to this account yet. Connect one at ${deps.accountUrl}, then try again.`,
      );
    }

    return await run(connection.token);
  } catch (error) {
    if (error instanceof DocumensoError && error.kind === "unauthorized") {
      return errorResult(
        "Documenso rejected the saved team token. It may have been revoked or expired, or you may no longer be " +
          `a member of that team. Connect a new token at ${deps.accountUrl}.`,
      );
    }

    if (error instanceof DocumensoError) {
      return errorResult(error.message);
    }

    if (error instanceof ConnectionStoreError) {
      return errorResult(`${error.message} Try again, or reconnect at ${deps.accountUrl}.`);
    }

    return errorResult("Something went wrong while talking to Documenso.");
  }
}

export async function listEnvelopes(
  deps: EnvelopeToolDeps,
  user: UserSession | undefined,
  input: z.infer<typeof ListEnvelopesInputSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<ListEnvelopesOutput>> {
  return withDocumensoToken(deps, user, async (token) => {
    const result = await deps.client.request({
      path: findEnvelopesPath({ type: "DOCUMENT", ...input }),
      token,
      schema: FindEnvelopesResponseSchema,
      signal,
    });

    const output: ListEnvelopesOutput = {
      envelopes: result.data.map((envelope) => ({
        id: envelope.id,
        title: envelope.title,
        status: envelope.status,
        createdAt: envelope.createdAt,
        updatedAt: envelope.updatedAt,
        completedAt: envelope.completedAt,
        progress: progressOf(envelope),
      })),
      page: result.currentPage,
      perPage: result.perPage,
      totalPages: result.totalPages,
      total: result.count,
    };

    const lines = output.envelopes.map(
      (envelope) =>
        `- ${envelope.title} (${envelope.status}, ${envelope.progress.signed}/${envelope.progress.total} signed) id: ${envelope.id}`,
    );
    const heading =
      output.total === 0
        ? "No documents found."
        : `Found ${output.total} document${output.total === 1 ? "" : "s"}. Page ${output.page} of ${output.totalPages}.`;

    return { content: [{ type: "text", text: [heading, ...lines].join("\n") }], structuredContent: output };
  });
}

export async function getEnvelopeStatus(
  deps: EnvelopeToolDeps,
  user: UserSession | undefined,
  input: z.infer<typeof GetEnvelopeStatusInputSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<EnvelopeStatusOutput>> {
  return withDocumensoToken(deps, user, async (token) => {
    const envelope = await deps.client.request({
      path: `/envelope/${encodeURIComponent(input.envelopeId)}`,
      token,
      schema: EnvelopeSchema,
      signal,
    });

    const recipients = envelope.recipients.slice(0, MAX_RECIPIENTS).map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      email: maskEmail(recipient.email),
      role: recipient.role,
      signingStatus: recipient.signingStatus,
      readStatus: recipient.readStatus,
      sendStatus: recipient.sendStatus,
      signedAt: recipient.signedAt,
      signingOrder: recipient.signingOrder,
    }));

    const output: EnvelopeStatusOutput = {
      id: envelope.id,
      type: envelope.type,
      title: envelope.title,
      status: envelope.status,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
      completedAt: envelope.completedAt,
      progress: progressOf(envelope),
      recipients,
      recipientsTruncated: envelope.recipients.length > MAX_RECIPIENTS,
    };

    const lines = recipients.map(
      (recipient) =>
        `- ${recipient.name || recipient.email} (${recipient.role}): ${recipient.signingStatus}, ${recipient.readStatus}`,
    );
    const heading =
      `${output.title} is ${output.status}. ` +
      `${output.progress.signed} of ${output.progress.total} recipients have completed their part.`;

    return { content: [{ type: "text", text: [heading, ...lines].join("\n") }], structuredContent: output };
  });
}

export async function listTemplates(
  deps: EnvelopeToolDeps,
  user: UserSession | undefined,
  input: z.infer<typeof ListTemplatesInputSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<ListTemplatesOutput>> {
  return withDocumensoToken(deps, user, async (token) => {
    const result = await deps.client.request({
      path: findEnvelopesPath({ type: "TEMPLATE", ...input }),
      token,
      schema: FindEnvelopesResponseSchema,
      signal,
    });

    const output: ListTemplatesOutput = {
      templates: result.data.map((template) => ({
        id: template.id,
        title: template.title,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        recipients: template.recipients.map((recipient) => ({
          id: recipient.id,
          role: recipient.role,
          label: recipient.name,
        })),
      })),
      page: result.currentPage,
      perPage: result.perPage,
      totalPages: result.totalPages,
      total: result.count,
    };

    const lines = output.templates.map(
      (template) =>
        `- ${template.title} (${template.recipients.length} recipient role${template.recipients.length === 1 ? "" : "s"}) id: ${template.id}`,
    );
    const heading =
      output.total === 0
        ? "No templates found."
        : `Found ${output.total} template${output.total === 1 ? "" : "s"}. Page ${output.page} of ${output.totalPages}.`;

    return { content: [{ type: "text", text: [heading, ...lines].join("\n") }], structuredContent: output };
  });
}

type AuthContext = { auth?: { user: { id: string }; accessToken: string }; signal: AbortSignal };

function sessionOf(ctx: AuthContext): UserSession | undefined {
  return ctx.auth ? { id: ctx.auth.user.id, accessToken: ctx.auth.accessToken } : undefined;
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerEnvelopeTools(server: AppServer, deps: EnvelopeToolDeps) {
  const listEnvelopesTool = server.tool(
    {
      name: "list-envelopes",
      title: "List documents",
      description:
        "List signing documents (envelopes) in the caller's connected Documenso team, newest first. " +
        "Supports filtering by status and a text search, with pagination.",
      inputSchema: ListEnvelopesInputSchema,
      outputSchema: ListEnvelopesOutputSchema,
      annotations: READ_ONLY,
    },
    async (input, ctx) => listEnvelopes(deps, sessionOf(ctx), input, ctx.signal),
  );

  const getEnvelopeStatusTool = server.tool(
    {
      name: "get-envelope-status",
      title: "Get signing status",
      description:
        "Show the signing progress of one envelope in the caller's connected Documenso team: status and, " +
        "for each recipient, role and whether they have opened and signed. Email addresses are masked.",
      inputSchema: GetEnvelopeStatusInputSchema,
      outputSchema: EnvelopeStatusOutputSchema,
      annotations: READ_ONLY,
      // Hosts without MCP Apps support still get the full status in the text result.
      view: {
        name: "signing-status",
        description: "Signing progress card: status, progress bar, each recipient's state and a refresh button.",
        prefersBorder: true,
      },
    },
    async (input, ctx) => getEnvelopeStatus(deps, sessionOf(ctx), input, ctx.signal),
  );

  const listTemplatesTool = server.tool(
    {
      name: "list-templates",
      title: "List templates",
      description:
        "List Documenso templates available to the caller's connected team, with the recipient roles each " +
        "template expects.",
      inputSchema: ListTemplatesInputSchema,
      outputSchema: ListTemplatesOutputSchema,
      annotations: READ_ONLY,
    },
    async (input, ctx) => listTemplates(deps, sessionOf(ctx), input, ctx.signal),
  );

  return { listEnvelopesTool, getEnvelopeStatusTool, listTemplatesTool };
}
