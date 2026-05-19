import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";

// POST /api/tournaments/{tournamentId}/start
// Admin-only. Transitions registration_open → live.

interface TournamentDoc {
  id: string;
  groupId: string;
  status: "draft" | "registration_open" | "live" | "ended";
  updatedAt: string;
}

app.http("tournamentStart", {
  route: "tournaments/{tournamentId}/start",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      const m = mapGroupContextError(err);
      return jsonError(m.status, m.code, m.code);
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
    if (t.status === "live") {
      return { status: 200, jsonBody: { tournament: t } };
    }
    if (t.status !== "registration_open" && t.status !== "draft") {
      return jsonError(
        409,
        "invalid_state",
        `Cannot start a tournament in status ${t.status}.`,
      );
    }

    const updated: TournamentDoc = {
      ...t,
      status: "live",
      updatedAt: new Date().toISOString(),
    };
    await containers_.tournaments().items.upsert(updated);
    await refreshPinnedMessage(ctx.groupId, { force: true });

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
