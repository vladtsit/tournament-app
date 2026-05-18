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

    // Ended tournaments: serve frozen finalStandings (spec §18.5).
    const tRead = await containers_
      .tournaments()
      .item(tournamentId, ctx.groupId)
      .read<{
        status: string;
        finalStandings?: Array<{
          rank: number;
          teamId: string;
          members: string[];
          matches: number;
          wins: number;
          losses: number;
          setsFor: number;
          setsAgainst: number;
        }>;
      }>()
      .catch(() => null);
    if (tRead?.resource?.status === "ended" && tRead.resource.finalStandings) {
      const teamsQ = await containers_
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
        .fetchAll();
      const byId = new Map(teamsQ.resources.map((t) => [t.id, t]));
      const rows = tRead.resource.finalStandings.map((s) => {
        const team = byId.get(s.teamId);
        return {
          teamId: s.teamId,
          matches: s.matches,
          wins: s.wins,
          losses: s.losses,
          setsFor: s.setsFor,
          setsAgainst: s.setsAgainst,
          winRate: s.matches === 0 ? 0 : s.wins / s.matches,
          setRatio: s.setsFor / Math.max(s.setsAgainst, 1),
          gameRatio: 0,
          players:
            team?.players.map((p) => ({
              userId: p.userId,
              firstName: p.firstName,
              ...(p.lastName ? { lastName: p.lastName } : {}),
            })) ?? [],
        };
      });
      return {
        status: 200,
        jsonBody: {
          ranked: rows,
          needsMore: [],
          minMatchesForRanking: 0,
          frozen: true,
        },
      };
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
