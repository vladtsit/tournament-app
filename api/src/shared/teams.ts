import { containers_ } from "./cosmos.js";

interface TeamDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  players: Array<{ userId: string; firstName: string; lastName?: string }>;
  status: "active" | "disbanded";
  confirmedByAdmin?: boolean;
  confirmedByAdminAt?: string;
  confirmedByAdminUserId?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Hard-delete a team and free both team_slots. Idempotent (no-op if team
 * already gone). Caller is responsible for any membership or tournament-state
 * guards before invoking this.
 */
export async function disbandTeam(
  groupId: string,
  tournamentId: string,
  teamId: string,
): Promise<{ found: boolean }> {
  const teamRead = await containers_
    .teams()
    .item(teamId, groupId)
    .read<TeamDoc>()
    .catch(() => null);
  const team = teamRead?.resource;
  if (!team || team.tournamentId !== tournamentId) {
    return { found: false };
  }
  await Promise.all(
    team.players.map((p) =>
      containers_
        .teamSlots()
        .item(`${tournamentId}_${p.userId}`, p.userId)
        .delete()
        .catch(() => undefined),
    ),
  );
  await containers_
    .teams()
    .item(teamId, groupId)
    .delete()
    .catch(() => undefined);
  return { found: true };
}

/**
 * Look up the user's team_slot for a tournament and disband the team if
 * present. Used by registrationUpsert when a player toggles `playing=false`.
 */
export async function disbandTeamForUser(
  groupId: string,
  tournamentId: string,
  userId: string,
): Promise<{ disbanded: boolean; teamId?: string }> {
  const slotRead = await containers_
    .teamSlots()
    .item(`${tournamentId}_${userId}`, userId)
    .read<{ teamId: string }>()
    .catch(() => null);
  const teamId = slotRead?.resource?.teamId;
  if (!teamId) return { disbanded: false };
  const r = await disbandTeam(groupId, tournamentId, teamId);
  return r.found ? { disbanded: true, teamId } : { disbanded: false };
}

export type { TeamDoc };
