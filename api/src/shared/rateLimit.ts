// In-memory per-instance sliding-window rate limiter (spec §22.4, Phase 5.5).
// 30 mutating requests per 60s per userId. SWA Free has a single Functions
// instance under normal load, so per-instance state is acceptable; documented
// as a known caveat.

const WINDOW_MS = 60_000;
const MAX_REQS = 30;

const buckets = new Map<string, number[]>();

export class RateLimitError extends Error {
  constructor(public readonly retryAfterSec: number) {
    super("rate_limited");
    this.name = "RateLimitError";
  }
}

export function enforceRateLimit(key: string, now: number = Date.now()): void {
  const cutoff = now - WINDOW_MS;
  let arr = buckets.get(key);
  if (!arr) {
    arr = [];
    buckets.set(key, arr);
  }
  while (arr.length > 0 && arr[0]! < cutoff) arr.shift();
  if (arr.length >= MAX_REQS) {
    const oldest = arr[0]!;
    const retryAfter = Math.max(
      1,
      Math.ceil((oldest + WINDOW_MS - now) / 1000),
    );
    throw new RateLimitError(retryAfter);
  }
  arr.push(now);

  // Bound map size to avoid unbounded growth on long-lived instance.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      while (v.length > 0 && v[0]! < cutoff) v.shift();
      if (v.length === 0) buckets.delete(k);
    }
  }
}

export function isMutating(method: string | undefined): boolean {
  if (!method) return false;
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}
