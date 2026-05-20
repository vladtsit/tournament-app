import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import type { TournamentStatus } from "../shared/tournamentState.js";

// POST /api/admin/tournaments/{tournamentId}/registrations
// Body: { userId }
// Admin-only. Adds a registration for a group member directly (no consent
// flow). User can still resign themselves afterwards.

interface Body {
  userId?: unknown;
}

interface TournamentDoc {
  id: string;
  groupId: string;
  status: TournamentStatus;
}

interface UserDoc {
  id: string;
  firstName: string;
  lastName?: string;
}

interface GroupUserDoc {
  status:
    | "creator"
    | "administrator"
    | "member"
    | "restricted"
    | "left"
    | "kicked";
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
  addedByAdminUserId?: string;
  addedByAdminAt?: string;
  createdAt: string;
  updatedAt: string;
}

app.http("adminRegistrationAdd", {
  route: "admin/tournaments/{tournamentId}/registrations",
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
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!userId) return jsonError(400, "missing_user_id", "userId required");

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
        `Cannot add registrations in status ${t.status}.`,
      );
    }

    // Membership check: user must be in group_users with active status.
    const memberRead = await containers_
      .groupUsers()
      .item(`${ctx.groupId}_${userId}`, ctx.groupId)
      .read<GroupUserDoc>()
      .catch(() => null);
    const member = memberRead?.resource;
    if (!member || member.status === "left" || member.status === "kicked") {
      return jsonError(
        409,
        "not_in_group",
        "User is not a member of this group.",
      );
    }

    const userRead = await containers_
      .users()
      .item(userId, userId)
      .read<UserDoc>()
      .catch(() => null);
    const firstName = userRead?.resource?.firstName ?? "Player";
    const lastName = userRead?.resource?.lastName;

    const regId = `${tournamentId}_${userId}`;
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
      userId,
      firstName,
      playing: true,
      bbq: existing?.bbq ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      addedByAdminUserId: ctx.userId,
      addedByAdminAt: now,
    };
    if (lastName) doc.lastName = lastName;
    // Clear any prior resigned flag — admin add overrides it.
    await containers_.registrations().items.upsert(doc);
    await refreshPinnedMessage(ctx.groupId);
    return { status: 200, jsonBody: { registration: doc } };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
