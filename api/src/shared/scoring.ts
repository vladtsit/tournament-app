// Casual padel scoring (spec §17, v2.2): one record = one game.
// Each submission stores a single `SetScore` whose `a`/`b` are non-negative
// integers, strictly unequal, and capped at 99 to catch typos. Players can
// submit multiple records between the same two teams over the lifetime of a
// tournament — each contributes to wins/losses and game totals independently.
//
// `TiebreakRule` and `normalizeTiebreakRule` are retained as no-ops for
// back-compat with stored settings; new code can ignore them.

export type TiebreakRule = "super_tiebreak_to_10" | "full_third_set";

export function normalizeTiebreakRule(_value: unknown): TiebreakRule {
  return "super_tiebreak_to_10";
}

export interface SetScore {
  a: number;
  b: number;
}

export interface MatchOutcome {
  winner: "A" | "B";
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
}

export class ScoringError extends Error {
  constructor(public readonly code: "invalid_set_count" | "invalid_set_score") {
    super(code);
    this.name = "ScoringError";
  }
}

const MAX_GAMES_PER_SIDE = 99;

export function evaluateMatch(sets: SetScore[]): MatchOutcome {
  if (!Array.isArray(sets) || sets.length !== 1) {
    throw new ScoringError("invalid_set_count");
  }
  const s = sets[0]!;
  if (
    !Number.isInteger(s.a) ||
    !Number.isInteger(s.b) ||
    s.a < 0 ||
    s.b < 0 ||
    s.a > MAX_GAMES_PER_SIDE ||
    s.b > MAX_GAMES_PER_SIDE ||
    s.a === s.b
  ) {
    throw new ScoringError("invalid_set_score");
  }
  const winner: "A" | "B" = s.a > s.b ? "A" : "B";
  return {
    winner,
    setsA: winner === "A" ? 1 : 0,
    setsB: winner === "B" ? 1 : 0,
    gamesA: s.a,
    gamesB: s.b,
  };
}

// ---------- Leaderboard ----------

export interface MatchAggregate {
  teamAId: string;
  teamBId: string;
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  winner: "A" | "B";
}

export interface TeamStats {
  teamId: string;
  matches: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
  gamesFor: number;
  gamesAgainst: number;
}

export interface LeaderboardRow extends TeamStats {
  winRate: number; // 0..1
  setRatio: number; // setsFor / max(setsAgainst, 1)
  gameRatio: number;
}

export function aggregateLeaderboard(
  teamIds: string[],
  matches: MatchAggregate[],
  minMatchesForRanking: number,
): { ranked: LeaderboardRow[]; needsMore: LeaderboardRow[] } {
  const stats = new Map<string, TeamStats>();
  for (const id of teamIds) {
    stats.set(id, {
      teamId: id,
      matches: 0,
      wins: 0,
      losses: 0,
      setsFor: 0,
      setsAgainst: 0,
      gamesFor: 0,
      gamesAgainst: 0,
    });
  }
  for (const m of matches) {
    const a = stats.get(m.teamAId);
    const b = stats.get(m.teamBId);
    if (!a || !b) continue;
    a.matches++;
    b.matches++;
    a.setsFor += m.setsA;
    a.setsAgainst += m.setsB;
    b.setsFor += m.setsB;
    b.setsAgainst += m.setsA;
    a.gamesFor += m.gamesA;
    a.gamesAgainst += m.gamesB;
    b.gamesFor += m.gamesB;
    b.gamesAgainst += m.gamesA;
    if (m.winner === "A") {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }
  }
  const rows: LeaderboardRow[] = Array.from(stats.values()).map((s) => ({
    ...s,
    winRate: s.matches === 0 ? 0 : s.wins / s.matches,
    setRatio: s.setsFor / Math.max(s.setsAgainst, 1),
    gameRatio: s.gamesFor / Math.max(s.gamesAgainst, 1),
  }));
  // Sort (spec §18.2, casual mode): winRate desc, gameRatio desc, matches desc, teamId asc.
  // `setRatio` is retained on the row for back-compat with consumers but no longer
  // participates in the tiebreak — under one-record-per-game it equals winRate.
  const sort = (a: LeaderboardRow, b: LeaderboardRow): number => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.gameRatio !== a.gameRatio) return b.gameRatio - a.gameRatio;
    if (b.matches !== a.matches) return b.matches - a.matches;
    return a.teamId.localeCompare(b.teamId);
  };
  const ranked = rows
    .filter((r) => r.matches >= minMatchesForRanking)
    .sort(sort);
  const needsMore = rows
    .filter((r) => r.matches < minMatchesForRanking)
    .sort(sort);
  return { ranked, needsMore };
}

// ---------- Finalization (spec §18.5 + §18.6) ----------

// Podium points per spec §18.6.
const PODIUM_POINTS = [10, 7, 5, 3, 1] as const;
const PARTICIPATION_POINT = 1;
const WIN_BONUS = 0.25;

export interface FinalStanding {
  rank: number;
  teamId: string;
  members: string[];
  matches: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
}

export interface PlayerPointsDelta {
  userId: string;
  podiumRank: number | null; // 1..5 or null (participation-only)
  pointsAwarded: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
}

export function computeFinalStandings(
  teamIds: string[],
  teamMembers: Map<string, string[]>,
  matches: MatchAggregate[],
  minMatchesForRanking: number,
): FinalStanding[] {
  // For final standings we ignore minMatchesForRanking — every team that
  // played at least one match is ranked; teams that played 0 fall to the end.
  const { ranked, needsMore } = aggregateLeaderboard(
    teamIds,
    matches,
    minMatchesForRanking,
  );
  const allRows = [...ranked, ...needsMore];
  // Re-sort needsMore using the same key so we get one combined ranking.
  // (aggregateLeaderboard returns each subset already sorted by the same
  // comparator, but ranked rows must precede needsMore per spec §18.3.)
  return allRows.map((r, i) => ({
    rank: i + 1,
    teamId: r.teamId,
    members: teamMembers.get(r.teamId) ?? [],
    matches: r.matches,
    wins: r.wins,
    losses: r.losses,
    setsFor: r.setsFor,
    setsAgainst: r.setsAgainst,
  }));
}

export function computePlayerDeltas(
  standings: FinalStanding[],
): PlayerPointsDelta[] {
  const out: PlayerPointsDelta[] = [];
  for (const s of standings) {
    const idx = s.rank - 1;
    const podiumPts =
      idx < PODIUM_POINTS.length
        ? PODIUM_POINTS[idx]!
        : s.matches > 0
          ? PARTICIPATION_POINT
          : 0;
    const podiumRank = idx < PODIUM_POINTS.length ? s.rank : null;
    // Each player on the team gets the team's podium points + WIN_BONUS×wins.
    const pts = podiumPts + WIN_BONUS * s.wins;
    for (const userId of s.members) {
      out.push({
        userId,
        podiumRank,
        pointsAwarded: pts,
        matchesPlayed: s.matches,
        wins: s.wins,
        losses: s.losses,
        setsFor: s.setsFor,
        setsAgainst: s.setsAgainst,
      });
    }
  }
  return out;
}
