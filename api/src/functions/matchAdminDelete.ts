import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";

// DELETE /api/matches/{matchId}
// Admin-only. Hard-deletes the match document. The leaderboard re-queries
// matches on every read so the team stats update on the next refresh.

app.http("matchAdminDelete", {
  route: "matches/{matchId}",
  methods: ["DELETE"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      const m = mapGroupContextError(err);
      return jsonError(m.status, m.code, m.code);
    }

    const matchId = req.params["matchId"];
    if (!matchId) {
      return jsonError(400, "missing_match_id", "matchId required");
    }

    try {
      await containers_.matches().item(matchId, ctx.groupId).delete();
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 404) {
        return jsonError(404, "match_not_found", "Not found.");
      }
      throw err;
    }
    return { status: 204 };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
