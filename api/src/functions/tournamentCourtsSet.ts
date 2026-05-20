import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// PUT /api/tournaments/{tournamentId}/courts
// Body: { assignments: [{ courtId, teamIds[] }, ...] }
// Admin-only. Allowed in review only. No cap on teams per court; each team
// may appear at most once across all assignments.

interface CourtAssignment {
  courtId: string;
  teamIds: string[];
}

interface Body {
  assignments?: unknown;
}

interface TournamentDoc {
  id: string;
  groupId: string;
  status: TournamentStatus;
  settings: {
    tiebreakRule?: string;
    firstRoundCourts?: CourtAssignment[];
  };
  updatedAt: string;
}

interface GroupDoc {
  id: string;
  settings: {
    courts?: Array<{ id: string; label: string; color: "green" | "blue" }>;
  };
}

interface TeamDoc {
  id: string;
  status?: "active" | "disbanded";
}

app.http("tournamentCourtsSet", {
  route: "tournaments/{tournamentId}/courts",
  methods: ["PUT"],
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
    let body: Body;
    try {
      body = ((await req.json()) ?? {}) as Body;
    } catch {
      return jsonError(400, "invalid_body", "JSON body required.");
    }
    const assignments = parseAssignments(body.assignments);
    if (!assignments) {
      return jsonError(
        400,
        "invalid_assignments",
        "assignments must be an array of {courtId, teamIds}.",
      );
    }

    const [tRead, groupRead] = await Promise.all([
      containers_
        .tournaments()
        .item(tournamentId, ctx.groupId)
        .read<TournamentDoc>()
        .catch(() => null),
      containers_
        .groups()
        .item(ctx.groupId, ctx.groupId)
        .read<GroupDoc>()
        .catch(() => null),
    ]);
    const t = tRead?.resource;
    if (!t) return jsonError(404, "tournament_not_found", "Not found.");
    if (t.status !== "review") {
      return jsonError(
        409,
        "invalid_state",
        "Courts can only be assigned during review.",
      );
    }
    const courts = groupRead?.resource?.settings?.courts ?? [];
    if (courts.length === 0) {
      return jsonError(
        409,
        "no_courts_configured",
        "Group has no courts configured.",
      );
    }
    const validCourtIds = new Set(courts.map((c) => c.id));
    for (const a of assignments) {
      if (!validCourtIds.has(a.courtId)) {
        return jsonError(
          400,
          "unknown_court",
          `Unknown courtId: ${a.courtId}.`,
        );
      }
    }

    // Each team may appear at most once.
    const seen = new Set<string>();
    for (const a of assignments) {
      for (const tid of a.teamIds) {
        if (seen.has(tid)) {
          return jsonError(
            400,
            "team_assigned_twice",
            `Team ${tid} is on more than one court.`,
          );
        }
        seen.add(tid);
      }
    }

    // Validate every teamId belongs to this tournament.
    const allTeamIds = [...seen];
    if (allTeamIds.length > 0) {
      const teamsQ = await containers_
        .teams()
        .items.query<TeamDoc>(
          {
            query:
              "SELECT c.id, c.status FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
            parameters: [
              { name: "@g", value: ctx.groupId },
              { name: "@t", value: tournamentId },
            ],
          },
          { partitionKey: ctx.groupId },
        )
        .fetchAll();
      const validTeamIds = new Set(
        teamsQ.resources
          .filter((tt) => tt.status !== "disbanded")
          .map((tt) => tt.id),
      );
      for (const tid of allTeamIds) {
        if (!validTeamIds.has(tid)) {
          return jsonError(400, "unknown_team", `Unknown teamId: ${tid}.`);
        }
      }
    }

    const updated: TournamentDoc = {
      ...t,
      settings: { ...t.settings, firstRoundCourts: assignments },
      updatedAt: new Date().toISOString(),
    };
    await containers_.tournaments().items.upsert(updated);
    await refreshPinnedMessage(ctx.groupId);
    return { status: 200, jsonBody: { tournament: updated } };
  },
});

function parseAssignments(raw: unknown): CourtAssignment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CourtAssignment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const r = item as { courtId?: unknown; teamIds?: unknown };
    if (typeof r.courtId !== "string") return null;
    if (!Array.isArray(r.teamIds)) return null;
    const teamIds: string[] = [];
    for (const t of r.teamIds) {
      if (typeof t !== "string" || !t) return null;
      teamIds.push(t);
    }
    out.push({ courtId: r.courtId, teamIds });
  }
  return out;
}

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
