import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import {
  requireGroupAdmin,
  mapGroupContextError,
} from "../shared/requireGroup.js";

// GET /api/groups/{groupId}/members?q=...&tournamentId=...
// Admin-only. Lists active group members so admin can pick who to add to a
// tournament. Optional `tournamentId` annotates rows with `alreadyRegistered`.

interface GroupUserDoc {
  id: string;
  groupId: string;
  userId: string;
  status:
    | "creator"
    | "administrator"
    | "member"
    | "restricted"
    | "left"
    | "kicked";
  isAdmin: boolean;
}

interface UserDoc {
  id: string;
  firstName: string;
  lastName?: string;
}

interface RegistrationDoc {
  userId: string;
  playing: boolean;
  resigned?: boolean;
}

app.http("groupMembersList", {
  route: "groups/{groupId}/members",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroupAdmin(req);
    } catch (err) {
      return mapGroupContextError(err);
    }
    const groupIdParam = req.params["groupId"];
    if (groupIdParam && groupIdParam !== ctx.groupId) {
      return jsonError(
        403,
        "group_mismatch",
        "Group does not match the active session.",
      );
    }
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const tournamentId = url.searchParams.get("tournamentId") ?? null;

    const membersQ = await containers_
      .groupUsers()
      .items.query<GroupUserDoc>(
        {
          query:
            "SELECT TOP 200 c.id, c.groupId, c.userId, c.status, c.isAdmin FROM c WHERE c.groupId = @g AND c.status IN ('creator','administrator','member','restricted')",
          parameters: [{ name: "@g", value: ctx.groupId }],
        },
        { partitionKey: ctx.groupId },
      )
      .fetchAll();
    const members = membersQ.resources;

    // Hydrate names (parallel reads on /userId partition — small N, OK).
    const userReads = await Promise.all(
      members.map((m) =>
        containers_
          .users()
          .item(m.userId, m.userId)
          .read<UserDoc>()
          .catch(() => null),
      ),
    );

    // Optional registration annotation.
    let regs = new Map<string, RegistrationDoc>();
    if (tournamentId) {
      const regsQ = await containers_
        .registrations()
        .items.query<RegistrationDoc>(
          {
            query:
              "SELECT c.userId, c.playing, c.resigned FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
            parameters: [
              { name: "@g", value: ctx.groupId },
              { name: "@t", value: tournamentId },
            ],
          },
          { partitionKey: ctx.groupId },
        )
        .fetchAll();
      regs = new Map(regsQ.resources.map((r) => [r.userId, r]));
    }

    const hydrated = members.map((m, i) => {
      const u = userReads[i]?.resource;
      const firstName = u?.firstName ?? "Player";
      const lastName = u?.lastName;
      const reg = regs.get(m.userId);
      const out: {
        userId: string;
        firstName: string;
        lastName?: string;
        isAdmin: boolean;
        status: GroupUserDoc["status"];
        alreadyRegistered: boolean;
        isPlaying: boolean;
        resigned: boolean;
      } = {
        userId: m.userId,
        firstName,
        isAdmin: m.isAdmin,
        status: m.status,
        alreadyRegistered: !!reg,
        isPlaying: reg?.playing === true,
        resigned: reg?.resigned === true,
      };
      if (lastName) out.lastName = lastName;
      return out;
    });

    const filtered = q
      ? hydrated.filter((h) => {
          const full = `${h.firstName} ${h.lastName ?? ""}`.toLowerCase();
          return full.includes(q);
        })
      : hydrated;

    filtered.sort((a, b) =>
      `${a.firstName} ${a.lastName ?? ""}`.localeCompare(
        `${b.firstName} ${b.lastName ?? ""}`,
      ),
    );
    return {
      status: 200,
      jsonBody: { members: filtered.slice(0, 50) },
    };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
