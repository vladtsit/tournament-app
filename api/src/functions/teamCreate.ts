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

// POST /api/tournaments/{tournamentId}/teams
// Body: { partnerUserId: string }
// Header: Idempotency-Key (required)
//
// Phase 2 simplification: instant pairing instead of multi-step invites.
// The caller selects a partner from `looking-for-teammate`; both `team_slots`
// docs are created sequentially (different partitions → no cross-partition
// transactional batch on the SDK). Rollback on partial failure.

interface Body {
  partnerUserId?: unknown;
}

interface RegistrationDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  userId: string;
  firstName: string;
  lastName?: string;
  playing: boolean;
}

interface TeamSlotDoc {
  id: string;
  userId: string;
  tournamentId: string;
  teamId: string;
  groupId: string;
  createdAt: string;
}

interface TeamDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  players: Array<{ userId: string; firstName: string; lastName?: string }>;
  status: "active" | "disbanded";
  confirmedByAdmin: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface TournamentDoc {
  id: string;
  groupId: string;
  status: "draft" | "registration_open" | "live" | "ended";
}

app.http("teamCreate", {
  route: "tournaments/{tournamentId}/teams",
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
    const partnerUserId =
      typeof body.partnerUserId === "string" ? body.partnerUserId.trim() : "";
    if (!partnerUserId) {
      return jsonError(400, "missing_partner", "partnerUserId required");
    }
    if (partnerUserId === ctx.userId) {
      return jsonError(400, "partner_is_self", "Pick a different partner.");
    }

    const idemKey = req.headers.get("idempotency-key");

    // Verify tournament accepts team creation.
    const tRead = await containers_
      .tournaments()
      .item(tournamentId, ctx.groupId)
      .read<TournamentDoc>()
      .catch(() => null);
    const t = tRead?.resource;
    if (!t)
      return jsonError(404, "tournament_not_found", "Tournament not found.");
    if (t.status !== "registration_open") {
      return jsonError(
        409,
        "registration_closed",
        "Teams can only be formed while registration is open.",
      );
    }

    try {
      const result = await withIdempotency(
        ctx.userId,
        idemKey,
        { partnerUserId, tournamentId },
        async () => formTeam(ctx.groupId, t, ctx.userId, partnerUserId),
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
          "Header Idempotency-Key is required.",
        );
      }
      const message = err instanceof Error ? err.message : "internal_error";
      return jsonError(500, "internal_error", message);
    }
  },
});

async function formTeam(
  groupId: string,
  tournament: TournamentDoc,
  userId: string,
  partnerUserId: string,
): Promise<{
  status: number;
  response: { team: TeamDoc } | { error: { code: string; message: string } };
}> {
  // 1) Both must be registered as playing.
  const [myReg, partnerReg] = await Promise.all([
    containers_
      .registrations()
      .item(`${tournament.id}_${userId}`, groupId)
      .read<RegistrationDoc>()
      .catch(() => null),
    containers_
      .registrations()
      .item(`${tournament.id}_${partnerUserId}`, groupId)
      .read<RegistrationDoc>()
      .catch(() => null),
  ]);
  if (!myReg?.resource?.playing) {
    return errResp(409, "not_registered", "You must be registered to play.");
  }
  if (!partnerReg?.resource?.playing) {
    return errResp(
      409,
      "partner_not_registered",
      "Partner must be registered to play.",
    );
  }

  // 2) Reserve both team_slots. Slot id is `${tournamentId}_${userId}`,
  //    partition /userId. Use create() so a duplicate fails with 409.
  const now = new Date().toISOString();
  const teamId = randomUUID();

  const mySlot: TeamSlotDoc = {
    id: `${tournament.id}_${userId}`,
    userId,
    tournamentId: tournament.id,
    teamId,
    groupId,
    createdAt: now,
  };
  const partnerSlot: TeamSlotDoc = {
    id: `${tournament.id}_${partnerUserId}`,
    userId: partnerUserId,
    tournamentId: tournament.id,
    teamId,
    groupId,
    createdAt: now,
  };

  try {
    await containers_.teamSlots().items.create(mySlot);
  } catch (err) {
    if (isConflict(err)) {
      const conflict = await lookupExistingTeam(groupId, tournament.id, userId);
      return errResp(
        409,
        "already_in_team",
        "You are already in a team.",
        conflict,
      );
    }
    throw err;
  }

  try {
    await containers_.teamSlots().items.create(partnerSlot);
  } catch (err) {
    // Rollback our slot.
    await containers_
      .teamSlots()
      .item(mySlot.id, mySlot.userId)
      .delete()
      .catch(() => undefined);
    if (isConflict(err)) {
      const conflict = await lookupExistingTeam(
        groupId,
        tournament.id,
        partnerUserId,
      );
      return errResp(
        409,
        "partner_already_in_team",
        "Partner is already in a team.",
        conflict,
      );
    }
    throw err;
  }

  // 3) Create the team doc.
  const team: TeamDoc = {
    id: teamId,
    groupId,
    tournamentId: tournament.id,
    players: [
      playerSummary(userId, myReg.resource),
      playerSummary(partnerUserId, partnerReg.resource),
    ],
    status: "active",
    confirmedByAdmin: false,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await containers_.teams().items.create(team);
  } catch (err) {
    // Rollback both slots.
    await Promise.all([
      containers_
        .teamSlots()
        .item(mySlot.id, mySlot.userId)
        .delete()
        .catch(() => undefined),
      containers_
        .teamSlots()
        .item(partnerSlot.id, partnerSlot.userId)
        .delete()
        .catch(() => undefined),
    ]);
    throw err;
  }

  return { status: 201, response: { team } };
}

function isConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 409
  );
}

function playerSummary(
  userId: string,
  reg: RegistrationDoc,
): { userId: string; firstName: string; lastName?: string } {
  const out: { userId: string; firstName: string; lastName?: string } = {
    userId,
    firstName: reg.firstName,
  };
  if (reg.lastName) out.lastName = reg.lastName;
  return out;
}

function errResp(
  status: number,
  code: string,
  message: string,
  conflict?: ConflictInfo,
): {
  status: number;
  response: {
    error: { code: string; message: string; conflict?: ConflictInfo };
  };
} {
  const error: { code: string; message: string; conflict?: ConflictInfo } = {
    code,
    message,
  };
  if (conflict) error.conflict = conflict;
  return { status, response: { error } };
}

interface ConflictInfo {
  teamId: string;
  players: Array<{ userId: string; firstName: string; lastName?: string }>;
}

async function lookupExistingTeam(
  groupId: string,
  tournamentId: string,
  userId: string,
): Promise<ConflictInfo | undefined> {
  const slotRead = await containers_
    .teamSlots()
    .item(`${tournamentId}_${userId}`, userId)
    .read<{ teamId: string }>()
    .catch(() => null);
  const teamId = slotRead?.resource?.teamId;
  if (!teamId) return undefined;
  const teamRead = await containers_
    .teams()
    .item(teamId, groupId)
    .read<TeamDoc>()
    .catch(() => null);
  const team = teamRead?.resource;
  if (!team) return undefined;
  return { teamId: team.id, players: team.players };
}

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
