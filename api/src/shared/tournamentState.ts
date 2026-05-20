// Tournament status machine. Phase 6 adds `review` between
// `registration_open` and `live`.

export type TournamentStatus =
  | "draft"
  | "registration_open"
  | "review"
  | "live"
  | "ended";

export const ACTIVE_STATUSES: readonly TournamentStatus[] = [
  "draft",
  "registration_open",
  "review",
  "live",
] as const;

interface Transition {
  from: TournamentStatus;
  to: TournamentStatus;
}

const TRANSITIONS: readonly Transition[] = [
  { from: "draft", to: "registration_open" },
  { from: "registration_open", to: "review" },
  { from: "review", to: "registration_open" },
  { from: "review", to: "live" },
  { from: "live", to: "ended" },
];

export class TournamentStateError extends Error {
  constructor(
    public readonly code:
      | "invalid_state"
      | "not_all_confirmed"
      | "odd_player_count"
      | "courts_not_assigned",
    message: string,
  ) {
    super(message);
    this.name = "TournamentStateError";
  }
}

export function canTransition(
  from: TournamentStatus,
  to: TournamentStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS.some((tr) => tr.from === from && tr.to === to);
}

export function assertCanTransition(
  from: TournamentStatus,
  to: TournamentStatus,
): void {
  if (!canTransition(from, to)) {
    throw new TournamentStateError(
      "invalid_state",
      `Cannot transition from ${from} to ${to}.`,
    );
  }
}
