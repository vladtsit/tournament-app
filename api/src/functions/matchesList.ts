import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";
import { reconcileMatches, type MatchDoc } from "../shared/matches.js";

// GET /api/tournaments/{tournamentId}/matches
// Returns all matches for the tournament, applying lazy auto-confirm.

app.http("matchesList", {
  route: "tournaments/{tournamentId}/matches",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroup(req);
    } catch (err) {
      return mapGroupContextError(err);
    }

    const tournamentId = req.params["tournamentId"];
    if (!tournamentId) {
      return jsonError(400, "missing_tournament_id", "tournamentId required");
    }

    const q = await containers_
      .matches()
      .items.query<MatchDoc>(
        {
          query:
            "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t ORDER BY c.submittedAt DESC",
          parameters: [
            { name: "@g", value: ctx.groupId },
            { name: "@t", value: tournamentId },
          ],
        },
        { partitionKey: ctx.groupId },
      )
      .fetchAll();

    const reconciled = await reconcileMatches(q.resources);
    return { status: 200, jsonBody: { matches: reconciled } };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
