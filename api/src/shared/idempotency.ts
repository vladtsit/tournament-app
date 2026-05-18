import { createHash } from "node:crypto";
import { containers_ } from "./cosmos.js";

// Idempotency-Key replay protection. Per spec §22.5.
//
// Algorithm:
//   1. Read `idempotency/idem_{userId}_{key}` (partition /userId).
//   2. Hit + same body hash → return stored response.
//   3. Hit + different body hash → throw IdempotencyConflict (caller maps to 422).
//   4. Miss → run handler; persist {id, userId, key, bodyHash, response, createdAt}.
//
// Notes:
// - We store the JSON body of the success response and the HTTP status.
// - TTL/cleanup is a future concern; the doc is small and Cosmos serverless is
//   pay-per-request, so leakage cost is negligible.

const KEY_MAX_LEN = 128;
const KEY_PATTERN = /^[A-Za-z0-9_\-:.]+$/;

export class IdempotencyConflict extends Error {
  constructor() {
    super("idempotency_conflict");
    this.name = "IdempotencyConflict";
  }
}

export class IdempotencyInvalidKey extends Error {
  constructor() {
    super("idempotency_invalid_key");
    this.name = "IdempotencyInvalidKey";
  }
}

export interface IdempotencyDoc {
  id: string;
  userId: string;
  key: string;
  bodyHash: string;
  response: unknown;
  status: number;
  createdAt: string;
}

function docId(userId: string, key: string): string {
  return `idem_${userId}_${key}`;
}

function hashBody(body: unknown): string {
  const json = body === undefined ? "" : JSON.stringify(body);
  return createHash("sha256").update(json).digest("hex");
}

export function validateIdempotencyKey(key: string | undefined | null): string {
  if (!key) throw new IdempotencyInvalidKey();
  if (key.length > KEY_MAX_LEN || !KEY_PATTERN.test(key)) {
    throw new IdempotencyInvalidKey();
  }
  return key;
}

export interface ExecutedResult<T> {
  status: number;
  response: T;
  replayed: boolean;
}

/**
 * Run a mutating handler with idempotency protection. The `handler` is only
 * invoked on a miss; on a hit the stored response is returned unchanged.
 */
export async function withIdempotency<T>(
  userId: string,
  key: string | undefined | null,
  body: unknown,
  handler: () => Promise<{ status: number; response: T }>,
): Promise<ExecutedResult<T>> {
  const validated = validateIdempotencyKey(key);
  const id = docId(userId, validated);
  const c = containers_.idempotency();
  const bodyHash = hashBody(body);

  const existing = await c
    .item(id, userId)
    .read<IdempotencyDoc>()
    .catch(() => null);
  const prior = existing?.resource ?? null;
  if (prior) {
    if (prior.bodyHash !== bodyHash) {
      throw new IdempotencyConflict();
    }
    return {
      status: prior.status,
      response: prior.response as T,
      replayed: true,
    };
  }

  const { status, response } = await handler();

  const doc: IdempotencyDoc = {
    id,
    userId,
    key: validated,
    bodyHash,
    response,
    status,
    createdAt: new Date().toISOString(),
  };
  try {
    // create() so concurrent duplicates with the same hash fall through to the
    // unique-key path and either of them wins.
    await c.items.create(doc);
  } catch (err) {
    // 409 conflict = another request beat us; treat as replay (re-read).
    const re = await c
      .item(id, userId)
      .read<IdempotencyDoc>()
      .catch(() => null);
    const other = re?.resource;
    if (other) {
      if (other.bodyHash !== bodyHash) throw new IdempotencyConflict();
      return {
        status: other.status,
        response: other.response as T,
        replayed: true,
      };
    }
    throw err;
  }

  return { status, response, replayed: false };
}
