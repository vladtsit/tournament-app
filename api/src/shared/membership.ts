import { containers_ } from "./cosmos.js";
import {
  getChatMember,
  isAdminStatus,
  type ChatMember,
} from "./telegramApi.js";

// Multi-source membership resolver. Per spec §10.5.
// Source priority: group_users cache → live getChatMember fallback → record outcome.

export interface MembershipResult {
  isMember: boolean;
  isAdmin: boolean;
  status: ChatMember["status"] | "unknown";
  source: "cache" | "live";
}

export interface GroupUserDoc {
  id: string; // `${groupId}_${userId}`
  groupId: string;
  userId: string;
  status: ChatMember["status"];
  isAdmin: boolean;
  updatedAt: string;
}

function groupUserId(groupId: string, userId: string): string {
  return `${groupId}_${userId}`;
}

export async function readCachedMembership(
  groupId: string,
  userId: string,
): Promise<GroupUserDoc | null> {
  try {
    const r = await containers_
      .groupUsers()
      .item(groupUserId(groupId, userId), groupId)
      .read<GroupUserDoc>();
    return r.resource ?? null;
  } catch {
    return null;
  }
}

export async function upsertMembership(doc: GroupUserDoc): Promise<void> {
  await containers_.groupUsers().items.upsert(doc);
}

/**
 * Resolve whether a Telegram user is a member of a Telegram chat (group).
 * Tries the local cache first, then falls back to Bot API `getChatMember`.
 * Writes the live result back to the cache.
 */
export async function resolveMembership(
  groupId: string,
  telegramChatId: number,
  userId: string,
  telegramUserId: number,
): Promise<MembershipResult> {
  const cached = await readCachedMembership(groupId, userId);
  if (cached) {
    return {
      isMember: cached.status !== "left" && cached.status !== "kicked",
      isAdmin: cached.isAdmin,
      status: cached.status,
      source: "cache",
    };
  }
  // Live fallback
  try {
    const live = await getChatMember({
      chat_id: telegramChatId,
      user_id: telegramUserId,
    });
    const doc: GroupUserDoc = {
      id: groupUserId(groupId, userId),
      groupId,
      userId,
      status: live.status,
      isAdmin: isAdminStatus(live.status),
      updatedAt: new Date().toISOString(),
    };
    await upsertMembership(doc);
    return {
      isMember: live.status !== "left" && live.status !== "kicked",
      isAdmin: doc.isAdmin,
      status: live.status,
      source: "live",
    };
  } catch {
    return {
      isMember: false,
      isAdmin: false,
      status: "unknown",
      source: "live",
    };
  }
}
