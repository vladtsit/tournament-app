import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { timingSafeEqual } from "node:crypto";
import { env } from "../shared/env.js";
import { containers_ } from "../shared/cosmos.js";
import { generateUniqueGroupShortId } from "../shared/ids.js";
import {
  isAdminStatus,
  getChatMember,
  sendMessage,
  TelegramApiError,
  type ChatMember,
} from "../shared/telegramApi.js";
import { upsertMembership, type GroupUserDoc } from "../shared/membership.js";
import { refreshPinnedMessage } from "../shared/refreshPin.js";
import { resolveLanguage, t, type SupportedLanguage } from "../shared/i18n.js";

// POST /api/telegram/webhook
// https://core.telegram.org/bots/api#update
//
// Security: verify X-Telegram-Bot-Api-Secret-Token header (constant-time)
// BEFORE parsing the body. Per spec §10.4.

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
}

interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  entities?: TgMessageEntity[];
}

interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: ChatMember;
  new_chat_member: ChatMember;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  my_chat_member?: TgChatMemberUpdated;
  chat_member?: TgChatMemberUpdated;
}

interface GroupDoc {
  id: string; // groupId === String(chat.id)
  groupId: string;
  groupShortId: string;
  telegramChatId: number;
  title: string;
  status: "active" | "inactive";
  settings: {
    language: SupportedLanguage;
    tiebreakRule: "regular_set" | "super_tiebreak_to_10";
    courts?: Array<{ id: string; label: string; color: "green" | "blue" }>;
  };
  botRights: {
    canPinMessages: boolean;
    canPostMessages: boolean;
  };
  pinnedMessageId?: number;
  lastPinUpdateAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_COURTS: Array<{
  id: string;
  label: string;
  color: "green" | "blue";
}> = [
  { id: "1", label: "Court 1", color: "green" },
  { id: "2", label: "Court 2", color: "green" },
  { id: "3", label: "Court 3", color: "blue" },
  { id: "4", label: "Court 4", color: "blue" },
  { id: "5", label: "Court 5", color: "blue" },
];

app.http("telegramWebhook", {
  route: "telegram/webhook",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (
    req: HttpRequest,
    ctx: InvocationContext,
  ): Promise<HttpResponseInit> => {
    // 1) Verify secret header BEFORE parsing body.
    const provided = req.headers.get(SECRET_HEADER) ?? "";
    const expected = env.telegramWebhookSecret;
    if (!constantTimeEqualStrings(provided, expected)) {
      return { status: 401, jsonBody: { ok: false } };
    }

    // 2) Parse body.
    let update: TgUpdate;
    try {
      update = (await req.json()) as TgUpdate;
    } catch {
      return { status: 200, jsonBody: { ok: true } }; // ack invalid bodies
    }

    // Always return 200 to Telegram unless we want a retry. Internal errors
    // are logged but not surfaced — Telegram retries on non-2xx.
    try {
      if (update.message) {
        await handleMessage(update.message, ctx);
      } else if (update.my_chat_member) {
        await handleMyChatMember(update.my_chat_member, ctx);
      } else if (update.chat_member) {
        await handleChatMember(update.chat_member, ctx);
      }
    } catch (err) {
      ctx.error("webhook_handler_error", err);
    }
    return { status: 200, jsonBody: { ok: true } };
  },
});

function constantTimeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function handleMessage(
  msg: TgMessage,
  ctx: InvocationContext,
): Promise<void> {
  const text = msg.text ?? "";
  // Match /setup with optional @botname suffix.
  const m = text.match(/^\/setup(?:@(\S+))?\s*$/);
  if (!m) return; // Only /setup is supported in Phase 1.
  const targetBot = m[1];
  if (
    targetBot &&
    targetBot.toLowerCase() !== env.telegramBotUsername.toLowerCase()
  ) {
    return; // Not addressed to us.
  }
  await handleSetup(msg, ctx);
}

async function handleSetup(
  msg: TgMessage,
  ctx: InvocationContext,
): Promise<void> {
  if (!msg.from) return;
  const chat = msg.chat;
  const sender = msg.from;
  const lang = resolveLanguage(sender.language_code);

  if (chat.type !== "group" && chat.type !== "supergroup") {
    await safeSend(chat.id, t(lang, "setup.notGroup"));
    return;
  }

  // 1) Verify sender is a Telegram chat admin.
  let senderMember: ChatMember;
  try {
    senderMember = await getChatMember({
      chat_id: chat.id,
      user_id: sender.id,
    });
  } catch (err) {
    ctx.error("getChatMember(sender) failed", err);
    await safeSend(chat.id, t(lang, "setup.error"));
    return;
  }
  if (!isAdminStatus(senderMember.status)) {
    await safeSend(chat.id, t(lang, "setup.notAdmin"));
    return;
  }

  // 2) Verify bot has pin rights.
  let botMember: ChatMember;
  try {
    const meId = await getBotUserId();
    botMember = await getChatMember({ chat_id: chat.id, user_id: meId });
  } catch (err) {
    ctx.error("getChatMember(bot) failed", err);
    await safeSend(chat.id, t(lang, "setup.error"));
    return;
  }
  const canPin = !!botMember.can_pin_messages || botMember.status === "creator";
  if (!isAdminStatus(botMember.status) || !canPin) {
    await safeSend(chat.id, t(lang, "setup.botMissingPinRight"));
    return;
  }

  const groupId = String(chat.id);
  const groups = containers_.groups();

  // 3) Idempotency: if group already exists, re-pin existing message.
  const existingRead = await groups
    .item(groupId, groupId)
    .read<GroupDoc>()
    .catch(() => null);
  const existing = existingRead?.resource ?? null;

  const now = new Date().toISOString();
  const title = chat.title ?? "Group";

  let doc: GroupDoc;
  if (existing) {
    doc = {
      ...existing,
      title,
      status: "active",
      settings: {
        ...existing.settings,
        courts: existing.settings.courts ?? DEFAULT_COURTS,
      },
      botRights: {
        canPinMessages: canPin,
        canPostMessages: !!botMember.can_post_messages,
      },
      updatedAt: now,
    };
  } else {
    const shortId = await generateUniqueGroupShortId(async (cand) => {
      const q = await groups.items
        .query<{ id: string }>({
          query: "SELECT TOP 1 c.id FROM c WHERE c.groupShortId = @s",
          parameters: [{ name: "@s", value: cand }],
        })
        .fetchAll();
      return q.resources.length === 0;
    });
    doc = {
      id: groupId,
      groupId,
      groupShortId: shortId,
      telegramChatId: chat.id,
      title,
      status: "active",
      settings: {
        language: lang,
        tiebreakRule: "super_tiebreak_to_10",
        courts: DEFAULT_COURTS,
      },
      botRights: {
        canPinMessages: canPin,
        canPostMessages: !!botMember.can_post_messages,
      },
      createdBy: String(sender.id),
      createdAt: now,
      updatedAt: now,
    };
  }

  // 4) Persist the group doc, then render+send/pin (or edit) the launch
  //    message via the unified refresh helper. pin=true re-pins the existing
  //    message (idempotent) in case an admin unpinned it.
  await groups.items.upsert(doc);
  const outcome = await refreshPinnedMessage(groupId, { pin: true }, ctx);
  if (outcome === "error") {
    await safeSend(chat.id, t(lang, "setup.error"));
    return;
  }

  // 5) Record the admin as a member.
  const memberDoc: GroupUserDoc = {
    id: `${groupId}_${sender.id}`,
    groupId,
    userId: String(sender.id),
    status: senderMember.status,
    isAdmin: true,
    updatedAt: now,
  };
  await upsertMembership(memberDoc);

  // 6) Confirmation reply.
  await safeSend(
    chat.id,
    t(lang, existing ? "setup.alreadySetUp" : "setup.success"),
  );
}

async function handleMyChatMember(
  upd: TgChatMemberUpdated,
  ctx: InvocationContext,
): Promise<void> {
  const groupId = String(upd.chat.id);
  const groups = containers_.groups();
  const existing = await groups
    .item(groupId, groupId)
    .read<GroupDoc>()
    .catch(() => null);
  if (!existing?.resource) return; // Not a tracked group.

  const doc = existing.resource;
  const newStatus = upd.new_chat_member.status;
  const isKicked = newStatus === "left" || newStatus === "kicked";
  const now = new Date().toISOString();
  doc.status = isKicked ? "inactive" : "active";
  doc.botRights = {
    canPinMessages:
      !!upd.new_chat_member.can_pin_messages || newStatus === "creator",
    canPostMessages: !!upd.new_chat_member.can_post_messages,
  };
  doc.updatedAt = now;
  try {
    await groups.items.upsert(doc);
  } catch (err) {
    ctx.error("my_chat_member upsert failed", err);
  }
}

async function handleChatMember(
  upd: TgChatMemberUpdated,
  ctx: InvocationContext,
): Promise<void> {
  const groupId = String(upd.chat.id);
  const userId = String(upd.new_chat_member.user.id);
  const newStatus = upd.new_chat_member.status;
  const memberDoc: GroupUserDoc = {
    id: `${groupId}_${userId}`,
    groupId,
    userId,
    status: newStatus,
    isAdmin: isAdminStatus(newStatus),
    updatedAt: new Date().toISOString(),
  };
  try {
    await upsertMembership(memberDoc);
  } catch (err) {
    ctx.error("chat_member upsert failed", err);
  }
}

// Cached bot user id (derived from getMe).
let _botUserId: number | undefined;
async function getBotUserId(): Promise<number> {
  if (_botUserId) return _botUserId;
  const url = `https://api.telegram.org/bot${env.telegramBotToken}/getMe`;
  const res = await fetch(url);
  const data = (await res.json()) as { ok: boolean; result?: { id: number } };
  if (!data.ok || !data.result) {
    throw new Error("getMe failed");
  }
  _botUserId = data.result.id;
  return _botUserId;
}

async function safeSend(chatId: number | string, text: string): Promise<void> {
  try {
    await sendMessage({ chat_id: chatId, text });
  } catch (err) {
    if (err instanceof TelegramApiError) {
      // Swallow — best-effort confirmation.
    }
  }
}
