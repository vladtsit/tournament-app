import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import { disbandTeamForUser } from "../shared/teams.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// DELETE /api/admin/tournaments/{tournamentId}/registrations/{userId}
// Admin-only. Removes a player from the tournament: disbands their team
// (if any) and hard-deletes the registration doc. Player can be re-added
// later via adminRegistrationAdd.

interface TournamentDoc {
  id: string;
  groupId: string;
  status: TournamentStatus;
}

app.http("adminRegistrationRemove", {
  route: "tournaments/{tournamentId}/admin/registrations/{userId}",
  methods: ["DELETE"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      return mapGroupContextError(err);
    }
    const tournamentId = req.params["tournamentId"];
    const userId = req.params["userId"];
    if (!tournamentId || !userId) {
      return jsonError(
        400,
        "missing_params",
        "tournamentId and userId required",
      );
    }
    const tRead = await containers_
      .tournaments()
      .item(tournamentId, ctx.groupId)
      .read<TournamentDoc>()
      .catch(() => null);
    const t = tRead?.resource;
    if (!t) return jsonError(404, "tournament_not_found", "Not found.");
    if (t.status !== "registration_open" && t.status !== "review") {
      return jsonError(
        409,
        "invalid_state",
        `Cannot remove registrations in status ${t.status}.`,
      );
    }
    await disbandTeamForUser(ctx.groupId, tournamentId, userId);
    await containers_
      .registrations()
      .item(`${tournamentId}_${userId}`, ctx.groupId)
      .delete()
      .catch(() => undefined);
    await refreshPinnedMessage(ctx.groupId);
    return { status: 200, jsonBody: { removed: true } };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
