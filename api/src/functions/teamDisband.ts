import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";
import {
  withIdempotency,
  IdempotencyConflict,
  IdempotencyInvalidKey,
} from "../shared/idempotency.js";
import { disbandTeam, type TeamDoc } from "../shared/teams.js";

// DELETE /api/tournaments/{tournamentId}/teams/{teamId}
// Header: Idempotency-Key (required)
//
// Disband a team while the tournament is still in `registration_open`.
// Both team_slots are deleted (different partitions /userId — parallel,
// best-effort) and the teams doc is hard-deleted. Idempotent: re-calling
// after the team is gone returns 200 with `{ disbanded: true }`.

interface TournamentDoc {
  id: string;
  groupId: string;
  status: "draft" | "registration_open" | "live" | "ended";
}

interface DisbandResponse {
  disbanded: true;
}

app.http("teamDisband", {
  route: "tournaments/{tournamentId}/teams/{teamId}",
  methods: ["DELETE"],
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
    const teamId = req.params["teamId"];
    if (!tournamentId) {
      return jsonError(400, "missing_tournament_id", "tournamentId required");
    }
    if (!teamId) {
      return jsonError(400, "missing_team_id", "teamId required");
    }

    const idemKey = req.headers.get("idempotency-key");

    // Tournament must be in registration_open.
    const tRead = await containers_
      .tournaments()
      .item(tournamentId, ctx.groupId)
      .read<TournamentDoc>()
      .catch(() => null);
    const t = tRead?.resource;
    if (!t)
      return jsonError(404, "tournament_not_found", "Tournament not found.");
    if (t.status !== "registration_open") {
      return jsonError(
        409,
        "cannot_leave_team",
        "Teams can no longer be changed.",
      );
    }

    try {
      const result = await withIdempotency<DisbandResponse | { error: { code: string; message: string } }>(
        ctx.userId,
        idemKey,
        { tournamentId, teamId, op: "disband" },
        async () => disbandTeamHandler(ctx.groupId, tournamentId, teamId, ctx.userId),
      );
      const resp: HttpResponseInit = {
        status: result.status,
        jsonBody: result.response,
      };
      if (result.replayed) resp.headers = { "Idempotent-Replay": "true" };
      return resp;
    } catch (err) {
      if (err instanceof IdempotencyConflict) {
        return jsonError(
          422,
          "idempotency_conflict",
          "Different body for same Idempotency-Key.",
        );
      }
      if (err instanceof IdempotencyInvalidKey) {
        return jsonError(
          400,
          "idempotency_invalid_key",
          "Header Idempotency-Key is required.",
        );
      }
      const message = err instanceof Error ? err.message : "internal_error";
      return jsonError(500, "internal_error", message);
    }
  },
});

async function disbandTeamHandler(
  groupId: string,
  tournamentId: string,
  teamId: string,
  callerUserId: string,
): Promise<{
  status: number;
  response: DisbandResponse | { error: { code: string; message: string } };
}> {
  const teamRead = await containers_
    .teams()
    .item(teamId, groupId)
    .read<TeamDoc>()
    .catch(() => null);
  const team = teamRead?.resource;

  if (!team) {
    // Already gone — idempotent success.
    return { status: 200, response: { disbanded: true } };
  }
  if (team.tournamentId !== tournamentId) {
    return errResp(404, "tournament_not_found", "Team is not in this tournament.");
  }
  const isMember = team.players.some((p) => p.userId === callerUserId);
  if (!isMember) {
    return errResp(403, "not_a_team_member", "You are not on this team.");
  }

  await disbandTeam(groupId, tournamentId, teamId);

  return { status: 200, response: { disbanded: true } };
}

function errResp(
  status: number,
  code: string,
  message: string,
): {
  status: number;
  response: { error: { code: string; message: string } };
} {
  return { status, response: { error: { code, message } } };
}

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
