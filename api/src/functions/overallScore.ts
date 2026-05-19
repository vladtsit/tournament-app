import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { containers_ } from "../shared/cosmos.js";
import { requireGroup, mapGroupContextError } from "../shared/requireGroup.js";
import { sortOverall, type PlayerStatsDoc } from "../shared/playerStats.js";

// GET /api/groups/overall-score?limit=50
// Cross-tournament leaderboard for the caller's group. Spec §18.6.

interface UserDoc {
  id: string;
  firstName?: string;
  lastName?: string;
}

app.http("overallScore", {
  route: "groups/overall-score",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let ctx;
    try {
      ctx = await requireGroup(req);
    } catch (err) {
      return mapGroupContextError(err);
    }

    const limitParam = Number(req.query.get("limit") ?? 50);
    const limit = Math.min(
      Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1),
      200,
    );

    const q = await containers_
      .playerStats()
      .items.query<PlayerStatsDoc>(
        {
          query: "SELECT * FROM c WHERE c.groupId = @g",
          parameters: [{ name: "@g", value: ctx.groupId }],
        },
        { partitionKey: ctx.groupId },
      )
      .fetchAll();

    const sorted = sortOverall(q.resources).slice(0, limit);

    // Decorate with names from users container.
    const userMap = new Map<string, UserDoc>();
    if (sorted.length > 0) {
      const reads = await Promise.all(
        sorted.map((r) =>
          containers_
            .users()
            .item(r.userId, r.userId)
            .read<UserDoc>()
            .catch(() => null),
        ),
      );
      for (const r of reads) {
        if (r?.resource) userMap.set(r.resource.id, r.resource);
      }
    }

    const meId = ctx.userId;
    return {
      status: 200,
      jsonBody: {
        rows: sorted.map((r, i) => {
          const u = userMap.get(r.userId);
          const displayName = u
            ? u.lastName
              ? `${u.firstName} ${u.lastName}`
              : (u.firstName ?? r.userId)
            : r.userId.slice(0, 6);
          return {
            rank: i + 1,
            userId: r.userId,
            displayName,
            isMe: r.userId === meId,
            overallScore: r.overallScore,
            tournamentsPlayed: r.tournamentsPlayed,
            matchesPlayed: r.matchesPlayed,
            wins: r.wins,
            losses: r.losses,
            winRate: r.winRate,
            podiums: r.podiums,
          };
        }),
      },
    };
  },
});
