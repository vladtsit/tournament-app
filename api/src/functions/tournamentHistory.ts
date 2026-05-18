import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";

// GET /api/tournaments/history?limit=20
// Lists past (ended) tournaments for the caller's group, newest first.

interface TournamentDoc {
  id: string;
  groupId: string;
  name: string;
  status: "draft" | "registration_open" | "live" | "ended";
  endedAt?: string;
  createdAt?: string;
  finalStandings?: Array<{
    rank: number;
    teamId: string;
    members: string[];
    matches: number;
    wins: number;
    losses: number;
    setsFor: number;
    setsAgainst: number;
  }>;
}

interface UserDoc {
  id: string;
  firstName?: string;
  lastName?: string;
}

app.http("tournamentHistory", {
  route: "tournaments/history",
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

    const limitParam = Number(req.query.get("limit") ?? 20);
    const limit = Math.min(
      Math.max(Number.isFinite(limitParam) ? limitParam : 20, 1),
      50,
    );

    const q = await containers_
      .tournaments()
      .items.query<TournamentDoc>(
        {
          query:
            "SELECT TOP @lim * FROM c WHERE c.groupId = @g AND c.status = 'ended' ORDER BY c.endedAt DESC",
          parameters: [
            { name: "@g", value: ctx.groupId },
            { name: "@lim", value: limit },
          ],
        },
        { partitionKey: ctx.groupId },
      )
      .fetchAll();

    const tournaments = q.resources;

    // Resolve top-3 player names for each tournament.
    const userIds = new Set<string>();
    for (const t of tournaments) {
      for (const s of (t.finalStandings ?? []).slice(0, 3)) {
        for (const u of s.members) userIds.add(u);
      }
    }
    const userMap = new Map<string, UserDoc>();
    if (userIds.size > 0) {
      const reads = await Promise.all(
        Array.from(userIds).map((uid) =>
          containers_
            .users()
            .item(uid, uid)
            .read<UserDoc>()
            .catch(() => null),
        ),
      );
      for (const r of reads) {
        if (r?.resource) userMap.set(r.resource.id, r.resource);
      }
    }
    const playerName = (uid: string): string => {
      const u = userMap.get(uid);
      if (!u) return uid.slice(0, 6);
      return u.lastName ? `${u.firstName} ${u.lastName}` : (u.firstName ?? uid);
    };

    return {
      status: 200,
      jsonBody: {
        tournaments: tournaments.map((t) => ({
          id: t.id,
          name: t.name,
          endedAt: t.endedAt,
          podium: (t.finalStandings ?? []).slice(0, 3).map((s) => ({
            rank: s.rank,
            teamId: s.teamId,
            players: s.members.map((uid) => ({
              userId: uid,
              displayName: playerName(uid),
            })),
            wins: s.wins,
            losses: s.losses,
          })),
        })),
      },
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
