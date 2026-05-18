import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { requireAuth, AuthError } from "../shared/requireAuth.js";
import { containers_ } from "../shared/cosmos.js";

interface GroupUserDoc {
  groupId: string;
  userId: string;
  status: string;
  isAdmin: boolean;
}

interface GroupDoc {
  id: string;
  groupId: string;
  groupShortId: string;
  title: string;
  status: "active" | "inactive";
}

interface MineEntry {
  groupId: string;
  groupShortId: string;
  title: string;
  isAdmin: boolean;
}

app.http("groupsMine", {
  route: "groups/mine",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let auth;
    try {
      auth = await requireAuth(req);
    } catch (err) {
      const code = err instanceof AuthError ? err.code : "unauthorized";
      return { status: 401, jsonBody: { error: { code, message: code } } };
    }

    // Query all group_users rows for this user across partitions (cross-partition).
    const gu = containers_.groupUsers();
    const memberships = await gu.items
      .query<GroupUserDoc>({
        query:
          "SELECT c.groupId, c.userId, c.status, c.isAdmin FROM c WHERE c.userId = @uid AND c.status NOT IN ('left','kicked')",
        parameters: [{ name: "@uid", value: auth.userId }],
      })
      .fetchAll();

    if (memberships.resources.length === 0) {
      return { status: 200, jsonBody: { groups: [] } };
    }

    // Fetch group docs in parallel (point reads).
    const groupsC = containers_.groups();
    const entries: MineEntry[] = [];
    await Promise.all(
      memberships.resources.map(async (m) => {
        const r = await groupsC
          .item(m.groupId, m.groupId)
          .read<GroupDoc>()
          .catch(() => null);
        const g = r?.resource;
        if (!g || g.status !== "active") return;
        entries.push({
          groupId: g.groupId,
          groupShortId: g.groupShortId,
          title: g.title,
          isAdmin: m.isAdmin,
        });
      }),
    );

    entries.sort((a, b) => a.title.localeCompare(b.title));
    return { status: 200, jsonBody: { groups: entries } };
  },
});
