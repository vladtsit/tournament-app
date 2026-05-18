import { randomBytes } from "node:crypto";

// 4-char base32-ish short id for group launch links (~1M combos).
// Excludes look-alikes (0/O, 1/I/L) per spec §10.2.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 31 chars

export function generateGroupShortId(): string {
  const buf = randomBytes(4);
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += ALPHABET[buf[i]! % ALPHABET.length];
  }
  return s;
}

/**
 * Generate a unique short id by retrying until `isFree(candidate)` resolves true.
 * Falls back to throwing after maxAttempts.
 */
export async function generateUniqueGroupShortId(
  isFree: (candidate: string) => Promise<boolean>,
  maxAttempts = 8,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const cand = generateGroupShortId();
    if (await isFree(cand)) return cand;
  }
  throw new Error("could_not_generate_unique_group_short_id");
}
