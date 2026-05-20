import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// POST /api/tournaments/{tournamentId}/stop-registration
// Admin-only. Transitions registration_open → review. Admin will finish
// pairing, confirming and court-assignment in the review state.

interface TournamentDoc {
  id: string;
  groupId: string;
  status: TournamentStatus;
  settings: Record<string, unknown>;
  updatedAt: string;
}

app.http("tournamentStopRegistration", {
  route: "tournaments/{tournamentId}/stop-registration",
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
    if (!tournamentId) {
      return jsonError(400, "missing_tournament_id", "tournamentId required");
    }

    const tRead = await containers_
      .tournaments()
      .item(tournamentId, ctx.groupId)
      .read<TournamentDoc>()
      .catch(() => null);
    const t = tRead?.resource;
    if (!t) return jsonError(404, "tournament_not_found", "Not found.");
    if (t.status === "review") {
      return { status: 200, jsonBody: { tournament: t } };
    }
    if (t.status !== "registration_open") {
      return jsonError(
        409,
        "invalid_state",
        `Cannot stop registration in status ${t.status}.`,
      );
    }

    const updated: TournamentDoc = {
      ...t,
      status: "review",
      updatedAt: new Date().toISOString(),
    };
    await containers_.tournaments().items.upsert(updated);
    await refreshPinnedMessage(ctx.groupId);

    return { status: 200, jsonBody: { tournament: updated } };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
