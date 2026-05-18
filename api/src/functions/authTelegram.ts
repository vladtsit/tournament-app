import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { validateInitData, InitDataError } from "../shared/telegramAuth.js";
import { issueSession } from "../shared/session.js";
import { resolveLanguage } from "../shared/i18n.js";
import { containers_ } from "../shared/cosmos.js";
import {
  readCachedMembership,
  resolveMembership,
} from "../shared/membership.js";

interface AuthRequestBody {
  initData?: string;
  /** Optional explicit group selection (used by re-auth from picker). */
  groupId?: string;
}

interface UserDoc {
  id: string;
  userId: string;
  telegramId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  isPremium?: boolean;
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface GroupDoc {
  id: string;
  groupId: string;
  groupShortId: string;
  telegramChatId: number;
  title: string;
  status: "active" | "inactive";
}

interface GroupSummary {
  groupId: string;
  groupShortId: string;
  title: string;
  isAdmin: boolean;
}

app.http("authTelegram", {
  route: "auth/telegram",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let body: AuthRequestBody;
    try {
      body = (await req.json()) as AuthRequestBody;
    } catch {
      return jsonError(400, "invalid_body", "Request body must be JSON.");
    }
    if (!body.initData) {
      return jsonError(400, "missing_init_data", "initData is required.");
    }

    let validated;
    try {
      validated = validateInitData(body.initData);
    } catch (err) {
      if (err instanceof InitDataError) {
        const status =
          err.code === "expired"
            ? 401
            : err.code === "bad_signature"
              ? 401
              : 400;
        return jsonError(status, err.code, "initData validation failed.");
      }
      return jsonError(400, "invalid_init_data", "Could not parse initData.");
    }

    const tgUser = validated.user;
    const language = resolveLanguage(tgUser.language_code);
    const userId = String(tgUser.id);

    // Upsert the user document (idempotent).
    const now = new Date().toISOString();
    const doc: UserDoc = {
      id: userId,
      userId,
      telegramId: tgUser.id,
      firstName: tgUser.first_name,
      createdAt: now,
      updatedAt: now,
    };
    if (tgUser.last_name) doc.lastName = tgUser.last_name;
    if (tgUser.username) doc.username = tgUser.username;
    if (tgUser.language_code) doc.languageCode = tgUser.language_code;
    if (tgUser.is_premium) doc.isPremium = tgUser.is_premium;
    if (tgUser.photo_url) doc.photoUrl = tgUser.photo_url;

    try {
      const c = containers_.users();
      const existing = await c
        .item(userId, userId)
        .read<UserDoc>()
        .catch(() => null);
      const existingResource = existing?.resource;
      if (existingResource) {
        doc.createdAt = existingResource.createdAt;
      }
      await c.items.upsert(doc);
    } catch (err) {
      const message = err instanceof Error ? err.message : "cosmos_error";
      return jsonError(503, "cosmos_unavailable", message);
    }

    // ---- Group resolution ----
    // Priority: explicit body.groupId → startParam `g_<short>` → none.
    const requestedGroup = await resolveRequestedGroup(
      body.groupId,
      validated.startParam,
    );

    let resolvedGroupId: string | undefined;
    let resolvedGroup: GroupDoc | undefined;
    if (requestedGroup) {
      // Verify membership (cache; fall back to live getChatMember).
      const cached = await readCachedMembership(requestedGroup.groupId, userId);
      let isMember = cached
        ? cached.status !== "left" && cached.status !== "kicked"
        : false;
      if (!cached) {
        const live = await resolveMembership(
          requestedGroup.groupId,
          requestedGroup.telegramChatId,
          userId,
          tgUser.id,
        );
        isMember = live.isMember;
      }
      if (isMember) {
        resolvedGroupId = requestedGroup.groupId;
        resolvedGroup = requestedGroup;
      }
    }

    // List the user's groups for the picker scenario.
    const groups = await listUserGroups(userId);

    // If only one group and none requested, auto-select it.
    if (!resolvedGroupId && groups.length === 1) {
      resolvedGroupId = groups[0]!.groupId;
    }

    const sessionPayload: {
      userId: string;
      language: string;
      groupId?: string;
    } = { userId, language };
    if (resolvedGroupId) sessionPayload.groupId = resolvedGroupId;
    const token = await issueSession(sessionPayload);

    return {
      status: 200,
      jsonBody: {
        token,
        expiresIn: Number(process.env["JWT_TTL_SECONDS"] ?? 14400),
        user: {
          id: userId,
          firstName: tgUser.first_name,
          lastName: tgUser.last_name ?? null,
          username: tgUser.username ?? null,
          language,
          photoUrl: tgUser.photo_url ?? null,
        },
        startParam: validated.startParam ?? null,
        groupId: resolvedGroupId ?? null,
        group: resolvedGroup
          ? {
              groupId: resolvedGroup.groupId,
              groupShortId: resolvedGroup.groupShortId,
              title: resolvedGroup.title,
            }
          : null,
        groups,
      },
    };
  },
});

async function resolveRequestedGroup(
  explicitGroupId: string | undefined,
  startParam: string | undefined,
): Promise<GroupDoc | undefined> {
  if (explicitGroupId) {
    const r = await containers_
      .groups()
      .item(explicitGroupId, explicitGroupId)
      .read<GroupDoc>()
      .catch(() => null);
    const g = r?.resource;
    return g && g.status === "active" ? g : undefined;
  }
  if (startParam && startParam.startsWith("g_")) {
    const short = startParam.slice(2);
    const q = await containers_
      .groups()
      .items.query<GroupDoc>({
        query:
          "SELECT TOP 1 * FROM c WHERE c.groupShortId = @s AND c.status = 'active'",
        parameters: [{ name: "@s", value: short }],
      })
      .fetchAll();
    return q.resources[0];
  }
  return undefined;
}

async function listUserGroups(userId: string): Promise<GroupSummary[]> {
  const gu = containers_.groupUsers();
  const memberships = await gu.items
    .query<{ groupId: string; isAdmin: boolean }>({
      query:
        "SELECT c.groupId, c.isAdmin FROM c WHERE c.userId = @uid AND c.status NOT IN ('left','kicked')",
      parameters: [{ name: "@uid", value: userId }],
    })
    .fetchAll();
  if (memberships.resources.length === 0) return [];
  const groupsC = containers_.groups();
  const results: GroupSummary[] = [];
  await Promise.all(
    memberships.resources.map(async (m) => {
      const r = await groupsC
        .item(m.groupId, m.groupId)
        .read<GroupDoc>()
        .catch(() => null);
      const g = r?.resource;
      if (!g || g.status !== "active") return;
      results.push({
        groupId: g.groupId,
        groupShortId: g.groupShortId,
        title: g.title,
        isAdmin: m.isAdmin,
      });
    }),
  );
  results.sort((a, b) => a.title.localeCompare(b.title));
  return results;
}

function jsonError(
  status: number,
  code: string,
  message: string,
): HttpResponseInit {
  return {
    status,
    jsonBody: { error: { code, message } },
  };
}
