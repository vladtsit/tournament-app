import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import type { TeamDoc } from "../shared/teams.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// POST   /api/admin/teams/{teamId}/confirm   → confirmedByAdmin = true
// DELETE /api/admin/teams/{teamId}/confirm   → confirmedByAdmin = false
// Admin-only. Allowed in registration_open or review.

interface TournamentDoc {
  id: string;
  groupId: string;
  status: TournamentStatus;
}

async function handle(
  req: HttpRequest,
  confirm: boolean,
): Promise<HttpResponseInit> {
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
  if (!team || team.status === "disbanded") {
    return jsonError(404, "team_not_found", "Team not found.");
  }

  const tRead = await containers_
    .tournaments()
    .item(team.tournamentId, ctx.groupId)
    .read<TournamentDoc>()
    .catch(() => null);
  const tournament = tRead?.resource;
  if (!tournament) {
    return jsonError(404, "tournament_not_found", "Tournament not found.");
  }
  if (
    tournament.status !== "registration_open" &&
    tournament.status !== "review"
  ) {
    return jsonError(
      409,
      "invalid_state",
      `Cannot change team confirmation in status ${tournament.status}.`,
    );
  }

  const now = new Date().toISOString();
  const updated: TeamDoc = { ...team, updatedAt: now };
  if (confirm) {
    updated.confirmedByAdmin = true;
    updated.confirmedByAdminAt = now;
    updated.confirmedByAdminUserId = ctx.userId;
  } else {
    updated.confirmedByAdmin = false;
    delete updated.confirmedByAdminAt;
    delete updated.confirmedByAdminUserId;
  }
  await containers_.teams().items.upsert(updated);
  await refreshPinnedMessage(ctx.groupId);

  return { status: 200, jsonBody: { team: updated } };
}

app.http("teamAdminConfirm", {
  route: "teams/{teamId}/admin-confirm",
  methods: ["POST", "DELETE"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest) => handle(req, req.method === "POST"),
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
