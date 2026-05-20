import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";

// GET /api/tournaments/current
// Returns the most recent non-ended tournament for the JWT's group, plus
// the caller's registration (if any) and team (if any).

interface TournamentDoc {
  id: string;
  groupId: string;
  name: string;
  status: "draft" | "registration_open" | "review" | "live" | "ended";
  settings: {
    tiebreakRule?: string;
    firstRoundCourts?: Array<{ courtId: string; teamIds: string[] }>;
  };
  createdAt: string;
}

interface RegistrationDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  userId: string;
  firstName: string;
  playing: boolean;
  bbq: boolean;
  resigned?: boolean;
  resignedAt?: string;
  updatedAt: string;
}

interface TeamSlotDoc {
  id: string;
  userId: string;
  tournamentId: string;
  teamId: string;
  groupId: string;
}

interface TeamDoc {
  id: string;
  groupId: string;
  tournamentId: string;
  players: Array<{ userId: string; firstName: string; lastName?: string }>;
  status: "active" | "disbanded";
  confirmedByAdmin?: boolean;
}

app.http("tournamentCurrent", {
  route: "tournaments/current",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroup(req);
    } catch (err) {
      return mapGroupContextError(err);
    }

    const q = await containers_
      .tournaments()
      .items.query<TournamentDoc>(
        {
          query:
            "SELECT TOP 1 * FROM c WHERE c.groupId = @g AND c.status IN ('draft','registration_open','review','live') ORDER BY c.createdAt DESC",
          parameters: [{ name: "@g", value: ctx.groupId }],
        },
        { partitionKey: ctx.groupId },
      )
      .fetchAll();
    const t = q.resources[0];
    if (!t) {
      return { status: 200, jsonBody: { tournament: null } };
    }

    // Caller's registration + team (best effort).
    const regId = `${t.id}_${ctx.userId}`;
    const slotId = `${t.id}_${ctx.userId}`;
    const [regRead, slotRead, counts] = await Promise.all([
      containers_
        .registrations()
        .item(regId, ctx.groupId)
        .read<RegistrationDoc>()
        .catch(() => null),
      containers_
        .teamSlots()
        .item(slotId, ctx.userId)
        .read<TeamSlotDoc>()
        .catch(() => null),
      countRegistrations(t.groupId, t.id),
    ]);

    let team: TeamDoc | null = null;
    if (slotRead?.resource) {
      const r = await containers_
        .teams()
        .item(slotRead.resource.teamId, t.groupId)
        .read<TeamDoc>()
        .catch(() => null);
      team = r?.resource ?? null;
    }

    // Admins get the full registration list, all teams, and court config so
    // the SPA can render the AdminTournamentScreen without extra calls.
    const membership = await containers_
      .groupUsers()
      .item(`${ctx.groupId}_${ctx.userId}`, ctx.groupId)
      .read<{ isAdmin?: boolean }>()
      .catch(() => null);
    const isAdmin = membership?.resource?.isAdmin === true;
    let extras: {
      registrations?: RegistrationDoc[];
      teams?: TeamDoc[];
      group?: { courts?: unknown };
    } = {};
    if (isAdmin) {
      const [regsQ, teamsQ, groupRead] = await Promise.all([
        containers_
          .registrations()
          .items.query<RegistrationDoc>(
            {
              query:
                "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
              parameters: [
                { name: "@g", value: t.groupId },
                { name: "@t", value: t.id },
              ],
            },
            { partitionKey: t.groupId },
          )
          .fetchAll(),
        containers_
          .teams()
          .items.query<TeamDoc>(
            {
              query:
                "SELECT * FROM c WHERE c.groupId = @g AND c.tournamentId = @t AND (NOT IS_DEFINED(c.status) OR c.status = 'active')",
              parameters: [
                { name: "@g", value: t.groupId },
                { name: "@t", value: t.id },
              ],
            },
            { partitionKey: t.groupId },
          )
          .fetchAll(),
        containers_
          .groups()
          .item(t.groupId, t.groupId)
          .read<{ settings?: { courts?: unknown } }>()
          .catch(() => null),
      ]);
      extras = {
        registrations: regsQ.resources,
        teams: teamsQ.resources,
        group: { courts: groupRead?.resource?.settings?.courts },
      };
    }

    return {
      status: 200,
      jsonBody: {
        tournament: t,
        registration: regRead?.resource ?? null,
        team,
        counts,
        ...extras,
      },
    };
  },
});

async function countRegistrations(
  groupId: string,
  tournamentId: string,
): Promise<{ playing: number; bbq: number }> {
  const r = await containers_
    .registrations()
    .items.query<{ playing: number; bbq: number }>(
      {
        query:
          "SELECT VALUE { playing: SUM(c.playing ? 1 : 0), bbq: SUM(c.bbq ? 1 : 0) } FROM c WHERE c.groupId = @g AND c.tournamentId = @t",
        parameters: [
          { name: "@g", value: groupId },
          { name: "@t", value: tournamentId },
        ],
      },
      { partitionKey: groupId },
    )
    .fetchAll();
  return r.resources[0] ?? { playing: 0, bbq: 0 };
}
