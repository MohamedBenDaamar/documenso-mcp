import { ThemeProvider, useCallTool, useHostContext, useToolContext } from "mcp-use/react";

import {
  ENVELOPE_LABELS,
  formatDate,
  nextStep,
  progressPercent,
  recipientState,
  roleLabel,
  type EnvelopeStatus,
  type Tone,
} from "./model.js";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
  info: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  success: "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
  danger: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export default function SigningStatusView() {
  const view = useToolContext<"get-envelope-status">();
  const refresh = useCallTool("get-envelope-status");
  const { locale, timeZone } = useHostContext();

  if (view.status === "pending") {
    return (
      <ThemeProvider>
        <Shell>
          <p className="text-sm text-neutral-500 dark:text-neutral-400" role="status">
            Loading signing status…
          </p>
        </Shell>
      </ThemeProvider>
    );
  }

  if (view.status === "error") {
    return (
      <ThemeProvider>
        <Shell>
          <p className="text-sm text-red-700 dark:text-red-300" role="alert">
            {view.error.message}
          </p>
        </Shell>
      </ThemeProvider>
    );
  }

  // A refresh replaces the original result; the original stays on screen if the refresh fails.
  const envelope: EnvelopeStatus = refresh.data?.structuredContent ?? view.toolOutput;
  const state = ENVELOPE_LABELS[envelope.status];
  const percent = progressPercent(envelope);
  const updated = formatDate(envelope.updatedAt, locale, timeZone);

  async function onRefresh() {
    try {
      await refresh.callTool({ envelopeId: envelope.id });
    } catch {
      // The hook exposes the failure through refresh.error.
    }
  }

  return (
    <ThemeProvider>
      <Shell>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-50" title={envelope.title}>
              {envelope.title}
            </h2>
            {updated && <p className="text-xs text-neutral-500 dark:text-neutral-400">Last updated {updated}</p>}
          </div>
          <Badge tone={state.tone}>{state.label}</Badge>
        </header>

        <section className="mt-4" aria-label="Signing progress">
          <div className="flex items-baseline justify-between text-sm text-neutral-700 dark:text-neutral-300">
            <span>
              {envelope.progress.signed} of {envelope.progress.total} finished
            </span>
            <span aria-hidden="true">{percent}%</span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={envelope.progress.total}
            aria-valuenow={envelope.progress.signed}
            aria-valuetext={`${envelope.progress.signed} of ${envelope.progress.total} recipients finished`}
          >
            <div className="h-full rounded-full bg-green-600 dark:bg-green-500" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{nextStep(envelope)}</p>
        </section>

        <section className="mt-4" aria-label="Recipients">
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {envelope.recipients.map((recipient) => {
              const recipientStatus = recipientState(recipient);
              const signedAt = formatDate(recipient.signedAt, locale, timeZone);

              return (
                <li key={recipient.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {recipient.signingOrder !== null && (
                        <span className="mr-1 text-neutral-500 dark:text-neutral-400">{recipient.signingOrder}.</span>
                      )}
                      {recipient.name || recipient.email}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {roleLabel(recipient.role)}
                      {recipient.name ? ` · ${recipient.email}` : ""}
                      {signedAt ? ` · ${signedAt}` : ""}
                    </p>
                  </div>
                  <Badge tone={recipientStatus.tone}>{recipientStatus.label}</Badge>
                </li>
              );
            })}
          </ul>
          {envelope.recipientsTruncated && (
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Only the first 100 recipients are shown.</p>
          )}
        </section>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-neutral-500 dark:text-neutral-400" role="status" aria-live="polite">
            {refresh.error ? "Could not refresh. Showing the last known status." : ""}
          </p>
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={refresh.isPending}
            aria-busy={refresh.isPending}
            className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:cursor-wait disabled:opacity-60 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            {refresh.isPending ? "Refreshing…" : "Refresh"}
          </button>
        </footer>
      </Shell>
    </ThemeProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="bg-white p-4 font-sans dark:bg-neutral-900">{children}</div>;
}

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
