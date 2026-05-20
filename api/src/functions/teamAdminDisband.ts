import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import { disbandTeam, type TeamDoc } from "../shared/teams.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// DELETE /api/admin/teams/{teamId}
// Admin override: split a team back to singletons (clears confirmation).
// Allowed in registration_open or review.

interface TournamentDoc {
  id: string;
  groupId: string;
  status: TournamentStatus;
}

app.http("teamAdminDisband", {
  route: "admin/teams/{teamId}",
  methods: ["DELETE"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      return mapGroupContextError(err);
    }
    const teamId = req.params["teamId"];
    if (!teamId) return jsonError(400, "missing_team_id", "teamId required");

    const teamRead = await containers_
      .teams()
      .item(teamId, ctx.groupId)
      .read<TeamDoc>()
      .catch(() => null);
    const team = teamRead?.resource;
    if (!team) {
      return { status: 200, jsonBody: { disbanded: true } };
    }
    const tRead = await containers_
      .tournaments()
      .item(team.tournamentId, ctx.groupId)
      .read<TournamentDoc>()
      .catch(() => null);
    const t = tRead?.resource;
    if (!t) return jsonError(404, "tournament_not_found", "Not found.");
    if (t.status !== "registration_open" && t.status !== "review") {
      return jsonError(
        409,
        "invalid_state",
        `Cannot disband team in status ${t.status}.`,
      );
    }
    await disbandTeam(ctx.groupId, team.tournamentId, teamId);
    await refreshPinnedMessage(ctx.groupId);
    return { status: 200, jsonBody: { disbanded: true } };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
