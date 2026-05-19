import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { reconcileMatches, type MatchDoc } from "../shared/matches.js";
import {
  computeFinalStandings,
  computePlayerDeltas,
  type FinalStanding,
  type MatchAggregate,
} from "../shared/scoring.js";
import { applyPlayerDeltas } from "../shared/playerStats.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";

// POST /api/tournaments/{tournamentId}/end
// Admin-only. Transitions live → ended, snapshots finalStandings, updates
// player_stats. Spec §18.5, §18.6.

interface TournamentDoc {
  id: string;
  groupId: string;
  status: "draft" | "registration_open" | "live" | "ended";
  updatedAt: string;
  endedAt?: string;
  finalStandings?: FinalStanding[];
}

interface TeamDoc {
  id: string;
  tournamentId: string;
  groupId: string;
  players: Array<{ userId: string }>;
}

interface GroupDoc {
  id: string;
  settings?: { minMatchesForRanking?: number };
}

app.http("tournamentEnd", {
  route: "tournaments/{tournamentId}/end",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      const m = mapGroupContextError(err);
      return jsonError(m.status, m.code, m.code);
    }

    const tournamentId = req.params["tournamentId"];
    if (!tournamentId) {
      return jsonError(400, "missing_tournament_id", "tournamentId required");
    }

    const tRead = await containers_
      .tournaments()
      .item(tournamentId, ctx.groupId)
      .read<TournamentDoc>()
      .catch(() => null);
    const t = tRead?.resource;
    if (!t) return jsonError(404, "tournament_not_found", "Not found.");
    if (t.status === "ended") {
      return { status: 200, jsonBody: { tournament: t } };
    }
    if (t.status !== "live") {
      return jsonError(
        409,
        "invalid_state",
        `Cannot end a tournament in status ${t.status}.`,
      );
    }

    const [teamsQ, matchesQ, groupRead] = await Promise.all([
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
        .groups()
        .item(ctx.groupId, ctx.groupId)
        .read<GroupDoc>()
        .catch(() => null),
    ]);

    const teams = teamsQ.resources;
    const matches = await reconcileMatches(matchesQ.resources);
    // Disputed matches still count per spec §31 row 5.
    const aggregates: MatchAggregate[] = matches.map((m) => ({
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      setsA: m.setsA,
      setsB: m.setsB,
      gamesA: m.gamesA,
      gamesB: m.gamesB,
      winner: m.winner,
    }));
    const teamMembers = new Map<string, string[]>(
      teams.map((tm) => [tm.id, tm.players.map((p) => p.userId)]),
    );
    const teamIds = teams.map((tm) => tm.id);
    const minMatches = groupRead?.resource?.settings?.minMatchesForRanking ?? 3;
    const standings = computeFinalStandings(
      teamIds,
      teamMembers,
      aggregates,
      minMatches,
    );

    const deltas = computePlayerDeltas(standings);
    await applyPlayerDeltas(ctx.groupId, deltas);

    const now = new Date().toISOString();
    const updated: TournamentDoc = {
      ...t,
      status: "ended",
      endedAt: now,
      updatedAt: now,
      finalStandings: standings,
    };
    await containers_.tournaments().items.upsert(updated);
    await refreshPinnedMessage(ctx.groupId);

    return { status: 200, jsonBody: { tournament: updated } };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
