import { z } from "zod";

import { classifyFailure, DocumensoError } from "./errors.js";

const CheckStatusSchema = z.enum(["ok", "warning", "error"]);

const HealthResponseSchema = z.object({
  status: CheckStatusSchema,
  checks: z.object({
    database: z.object({ status: CheckStatusSchema }),
    certificate: z.object({ status: CheckStatusSchema }),
  }),
});

const ErrorBodySchema = z
  .object({
    message: z.string().optional(),
    data: z.object({ code: z.string().optional() }).optional(),
  })
  .loose();

export type DocumensoHealth = z.infer<typeof HealthResponseSchema> & { latencyMs: number };

type RequestOptions<T> = {
  path: string;
  /** Documenso team API token of the calling user. Required: there is no shared server token. */
  token: string;
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
};

export type DocumensoClient = {
  getHealth(signal?: AbortSignal): Promise<DocumensoHealth>;
  request<T>(options: RequestOptions<T>): Promise<T>;
};

type ClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export function createDocumensoClient({ baseUrl, timeoutMs, fetchImpl = fetch }: ClientOptions): DocumensoClient {
  async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);

    try {
      return await fetchImpl(url, {
        ...init,
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new DocumensoError("unavailable");
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  return {
    async getHealth(signal) {
      const startedAt = performance.now();
      const response = await send(`${baseUrl}/api/health`, { method: "GET" }, signal);
      const latencyMs = Math.round(performance.now() - startedAt);

      // Documenso answers 500 with a normal health body when a check fails.
      const parsed = HealthResponseSchema.safeParse(await readJson(response));

      if (!parsed.success) {
        throw new DocumensoError(response.ok ? "unexpected" : "unavailable", response.status);
      }

      return { ...parsed.data, latencyMs };
    },

    async request({ path, token, schema, method = "GET", body, signal }) {
      if (!token) {
        throw new DocumensoError("unauthorized");
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };

      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const response = await send(
        `${baseUrl}/api/v2${path}`,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        signal,
      );
      const json = await readJson(response);

      if (!response.ok) {
        const errorBody = ErrorBodySchema.safeParse(json);
        const appCode = errorBody.success ? errorBody.data.data?.code : undefined;
        const message = errorBody.success ? errorBody.data.message : undefined;

        throw new DocumensoError(classifyFailure(response.status, appCode, message), response.status);
      }

      const parsed = schema.safeParse(json);

      if (!parsed.success) {
        throw new DocumensoError("unexpected", response.status);
      }

      return parsed.data;
    },
  };
}
