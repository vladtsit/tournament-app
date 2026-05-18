// Padel match validation + tournament leaderboard aggregation.
// Per spec §17 (sets) and §18.2 (leaderboard sort key).

export type TiebreakRule = "super_tiebreak_to_10" | "full_third_set";

// Accept legacy alias `regular_set` (used by tournamentCreate / webhook) and
// map it to the spec-canonical `full_third_set`.
export function normalizeTiebreakRule(value: unknown): TiebreakRule {
  if (value === "super_tiebreak_to_10") return "super_tiebreak_to_10";
  if (value === "full_third_set" || value === "regular_set") {
    return "full_third_set";
  }
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
  constructor(
    public readonly code:
      | "invalid_set_count"
      | "invalid_set_score"
      | "no_winner"
      | "invalid_super_tiebreak",
  ) {
    super(code);
    this.name = "ScoringError";
  }
}

function isValidStandardSet(winner: number, loser: number): boolean {
  if (winner === 6 && loser >= 0 && loser <= 4) return true;
  if (winner === 7 && (loser === 5 || loser === 6)) return true;
  return false;
}

function isValidSuperTiebreak(winner: number, loser: number): boolean {
  return winner >= 10 && winner - loser >= 2;
}

function setWinner(s: SetScore, allowSuper: boolean): "A" | "B" | null {
  if (!Number.isInteger(s.a) || !Number.isInteger(s.b)) return null;
  if (s.a < 0 || s.b < 0) return null;
  const [hi, lo, side]: [number, number, "A" | "B"] =
    s.a >= s.b ? [s.a, s.b, "A"] : [s.b, s.a, "B"];
  if (isValidStandardSet(hi, lo)) return side;
  if (allowSuper && isValidSuperTiebreak(hi, lo)) return side;
  return null;
}

export function evaluateMatch(
  sets: SetScore[],
  rule: TiebreakRule,
): MatchOutcome {
  if (!Array.isArray(sets) || sets.length < 2 || sets.length > 3) {
    throw new ScoringError("invalid_set_count");
  }
  let setsA = 0;
  let setsB = 0;
  let gamesA = 0;
  let gamesB = 0;
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i]!;
    const isDecider = i === 2;
    const allowSuper = isDecider && rule === "super_tiebreak_to_10";
    const w = setWinner(s, allowSuper);
    if (!w) {
      throw new ScoringError(
        allowSuper && i === 2 && (s.a >= 10 || s.b >= 10)
          ? "invalid_super_tiebreak"
          : "invalid_set_score",
      );
    }
    if (w === "A") setsA++;
    else setsB++;
    gamesA += s.a;
    gamesB += s.b;
  }
  // Match win = took 2 sets.
  if (setsA !== 2 && setsB !== 2) throw new ScoringError("no_winner");
  // If first two sets are split, third must exist; if first two same side, third is illegal.
  if (sets.length === 3) {
    if (setsA === 2 && setsB === 0) throw new ScoringError("invalid_set_count");
    if (setsB === 2 && setsA === 0) throw new ScoringError("invalid_set_count");
  }
  return { winner: setsA > setsB ? "A" : "B", setsA, setsB, gamesA, gamesB };
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
  // Sort: winRate desc, setRatio desc, gameRatio desc, matches desc, teamId asc.
  const sort = (a: LeaderboardRow, b: LeaderboardRow): number => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.setRatio !== a.setRatio) return b.setRatio - a.setRatio;
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
