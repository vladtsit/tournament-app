import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";

// GET /api/tournaments/{tournamentId}/looking-for-teammate
// Returns registered (playing=true) users in the group who do NOT yet have a
// team slot for this tournament.

interface RegistrationDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  userId: string;
  firstName: string;
  lastName?: string;
  playing: boolean;
  bbq: boolean;
}

interface TeamSlotDoc {
  id: string;
  userId: string;
  tournamentId: string;
}

interface LookingEntry {
  userId: string;
  firstName: string;
  lastName?: string;
  isSelf: boolean;
}

app.http("teamsLookingForTeammate", {
  route: "tournaments/{tournamentId}/looking-for-teammate",
  methods: ["GET"],
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

    // All "playing" registrations in this tournament/group.
    const regs = await containers_
      .registrations()
      .items.query<RegistrationDoc>(
        {
          query:
            "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t AND c.playing = true",
          parameters: [
            { name: "@g", value: ctx.groupId },
            { name: "@t", value: tournamentId },
          ],
        },
        { partitionKey: ctx.groupId },
      )
      .fetchAll();

    if (regs.resources.length === 0) {
      return { status: 200, jsonBody: { players: [] } };
    }

    // Check team slot for each (point reads in parallel — partition /userId).
    const lookups = await Promise.all(
      regs.resources.map(async (r) => {
        const slotId = `${tournamentId}_${r.userId}`;
        const slot = await containers_
          .teamSlots()
          .item(slotId, r.userId)
          .read<TeamSlotDoc>()
          .catch(() => null);
        return { reg: r, hasSlot: !!slot?.resource };
      }),
    );

    const players: LookingEntry[] = lookups
      .filter((l) => !l.hasSlot)
      .map((l) => {
        const e: LookingEntry = {
          userId: l.reg.userId,
          firstName: l.reg.firstName,
          isSelf: l.reg.userId === ctx.userId,
        };
        if (l.reg.lastName) e.lastName = l.reg.lastName;
        return e;
      });
    players.sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return a.firstName.localeCompare(b.firstName);
    });

    return { status: 200, jsonBody: { players } };
  },
});

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return { status, jsonBody: { error: { code, message } } };
}
