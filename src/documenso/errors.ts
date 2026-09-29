export type DocumensoErrorKind =
  | "unauthorized"
  | "not_found_or_forbidden"
  | "invalid_request"
  | "rate_limited"
  | "unavailable"
  | "unexpected";

const SAFE_MESSAGES: Record<DocumensoErrorKind, string> = {
  unauthorized: "Documenso refused this connection: it expired or was revoked. Reconnect Documenso in the assistant's connector settings.",
  not_found_or_forbidden: "That Documenso item does not exist or your team cannot access it.",
  invalid_request: "Documenso rejected the request as invalid.",
  rate_limited: "Documenso is rate limiting this team. Try again shortly.",
  unavailable: "Documenso is not reachable right now. Try again shortly.",
  unexpected: "Documenso returned an unexpected error.",
};

const INVALID_REQUEST_CODES = new Set(["INVALID_REQUEST", "INVALID_BODY", "SCHEMA_FAILED"]);

/**
 * Error thrown by the Documenso client.
 *
 * `message` is always one of the fixed SAFE_MESSAGES: it never contains Documenso's response body,
 * which in dev mode includes stack traces and server file paths, and never contains the API token.
 */
export class DocumensoError extends Error {
  readonly kind: DocumensoErrorKind;
  readonly status: number | undefined;

  constructor(kind: DocumensoErrorKind, status?: number) {
    super(SAFE_MESSAGES[kind]);
    this.name = "DocumensoError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Maps a failed Documenso response to a safe error kind.
 *
 * `appCode` is Documenso's `data.code` from the error body, when present. Documenso answers some
 * "not found" cases with HTTP 500 (for example a cross-team `POST /envelope/distribute`, where
 * `sendDocument` throws a plain Error), so a 500 whose message says "not found" is treated as
 * not-found-or-forbidden rather than as a retryable server failure.
 */
export function classifyFailure(status: number, appCode?: string, message?: string): DocumensoErrorKind {
  if (status === 401 || appCode === "UNAUTHORIZED" || appCode === "EXPIRED_CODE") {
    return "unauthorized";
  }

  if (status === 403 || status === 404 || appCode === "NOT_FOUND" || appCode === "FORBIDDEN") {
    return "not_found_or_forbidden";
  }

  if (status === 429 || appCode === "TOO_MANY_REQUESTS") {
    return "rate_limited";
  }

  if (status === 400 || status === 422 || INVALID_REQUEST_CODES.has(appCode ?? "")) {
    return "invalid_request";
  }

  if (status === 500 && message !== undefined && /\bnot found\b/i.test(message)) {
    return "not_found_or_forbidden";
  }

  if (status === 502 || status === 503 || status === 504) {
    return "unavailable";
  }

  return "unexpected";
}
