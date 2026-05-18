import {
  app,
  type HttpRequest,
  type HttpResponseInit,
} from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroup,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import {
  withIdempotency,
  IdempotencyConflict,
  IdempotencyInvalidKey,
} from "../shared/idempotency.js";

// POST /api/tournaments/{tournamentId}/registrations
// Body: { playing: boolean, bbq: boolean }
// Header: Idempotency-Key (required, per spec §22.5)
//
// Upserts the caller's registration for the given tournament in the JWT's group.

interface Body {
  playing?: unknown;
  bbq?: unknown;
}

interface TournamentDoc {
  id: string;
  groupId: string;
  status: "draft" | "registration_open" | "live" | "ended";
}

interface UserDoc {
  id: string;
  firstName: string;
  lastName?: string;
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
  createdAt: string;
  updatedAt: string;
}

app.http("registrationUpsert", {
  route: "tournaments/{tournamentId}/registrations",
  methods: ["POST"],
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
    if (!tournamentId) {
      return jsonError(400, "missing_tournament_id", "tournamentId required");
    }

    let body: Body;
    try {
      body = ((await req.json()) ?? {}) as Body;
    } catch {
      return jsonError(400, "invalid_body", "Request body must be JSON.");
    }
    const playing = body.playing === true;
    const bbq = body.bbq === true;

    const idemKey = req.headers.get("idempotency-key");

    // Verify tournament exists, belongs to group, accepts registrations.
    const tRead = await containers_
      .tournaments()
      .item(tournamentId, ctx.groupId)
      .read<TournamentDoc>()
      .catch(() => null);
    const t = tRead?.resource;
    if (!t) return jsonError(404, "tournament_not_found", "Tournament not found.");
    if (t.status !== "registration_open" && t.status !== "draft") {
      return jsonError(
        409,
        "registration_closed",
        "Registration is closed for this tournament.",
      );
    }

    try {
      const result = await withIdempotency(
        ctx.userId,
        idemKey,
        { playing, bbq, tournamentId },
        async () => {
          // Fetch firstName for denormalization.
          const userRead = await containers_
            .users()
            .item(ctx.userId, ctx.userId)
            .read<UserDoc>()
            .catch(() => null);
          const firstName = userRead?.resource?.firstName ?? "Player";
          const lastName = userRead?.resource?.lastName;

          const regId = `${tournamentId}_${ctx.userId}`;
          const existingRead = await containers_
            .registrations()
            .item(regId, ctx.groupId)
            .read<RegistrationDoc>()
            .catch(() => null);
          const existing = existingRead?.resource;
          const now = new Date().toISOString();
          const doc: RegistrationDoc = {
            id: regId,
            groupId: ctx.groupId,
            tournamentId,
            userId: ctx.userId,
            firstName,
            playing,
            bbq,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          if (lastName) doc.lastName = lastName;
          await containers_.registrations().items.upsert(doc);
          return { status: 200, response: { registration: doc } };
        },
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
          "Header Idempotency-Key is required and must match [A-Za-z0-9_\\-:.]{1,128}.",
        );
      }
      const message = err instanceof Error ? err.message : "internal_error";
      return jsonError(500, "internal_error", message);
    }
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
