import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { containers_ } from "../shared/cosmos.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";
import {
  withIdempotency,
  IdempotencyConflict,
  IdempotencyInvalidKey,
} from "../shared/idempotency.js";
import { autoConfirmDueAt, type MatchDoc } from "../shared/matches.js";
import {
  evaluateMatch,
  ScoringError,
  type SetScore,
} from "../shared/scoring.js";

// POST /api/tournaments/{tournamentId}/matches
// Body: { opponentTeamId, sets: [{a,b}, {a,b}, {a,b}?] }
// Header: Idempotency-Key (required, spec §22.5)

interface Body {
  opponentTeamId?: unknown;
  sets?: unknown;
}

interface TournamentDoc {
  id: string;
  groupId: string;
  status: "draft" | "registration_open" | "live" | "ended";
}

interface TeamSlotDoc {
  teamId: string;
}

interface TeamDoc {
  id: string;
  tournamentId: string;
  groupId: string;
  status?: "active" | "disbanded";
}

app.http("matchSubmit", {
  route: "tournaments/{tournamentId}/matches",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroup(req);
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
    const opponentTeamId =
      typeof body.opponentTeamId === "string" ? body.opponentTeamId : "";
    if (!opponentTeamId) {
      return jsonError(400, "missing_opponent", "opponentTeamId required.");
    }
    const setsInput = parseSets(body.sets);
    if (!setsInput) {
      return jsonError(400, "invalid_sets", "sets must be an array of {a,b}.");
    }

    const idemKey = req.headers.get("idempotency-key");

    // Load tournament + caller's team + opponent team in parallel.
    const slotId = `${tournamentId}_${ctx.userId}`;
    const [tRead, slotRead, oppRead] = await Promise.all([
      containers_
        .tournaments()
        .item(tournamentId, ctx.groupId)
        .read<TournamentDoc>()
        .catch(() => null),
      containers_
        .teamSlots()
        .item(slotId, ctx.userId)
        .read<TeamSlotDoc>()
        .catch(() => null),
      containers_
        .teams()
        .item(opponentTeamId, ctx.groupId)
        .read<TeamDoc>()
        .catch(() => null),
    ]);

    const t = tRead?.resource;
    if (!t) return jsonError(404, "tournament_not_found", "Not found.");
    if (t.status !== "live") {
      return jsonError(
        409,
        "tournament_not_live",
        "Matches can only be submitted in a live tournament.",
      );
    }

    const slot = slotRead?.resource;
    if (!slot) {
      return jsonError(409, "not_in_team", "You are not on a team.");
    }
    if (slot.teamId === opponentTeamId) {
      return jsonError(400, "self_opponent", "Cannot play against yourself.");
    }

    const opp = oppRead?.resource;
    if (!opp || opp.tournamentId !== tournamentId) {
      return jsonError(404, "opponent_not_found", "Opponent team not found.");
    }

    let outcome;
    try {
      outcome = evaluateMatch(setsInput);
    } catch (err) {
      if (err instanceof ScoringError) {
        return jsonError(400, err.code, err.message);
      }
      throw err;
    }

    // Canonicalize team order (so {A,B} == {B,A} for replay detection later).
    const [teamAId, teamBId, winner, setsA, setsB, gamesA, gamesB] =
      slot.teamId < opponentTeamId
        ? [
            slot.teamId,
            opponentTeamId,
            outcome.winner,
            outcome.setsA,
            outcome.setsB,
            outcome.gamesA,
            outcome.gamesB,
          ]
        : [
            opponentTeamId,
            slot.teamId,
            outcome.winner === "A" ? ("B" as const) : ("A" as const),
            outcome.setsB,
            outcome.setsA,
            outcome.gamesB,
            outcome.gamesA,
          ];

    try {
      const result = await withIdempotency(
        ctx.userId,
        idemKey,
        { tournamentId, opponentTeamId, sets: setsInput },
        async () => {
          const submittedAt = new Date().toISOString();
          const doc: MatchDoc = {
            id: randomUUID(),
            groupId: ctx.groupId,
            tournamentId,
            teamAId,
            teamBId,
            submittedByUserId: ctx.userId,
            submittedByTeamId: slot.teamId,
            sets:
              teamAId === slot.teamId
                ? setsInput
                : setsInput.map((s) => ({ a: s.b, b: s.a })),
            winner,
            setsA,
            setsB,
            gamesA,
            gamesB,
            status: "submitted",
            submittedAt,
            autoConfirmDueAt: autoConfirmDueAt(submittedAt),
          };
          await containers_.matches().items.create(doc);
          return { status: 201, response: { match: doc } };
        },
      );
      if (!result.replayed && result.status < 300) {
        await refreshPinnedMessage(ctx.groupId);
      }
      const resp: HttpResponseInit = {
        status: result.status,
        jsonBody: result.response,
      };
      if (result.replayed) resp.headers = { "Idempotent-Replay": "true" };
      return resp;
    } catch (err) {
      if (err instanceof IdempotencyConflict) {
        return jsonError(422, "idempotency_conflict", "Different body.");
      }
      if (err instanceof IdempotencyInvalidKey) {
        return jsonError(
          400,
          "idempotency_invalid_key",
          "Idempotency-Key required.",
        );
      }
      const message = err instanceof Error ? err.message : "internal_error";
      return jsonError(500, "internal_error", message);
    }
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
