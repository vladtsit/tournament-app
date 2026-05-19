import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { reconcileMatches, type MatchDoc } from "../shared/matches.js";

// GET /api/tournaments/{tournamentId}/results-export
// Admin-only. CSV columns:
//   matchId, submittedAt, status, teamA, teamB, set1, set2, set3, winner, submittedByUserId

interface TeamDoc {
  id: string;
  players: Array<{ userId: string; firstName: string; lastName?: string }>;
}

app.http("adminResultsExport", {
  route: "tournaments/{tournamentId}/results-export",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      return mapGroupContextError(err);
    }

    const tournamentId = req.params["tournamentId"];
    if (!tournamentId) {
      return jsonError(400, "missing_tournament_id", "tournamentId required");
    }

    const [matchesQ, teamsQ] = await Promise.all([
      containers_
        .matches()
        .items.query<MatchDoc>(
          {
            query:
              "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t ORDER BY c.submittedAt",
            parameters: [
              { name: "@g", value: ctx.groupId },
              { name: "@t", value: tournamentId },
            ],
          },
          { partitionKey: ctx.groupId },
        )
        .fetchAll(),
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
    ]);

    const reconciled = await reconcileMatches(matchesQ.resources);
    const teamLabels = new Map<string, string>();
    for (const t of teamsQ.resources) {
      teamLabels.set(
        t.id,
        t.players
          .map((p) =>
            p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName,
          )
          .join(" + "),
      );
    }
    const labelFor = (id: string): string =>
      teamLabels.get(id) ?? id.slice(0, 6);

    const rows: string[] = [
      [
        "matchId",
        "submittedAt",
        "status",
        "teamA",
        "teamB",
        "set1",
        "set2",
        "set3",
        "winner",
        "submittedByUserId",
      ]
        .map(csvCell)
        .join(","),
    ];
    for (const m of reconciled) {
      const setStr = (i: number): string => {
        const s = m.sets[i];
        return s ? `${s.a}-${s.b}` : "";
      };
      rows.push(
        [
          m.id,
          m.submittedAt,
          m.status,
          labelFor(m.teamAId),
          labelFor(m.teamBId),
          setStr(0),
          setStr(1),
          setStr(2),
          m.winner === "A" ? labelFor(m.teamAId) : labelFor(m.teamBId),
          m.submittedByUserId,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    return {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="results-${tournamentId}.csv"`,
      },
      body: rows.join("\n") + "\n",
    };
  },
});

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
