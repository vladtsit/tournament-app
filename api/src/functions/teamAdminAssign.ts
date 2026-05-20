import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { randomUUID } from "node:crypto";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import { disbandTeamForUser, type TeamDoc } from "../shared/teams.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// POST /api/admin/tournaments/{tournamentId}/teams
// Body: { userIdA, userIdB }
// Admin-only. Allowed in registration_open or review. Atomically tears
// down any existing team for either player, then creates a new team with
// confirmedByAdmin = true.

interface Body {
  userIdA?: unknown;
  userIdB?: unknown;
}

interface TournamentDoc {
  id: string;
  groupId: string;
  status: TournamentStatus;
}

interface RegistrationDoc {
  id: string;
  userId: string;
  firstName: string;
  lastName?: string;
  playing: boolean;
  resigned?: boolean;
}

interface TeamSlotDoc {
  id: string;
  userId: string;
  tournamentId: string;
  teamId: string;
  groupId: string;
  createdAt: string;
}

app.http("teamAdminAssign", {
  route: "tournaments/{tournamentId}/admin/teams",
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

    let body: Body;
    try {
      body = ((await req.json()) ?? {}) as Body;
    } catch {
      return jsonError(400, "invalid_body", "JSON body required.");
    }
    const userIdA = typeof body.userIdA === "string" ? body.userIdA.trim() : "";
    const userIdB = typeof body.userIdB === "string" ? body.userIdB.trim() : "";
    if (!userIdA || !userIdB) {
      return jsonError(400, "missing_users", "userIdA and userIdB required.");
    }
    if (userIdA === userIdB) {
      return jsonError(400, "partner_is_self", "Pick two different players.");
    }

    const tRead = await containers_
      .tournaments()
      .item(tournamentId, ctx.groupId)
      .read<TournamentDoc>()
      .catch(() => null);
    const t = tRead?.resource;
    if (!t) return jsonError(404, "tournament_not_found", "Not found.");
    if (t.status !== "registration_open" && t.status !== "review") {
      return jsonError(
        409,
        "invalid_state",
        `Cannot assign teams in status ${t.status}.`,
      );
    }

    // Both must be registered and playing (admin can register them via the
    // adminRegistrationAdd endpoint first).
    const [regA, regB] = await Promise.all([
      containers_
        .registrations()
        .item(`${tournamentId}_${userIdA}`, ctx.groupId)
        .read<RegistrationDoc>()
        .catch(() => null),
      containers_
        .registrations()
        .item(`${tournamentId}_${userIdB}`, ctx.groupId)
        .read<RegistrationDoc>()
        .catch(() => null),
    ]);
    if (!regA?.resource?.playing) {
      return jsonError(409, "not_registered", "userIdA is not playing.");
    }
    if (!regB?.resource?.playing) {
      return jsonError(
        409,
        "partner_not_registered",
        "userIdB is not playing.",
      );
    }

    // Tear down any pre-existing team for either user.
    await Promise.all([
      disbandTeamForUser(ctx.groupId, tournamentId, userIdA),
      disbandTeamForUser(ctx.groupId, tournamentId, userIdB),
    ]);

    const now = new Date().toISOString();
    const teamId = randomUUID();
    const slotA: TeamSlotDoc = {
      id: `${tournamentId}_${userIdA}`,
      userId: userIdA,
      tournamentId,
      teamId,
      groupId: ctx.groupId,
      createdAt: now,
    };
    const slotB: TeamSlotDoc = {
      id: `${tournamentId}_${userIdB}`,
      userId: userIdB,
      tournamentId,
      teamId,
      groupId: ctx.groupId,
      createdAt: now,
    };
    await containers_.teamSlots().items.create(slotA);
    try {
      await containers_.teamSlots().items.create(slotB);
    } catch (err) {
      await containers_
        .teamSlots()
        .item(slotA.id, slotA.userId)
        .delete()
        .catch(() => undefined);
      throw err;
    }

    const team: TeamDoc = {
      id: teamId,
      groupId: ctx.groupId,
      tournamentId,
      players: [
        playerSummary(userIdA, regA.resource),
        playerSummary(userIdB, regB.resource),
      ],
      status: "active",
      confirmedByAdmin: true,
      confirmedByAdminAt: now,
      confirmedByAdminUserId: ctx.userId,
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await containers_.teams().items.create(team);
    } catch (err) {
      await Promise.all([
        containers_
          .teamSlots()
          .item(slotA.id, slotA.userId)
          .delete()
          .catch(() => undefined),
        containers_
          .teamSlots()
          .item(slotB.id, slotB.userId)
          .delete()
          .catch(() => undefined),
      ]);
      throw err;
    }
    await refreshPinnedMessage(ctx.groupId);
    return { status: 201, jsonBody: { team } };
  },
});

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

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
