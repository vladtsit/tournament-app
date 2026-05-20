import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";
import {
  withIdempotency,
  IdempotencyConflict,
  IdempotencyInvalidKey,
} from "../shared/idempotency.js";
import { disbandTeamForUser } from "../shared/teams.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";

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
  resigned?: boolean;
  resignedAt?: string;
  addedByAdminUserId?: string;
  addedByAdminAt?: string;
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
    if (!t)
      return jsonError(404, "tournament_not_found", "Tournament not found.");
    if (t.status !== "registration_open" && t.status !== "draft") {
      return jsonError(
        409,
        "registration_closed",
        "Registration is closed for this tournament.",
      );
    }

    try {
      const result = await withIdempotency<
        | { registration: RegistrationDoc; teamDisbanded: boolean }
        | { error: { code: string; message: string } }
      >(ctx.userId, idemKey, { playing, bbq, tournamentId }, async () => {
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

        // Resign-lock: once a player resigns, only an admin can unlock
        // them (POST /api/admin/.../registrations/{userId}/unlock).
        if (playing && existing?.resigned === true) {
          return {
            status: 409,
            response: {
              error: {
                code: "registration_locked",
                message: "You have resigned. Ask an admin to let you back in.",
              },
            },
          };
        }

        // Detect resign transition (playing→not-playing while previously
        // marked playing). Setting resigned=true blocks self re-toggle.
        const becomingResigned =
          !playing && existing?.playing === true && existing.resigned !== true;

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
        if (existing?.addedByAdminUserId) {
          doc.addedByAdminUserId = existing.addedByAdminUserId;
        }
        if (existing?.addedByAdminAt) {
          doc.addedByAdminAt = existing.addedByAdminAt;
        }
        if (becomingResigned) {
          doc.resigned = true;
          doc.resignedAt = now;
        } else if (existing?.resigned === true) {
          // Keep resigned flag if already set (admin can clear via unlock).
          doc.resigned = true;
          if (existing.resignedAt) doc.resignedAt = existing.resignedAt;
        }
        await containers_.registrations().items.upsert(doc);

        // Auto-disband: if the player toggles playing=false and is on a
        // team, dissolve it so the partner is freed. Resigning trumps
        // team-lock (the partner becomes unpaired).
        let teamDisbanded = false;
        if (!playing) {
          const r = await disbandTeamForUser(
            ctx.groupId,
            tournamentId,
            ctx.userId,
          );
          teamDisbanded = r.disbanded;
        }
        return {
          status: 200,
          response: { registration: doc, teamDisbanded },
        };
      });
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
