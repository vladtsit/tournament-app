import { containers_ } from "./cosmos.js";

// Lazy auto-confirm: when match docs are read, any 'submitted' match past its
// autoConfirmDueAt is upgraded to 'confirmed' on the fly. Spec §22 — avoids
// needing a Timer trigger (not available on Free SWA managed Functions).

const AUTO_CONFIRM_AFTER_MS = 30 * 60 * 1000; // 30 minutes

export interface MatchDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  teamAId: string;
  teamBId: string;
  submittedByUserId: string;
  sets: Array<{ a: number; b: number }>;
  winner: "A" | "B";
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  status: "submitted" | "confirmed" | "disputed";
  submittedAt: string;
  autoConfirmDueAt: string;
  confirmedAt?: string;
  confirmedByUserId?: string;
  disputedAt?: string;
  disputedByUserId?: string;
  autoConfirmed?: boolean;
}

export function autoConfirmDueAt(submittedAtIso: string): string {
  return new Date(
    new Date(submittedAtIso).getTime() + AUTO_CONFIRM_AFTER_MS,
  ).toISOString();
}

export async function reconcileMatches(
  matches: MatchDoc[],
): Promise<MatchDoc[]> {
  const now = Date.now();
  const updates: Promise<unknown>[] = [];
  const out: MatchDoc[] = [];
  for (const m of matches) {
    if (
      m.status === "submitted" &&
      new Date(m.autoConfirmDueAt).getTime() <= now
    ) {
      const confirmed: MatchDoc = {
        ...m,
        status: "confirmed",
        confirmedAt: new Date().toISOString(),
        autoConfirmed: true,
      };
      updates.push(
        containers_
          .matches()
          .items.upsert(confirmed)
          .catch(() => undefined),
      );
      out.push(confirmed);
    } else {
      out.push(m);
    }
  }
  if (updates.length) await Promise.all(updates);
  return out;
}
