import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";
import type { MatchDoc } from "../shared/matches.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";

// POST /api/matches/{matchId}/dispute
// Caller must be on either team. Marks the match disputed; spec §31 keeps
// the result counted but flagged for admin review.

interface TeamSlotDoc {
  teamId: string;
}

app.http("matchDispute", {
  route: "matches/{matchId}/dispute",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroup(req);
    } catch (err) {
      const m = mapGroupContextError(err);
      return jsonError(m.status, m.code, m.code);
    }

    const matchId = req.params["matchId"];
    if (!matchId) {
      return jsonError(400, "missing_match_id", "matchId required");
    }

    const mRead = await containers_
      .matches()
      .item(matchId, ctx.groupId)
      .read<MatchDoc>()
      .catch(() => null);
    const match = mRead?.resource;
    if (!match) return jsonError(404, "match_not_found", "Not found.");

    if (match.status === "disputed") {
      return { status: 200, jsonBody: { match } };
    }

    const slotId = `${match.tournamentId}_${ctx.userId}`;
    const slotRead = await containers_
      .teamSlots()
      .item(slotId, ctx.userId)
      .read<TeamSlotDoc>()
      .catch(() => null);
    const myTeamId = slotRead?.resource?.teamId;
    if (!myTeamId) {
      return jsonError(403, "not_in_team", "Not on a team.");
    }
    if (myTeamId !== match.teamAId && myTeamId !== match.teamBId) {
      return jsonError(403, "not_a_participant", "Not in this match.");
    }

    const updated: MatchDoc = {
      ...match,
      status: "disputed",
      disputedAt: new Date().toISOString(),
      disputedByUserId: ctx.userId,
    };
    await containers_.matches().items.upsert(updated);
    await refreshPinnedMessage(ctx.groupId);

    return { status: 200, jsonBody: { match: updated } };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
