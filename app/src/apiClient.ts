// Lightweight fetch wrapper. Attaches the session JWT (bearer-preferred per
// spec §10.7) and the active language as `Accept-Language`.

let sessionToken: string | null = null;
let language = "en";
let reauth: (() => Promise<string | null>) | null = null;
let reauthInflight: Promise<string | null> | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function setLanguage(lang: string): void {
  language = lang;
}

/**
 * Register a callback the client can invoke when an API call returns 401 with
 * `invalid_token`. The callback should re-run the Telegram handshake and
 * return the new session JWT (or `null` if reauth failed). Only one re-auth
 * runs at a time even under concurrent 401s.
 */
export function setReauthHandler(
  fn: (() => Promise<string | null>) | null,
): void {
  reauth = fn;
}

/**
 * Fetch a file (CSV, etc.) and trigger a browser download. Uses the same
 * session-token auth header as `api()`.
 */
export async function downloadAuthed(
  path: string,
  filename: string,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (sessionToken) headers["X-Session-Token"] = sessionToken;
  const res = await fetch(path, { headers, credentials: "same-origin" });
  if (!res.ok) {
    throw new ApiClientError(res.status, "download_failed", res.statusText);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  return await apiInternal<T>(path, opts, false);
}

async function apiInternal<T>(
  path: string,
  opts: RequestOptions,
  isRetry: boolean,
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
    headers["X-Session-Token"] = sessionToken;
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
    const code = err?.code ?? "http_error";
    // Session expired (4 h JWT TTL). Re-run the Telegram handshake once and
    // retry with the new token. The original Idempotency-Key (if any) is
    // re-used so the retry hits the stored idempotency record on the server.
    if (
      !isRetry &&
      res.status === 401 &&
      (code === "invalid_token" || code === "missing_token") &&
      reauth &&
      path !== "/api/auth/telegram"
    ) {
      reauthInflight ??= reauth().finally(() => {
        reauthInflight = null;
      });
      const fresh = await reauthInflight;
      if (fresh) {
        return await apiInternal<T>(path, opts, true);
      }
    }
    throw new ApiClientError(res.status, code, err?.message ?? res.statusText);
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
