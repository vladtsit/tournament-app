// Lightweight fetch wrapper. Attaches the session JWT (bearer-preferred per
// spec §10.7) and the active language as `Accept-Language`.

let sessionToken: string | null = null;
let language = "en";

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function setLanguage(lang: string): void {
  language = lang;
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
}

export class ApiClientError extends Error implements ApiError {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

type Json = Record<string, unknown> | unknown[] | null;

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: Json;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": language,
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (sessionToken) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
  }
  if (opts.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }

  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : null,
    credentials: "same-origin",
  });

  const text = await res.text();
  const parsed: unknown = text ? safeJson(text) : null;

  if (!res.ok) {
    const err = (
      parsed as { error?: { code?: string; message?: string } } | null
    )?.error;
    throw new ApiClientError(
      res.status,
      err?.code ?? "http_error",
      err?.message ?? res.statusText,
    );
  }
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
