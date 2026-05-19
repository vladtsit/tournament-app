import { containers_ } from "./cosmos.js";
import type { FinalStanding, PlayerPointsDelta } from "./scoring.js";

// player_stats — overall (cross-tournament) per-player score.
// Partition key: /groupId. Id: ps_{userId}. Per spec §18.6.

export interface PlayerStatsDoc {
  id: string; // ps_{userId}
  groupId: string;
  userId: string;
  tournamentsPlayed: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
  podiums: { first: number; second: number; third: number };
  overallScore: number;
  lastUpdatedAt: string;
  // Last tournament whose deltas were applied to this row. Used as an
  // idempotency guard: tournamentEnd may be partially-applied if a single
  // upsert throws; retrying must not double-count for rows that already
  // received the delta.
  lastAppliedTournamentId?: string;
}

export function playerStatsId(userId: string): string {
  return `ps_${userId}`;
}

function emptyStats(groupId: string, userId: string): PlayerStatsDoc {
  return {
    id: playerStatsId(userId),
    groupId,
    userId,
    tournamentsPlayed: 0,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    setsFor: 0,
    setsAgainst: 0,
    podiums: { first: 0, second: 0, third: 0 },
    overallScore: 0,
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Apply per-player deltas to player_stats (upsert; create if missing).
 * Per-row idempotency: rows whose `lastAppliedTournamentId === tournamentId`
 * are skipped, so a retry after partial failure is safe.
 */
export async function applyPlayerDeltas(
  groupId: string,
  tournamentId: string,
  deltas: PlayerPointsDelta[],
): Promise<void> {
  const now = new Date().toISOString();
  // Best-effort: do them in parallel (Cosmos serverless is per-request billed).
  await Promise.all(
    deltas.map(async (d) => {
      const existing = await containers_
        .playerStats()
        .item(playerStatsId(d.userId), groupId)
        .read<PlayerStatsDoc>()
        .catch(() => null);
      const cur = existing?.resource ?? emptyStats(groupId, d.userId);
      if (cur.lastAppliedTournamentId === tournamentId) {
        // Already applied for this tournament — retry-safe no-op.
        return;
      }
      const updated: PlayerStatsDoc = {
        ...cur,
        tournamentsPlayed: cur.tournamentsPlayed + 1,
        matchesPlayed: cur.matchesPlayed + d.matchesPlayed,
        wins: cur.wins + d.wins,
        losses: cur.losses + d.losses,
        setsFor: cur.setsFor + d.setsFor,
        setsAgainst: cur.setsAgainst + d.setsAgainst,
        podiums: {
          first: cur.podiums.first + (d.podiumRank === 1 ? 1 : 0),
          second: cur.podiums.second + (d.podiumRank === 2 ? 1 : 0),
          third: cur.podiums.third + (d.podiumRank === 3 ? 1 : 0),
        },
        overallScore: round2(cur.overallScore + d.pointsAwarded),
        lastUpdatedAt: now,
        lastAppliedTournamentId: tournamentId,
      };
      await containers_.playerStats().items.upsert(updated);
    }),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PlayerStatsRow extends PlayerStatsDoc {
  winRate: number;
}

export function sortOverall(rows: PlayerStatsDoc[]): PlayerStatsRow[] {
  // Spec §18.6 tie-break: overallScore desc → wins desc → winRate desc →
  // tournamentsPlayed desc.
  return rows
    .map((r) => ({
      ...r,
      winRate: r.matchesPlayed === 0 ? 0 : r.wins / r.matchesPlayed,
    }))
    .sort((a, b) => {
      if (b.overallScore !== a.overallScore) {
        return b.overallScore - a.overallScore;
      }
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.tournamentsPlayed !== a.tournamentsPlayed) {
        return b.tournamentsPlayed - a.tournamentsPlayed;
      }
      return a.userId.localeCompare(b.userId);
    });
}

export type { FinalStanding };
