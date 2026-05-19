import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import type { MatchDoc } from "../shared/matches.js";
import {
  evaluateMatch,
  normalizeTiebreakRule,
  ScoringError,
  type SetScore,
} from "../shared/scoring.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";

// PATCH /api/matches/{matchId}
// Admin-only. Edit sets and/or status of a match.
// Body: { sets?: [{a,b}, ...], status?: 'confirmed' | 'disputed' }
// - If `sets` is provided, the match is re-evaluated (winner/setsA/setsB/gamesA/gamesB)
//   and (unless `status` is given) status is set to 'confirmed'.
// - The stored sets keep the existing teamA/teamB orientation (caller provides
//   sets in teamA-first order, matching the stored shape).

interface Body {
  sets?: unknown;
  status?: unknown;
}

interface TournamentDoc {
  id: string;
  groupId: string;
  settings?: { tiebreakRule?: string };
}

interface GroupDoc {
  id: string;
  settings?: { tiebreakRule?: string };
}

app.http("matchAdminEdit", {
  route: "matches/{matchId}",
  methods: ["PATCH"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      return mapGroupContextError(err);
    }

    const matchId = req.params["matchId"];
    if (!matchId) {
      return jsonError(400, "missing_match_id", "matchId required");
    }

    let body: Body;
    try {
      body = ((await req.json()) ?? {}) as Body;
    } catch {
      return jsonError(400, "invalid_body", "JSON body required.");
    }

    const sets = body.sets === undefined ? null : parseSets(body.sets);
    if (body.sets !== undefined && sets === null) {
      return jsonError(400, "invalid_sets", "sets must be an array of {a,b}.");
    }
    const statusInput =
      body.status === "confirmed" || body.status === "disputed"
        ? body.status
        : null;
    if (body.status !== undefined && statusInput === null) {
      return jsonError(400, "invalid_status", "status invalid.");
    }
    if (sets === null && statusInput === null) {
      return jsonError(400, "nothing_to_update", "Provide sets or status.");
    }

    const mRead = await containers_
      .matches()
      .item(matchId, ctx.groupId)
      .read<MatchDoc>()
      .catch(() => null);
    const match = mRead?.resource;
    if (!match) return jsonError(404, "match_not_found", "Not found.");

    let updated: MatchDoc = { ...match };
    if (sets) {
      const [tRead, gRead] = await Promise.all([
        containers_
          .tournaments()
          .item(match.tournamentId, ctx.groupId)
          .read<TournamentDoc>()
          .catch(() => null),
        containers_
          .groups()
          .item(ctx.groupId, ctx.groupId)
          .read<GroupDoc>()
          .catch(() => null),
      ]);
      const rule = normalizeTiebreakRule(
        tRead?.resource?.settings?.tiebreakRule ??
          gRead?.resource?.settings?.tiebreakRule,
      );
      let outcome;
      try {
        outcome = evaluateMatch(sets, rule);
      } catch (err) {
        if (err instanceof ScoringError) {
          return jsonError(400, err.code, err.message);
        }
        throw err;
      }
      updated = {
        ...updated,
        sets,
        winner: outcome.winner,
        setsA: outcome.setsA,
        setsB: outcome.setsB,
        gamesA: outcome.gamesA,
        gamesB: outcome.gamesB,
      };
    }

    const nowIso = new Date().toISOString();
    updated.editedAt = nowIso;
    updated.editedByUserId = ctx.userId;
    if (statusInput) {
      updated.status = statusInput;
    } else if (sets) {
      updated.status = "confirmed";
    }
    if (updated.status === "confirmed" && !updated.confirmedAt) {
      updated.confirmedAt = nowIso;
      updated.confirmedByUserId = ctx.userId;
    }

    await containers_.matches().items.upsert(updated);
    await refreshPinnedMessage(ctx.groupId);
    return { status: 200, jsonBody: { match: updated } };
  },
});

function parseSets(raw: unknown): SetScore[] | null {
  if (!Array.isArray(raw)) return null;
  const out: SetScore[] = [];
  for (const item of raw) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as { a?: unknown }).a !== "number" ||
      typeof (item as { b?: unknown }).b !== "number"
    ) {
      return null;
    }
    out.push({ a: (item as SetScore).a, b: (item as SetScore).b });
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
