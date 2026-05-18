import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";
import { reconcileMatches, type MatchDoc } from "../shared/matches.js";
import {
  aggregateLeaderboard,
  type MatchAggregate,
} from "../shared/scoring.js";

// GET /api/tournaments/{tournamentId}/leaderboard
//
// Returns ranked + needsMore rows. Matches are reconciled (lazy auto-confirm)
// before aggregation so just-passed-deadline matches count.

interface TeamDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  players: Array<{ userId: string; firstName: string; lastName?: string }>;
  status?: "active" | "disbanded";
}

interface GroupDoc {
  id: string;
  settings?: { minMatchesForRanking?: number };
}

app.http("tournamentLeaderboard", {
  route: "tournaments/{tournamentId}/leaderboard",
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
    const reconciled = await reconcileMatches(matchesQ.resources);
    // Per spec §17: 'submitted' counts immediately; 'disputed' still counts
    // (but flagged). Only soft-deleted/admin-removed would be excluded.
    const counted: MatchAggregate[] = reconciled.map((m) => ({
      teamAId: m.teamAId,
      teamBId: m.teamBId,
      setsA: m.setsA,
      setsB: m.setsB,
      gamesA: m.gamesA,
      gamesB: m.gamesB,
      winner: m.winner,
    }));
    const minMatchesForRanking =
      groupRead?.resource?.settings?.minMatchesForRanking ?? 3;
    const teamIds = teams.map((t) => t.id);
    const { ranked, needsMore } = aggregateLeaderboard(
      teamIds,
      counted,
      minMatchesForRanking,
    );

    const byId = new Map(teams.map((t) => [t.id, t]));
    const decorate = (
      row: ReturnType<typeof aggregateLeaderboard>["ranked"][number],
    ): Record<string, unknown> => {
      const team = byId.get(row.teamId);
      return {
        ...row,
        players:
          team?.players.map((p) => ({
            userId: p.userId,
            firstName: p.firstName,
            ...(p.lastName ? { lastName: p.lastName } : {}),
          })) ?? [],
      };
    };

    return {
      status: 200,
      jsonBody: {
        ranked: ranked.map(decorate),
        needsMore: needsMore.map(decorate),
        minMatchesForRanking,
      },
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
