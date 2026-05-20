import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// POST /api/admin/tournaments/{tournamentId}/registrations/{userId}/unlock
// Clears `resigned` flag so the player can re-toggle Playing on themselves.
// Does NOT auto-set playing=true.

interface TournamentDoc {
  id: string;
  groupId: string;
  status: TournamentStatus;
}

interface RegistrationDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  userId: string;
  firstName: string;
  lastName?: string;
  playing: boolean;
  bbq: boolean;
  resigned?: boolean;
  resignedAt?: string;
  createdAt: string;
  updatedAt: string;
}

app.http("adminRegistrationUnlock", {
  route: "tournaments/{tournamentId}/admin/registrations/{userId}/unlock",
  methods: ["POST"],
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
        `Cannot unlock in status ${t.status}.`,
      );
    }

    const regRead = await containers_
      .registrations()
      .item(`${tournamentId}_${userId}`, ctx.groupId)
      .read<RegistrationDoc>()
      .catch(() => null);
    const reg = regRead?.resource;
    if (!reg) {
      return jsonError(
        404,
        "registration_not_found",
        "Registration not found.",
      );
    }
    const updated: RegistrationDoc = {
      ...reg,
      updatedAt: new Date().toISOString(),
    };
    delete updated.resigned;
    delete updated.resignedAt;
    await containers_.registrations().items.upsert(updated);
    await refreshPinnedMessage(ctx.groupId);
    return { status: 200, jsonBody: { registration: updated } };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
