import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";
import type { MatchDoc } from "../shared/matches.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";

// POST /api/matches/{matchId}/confirm?tournamentId=...
// Caller must be on the *opposing* team (not the submitter team).

interface TeamSlotDoc {
  teamId: string;
}

app.http("matchConfirm", {
  route: "matches/{matchId}/confirm",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroup(req);
    } catch (err) {
      return mapGroupContextError(err);
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

    if (match.status === "confirmed") {
      return { status: 200, jsonBody: { match } };
    }
    if (match.status === "disputed") {
      return jsonError(
        409,
        "invalid_state",
        "Disputed matches cannot be confirmed.",
      );
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
    // The opposing team must confirm. Prefer the team-id check; fall back to
    // the user-id check for legacy docs that pre-date `submittedByTeamId`.
    const submitterTeamId = match.submittedByTeamId;
    const isOwnTeamSubmission =
      submitterTeamId !== undefined
        ? myTeamId === submitterTeamId
        : ctx.userId === match.submittedByUserId;
    if (isOwnTeamSubmission) {
      return jsonError(
        403,
        "cannot_confirm_own_submission",
        "Opposing team must confirm.",
      );
    }

    const updated: MatchDoc = {
      ...match,
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
      confirmedByUserId: ctx.userId,
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
