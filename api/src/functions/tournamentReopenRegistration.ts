import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// POST /api/tournaments/{tournamentId}/reopen-registration
// Admin-only. Transitions review → registration_open. Clears any
// `firstRoundCourts` assignment so admin starts fresh next time.

interface TournamentDoc {
  id: string;
  groupId: string;
  status: TournamentStatus;
  settings: {
    tiebreakRule?: string;
    firstRoundCourts?: Array<{ courtId: string; teamIds: string[] }>;
  };
  updatedAt: string;
}

app.http("tournamentReopenRegistration", {
  route: "tournaments/{tournamentId}/reopen-registration",
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
    if (t.status === "registration_open") {
      return { status: 200, jsonBody: { tournament: t } };
    }
    if (t.status !== "review") {
      return jsonError(
        409,
        "invalid_state",
        `Cannot reopen registration in status ${t.status}.`,
      );
    }

    const nextSettings: TournamentDoc["settings"] = { ...t.settings };
    delete nextSettings.firstRoundCourts;
    const updated: TournamentDoc = {
      ...t,
      status: "registration_open",
      settings: nextSettings,
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
