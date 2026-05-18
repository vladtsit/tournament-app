import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";
import { reconcileMatches, type MatchDoc } from "../shared/matches.js";

// GET /api/tournaments/{tournamentId}/available-opponents
//
// Lists all teams in the tournament *other than* the caller's team, with
// "matches played" counts so the UI can sort least-played first and the
// player can pick a fresh opponent.

interface TeamDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  players: Array<{ userId: string; firstName: string; lastName?: string }>;
  status?: "active" | "disbanded";
}

interface TeamSlotDoc {
  teamId: string;
}

app.http("availableOpponents", {
  route: "tournaments/{tournamentId}/available-opponents",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroup(req);
    } catch (err) {
      const m = mapGroupContextError(err);
      return jsonError(m.status, m.code, m.code);
    }

    const tournamentId = req.params["tournamentId"];
    if (!tournamentId) {
      return jsonError(400, "missing_tournament_id", "tournamentId required");
    }

    const slotId = `${tournamentId}_${ctx.userId}`;
    const [slotRead, teamsQ, matchesQ] = await Promise.all([
      containers_
        .teamSlots()
        .item(slotId, ctx.userId)
        .read<TeamSlotDoc>()
        .catch(() => null),
      containers_
        .teams()
        .items.query<TeamDoc>(
          {
            query:
              "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
            parameters: [
              { name: "@g", value: ctx.groupId },
              { name: "@t", value: tournamentId },
            ],
          },
          { partitionKey: ctx.groupId },
        )
        .fetchAll(),
      containers_
        .matches()
        .items.query<MatchDoc>(
          {
            query:
              "SELECT c.teamAId, c.teamBId, c.status, c.autoConfirmDueAt, c.submittedAt FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
            parameters: [
              { name: "@g", value: ctx.groupId },
              { name: "@t", value: tournamentId },
            ],
          },
          { partitionKey: ctx.groupId },
        )
        .fetchAll(),
    ]);

    const myTeamId = slotRead?.resource?.teamId;

    // Tally matches per team (counted regardless of status).
    const counts = new Map<string, number>();
    for (const m of matchesQ.resources) {
      counts.set(m.teamAId, (counts.get(m.teamAId) ?? 0) + 1);
      counts.set(m.teamBId, (counts.get(m.teamBId) ?? 0) + 1);
    }

    const others = teamsQ.resources
      .filter((tm) => tm.id !== myTeamId)
      .map((tm) => ({
        teamId: tm.id,
        players: tm.players.map((p) => ({
          userId: p.userId,
          firstName: p.firstName,
          ...(p.lastName ? { lastName: p.lastName } : {}),
        })),
        matchesPlayed: counts.get(tm.id) ?? 0,
      }))
      .sort((a, b) => a.matchesPlayed - b.matchesPlayed);

    // Side effect: trigger lazy auto-confirm so leaderboard data is fresh.
    // (Fire-and-forget so this endpoint stays responsive.)
    void reconcileMatches(matchesQ.resources as unknown as MatchDoc[]).catch(
      () => undefined,
    );

    return {
      status: 200,
      jsonBody: { myTeamId: myTeamId ?? null, opponents: others },
    };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
