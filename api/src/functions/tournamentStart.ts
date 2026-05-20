import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// POST /api/tournaments/{tournamentId}/start
// Admin-only. Transitions review → live. Pre-conditions:
//   1. status === 'review'
//   2. every playing (non-resigned) registration belongs to a
//      confirmedByAdmin team
//   3. playing count is even
//   4. settings.firstRoundCourts is set and non-empty

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

interface RegistrationDoc {
  id: string;
  userId: string;
  playing: boolean;
  resigned?: boolean;
}

interface TeamDoc {
  id: string;
  players: Array<{ userId: string }>;
  confirmedByAdmin?: boolean;
  status?: "active" | "disbanded";
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
    if (t.status === "live") {
      return { status: 200, jsonBody: { tournament: t } };
    }
    if (t.status !== "review") {
      return jsonError(
        409,
        "invalid_state",
        `Cannot start a tournament in status ${t.status}.`,
      );
    }

    const [regsQ, teamsQ] = await Promise.all([
      containers_
        .registrations()
        .items.query<RegistrationDoc>(
          {
            query:
              "SELECT c.id, c.userId, c.playing, c.resigned FROM c WHERE c.groupId = @g AND c.tournamentId = @t AND c.playing = true AND (NOT IS_DEFINED(c.resigned) OR c.resigned = false)",
            parameters: [
              { name: "@g", value: ctx.groupId },
              { name: "@t", value: tournamentId },
            ],
          },
          { partitionKey: ctx.groupId },
        )
        .fetchAll(),
      containers_
        .teams()
        .items.query<TeamDoc>(
          {
            query:
              "SELECT c.id, c.players, c.confirmedByAdmin, c.status FROM c WHERE c.groupId = @g AND c.tournamentId = @t AND (NOT IS_DEFINED(c.status) OR c.status = 'active')",
            parameters: [
              { name: "@g", value: ctx.groupId },
              { name: "@t", value: tournamentId },
            ],
          },
          { partitionKey: ctx.groupId },
        )
        .fetchAll(),
    ]);
    const regs = regsQ.resources;
    const teams = teamsQ.resources;

    if (regs.length % 2 !== 0) {
      return jsonError(
        409,
        "odd_player_count",
        "Number of playing participants must be even.",
      );
    }

    const teamedUserIds = new Set<string>();
    for (const team of teams) {
      if (!team.confirmedByAdmin) {
        return jsonError(
          409,
          "not_all_confirmed",
          "All teams must be confirmed by the admin.",
        );
      }
      for (const p of team.players) teamedUserIds.add(p.userId);
    }
    for (const r of regs) {
      if (!teamedUserIds.has(r.userId)) {
        return jsonError(
          409,
          "not_all_confirmed",
          "Some players are not in a confirmed team.",
        );
      }
    }

    const courts = t.settings.firstRoundCourts ?? [];
    const hasCourtAssignments =
      courts.length > 0 && courts.some((c) => c.teamIds.length > 0);
    if (!hasCourtAssignments) {
      return jsonError(
        409,
        "courts_not_assigned",
        "Assign first-round courts before starting.",
      );
    }

    const updated: TournamentDoc = {
      ...t,
      status: "live",
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
