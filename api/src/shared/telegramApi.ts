import { env } from "./env.js";

// Thin Telegram Bot API wrapper. Only the methods we use in Phase 1.
// https://core.telegram.org/bots/api

const API_BASE = "https://api.telegram.org";

export class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly status: number,
    public readonly description: string,
    public readonly errorCode?: number,
  ) {
    super(`Telegram ${method} failed: ${status} ${description}`);
    this.name = "TelegramApiError";
  }
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// Hard cap on a single Telegram API call. SWA managed Functions have a
// generous ceiling, but a hung outbound fetch would still hold the invocation
// (and starve concurrency). 8 s is well above Telegram's normal p99.
const TELEGRAM_CALL_TIMEOUT_MS = 8_000;

async function call<T>(method: string, payload: unknown): Promise<T> {
  const url = `${API_BASE}/bot${env.telegramBotToken}/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted =
      (err as { name?: string } | undefined)?.name === "AbortError";
    throw new TelegramApiError(
      method,
      aborted ? 408 : 0,
      aborted ? "timeout" : "network_error",
    );
  } finally {
    clearTimeout(timer);
  }
  let data: TelegramResponse<T>;
  try {
    data = (await res.json()) as TelegramResponse<T>;
  } catch {
    throw new TelegramApiError(method, res.status, "non_json_response");
  }
  if (!res.ok || !data.ok || data.result === undefined) {
    throw new TelegramApiError(
      method,
      res.status,
      data.description ?? "unknown_error",
      data.error_code,
    );
  }
  return data.result;
}

export interface SentMessage {
  message_id: number;
  chat: { id: number };
  date: number;
}

export interface ChatMember {
  status:
    | "creator"
    | "administrator"
    | "member"
    | "restricted"
    | "left"
    | "kicked";
  user: { id: number; is_bot?: boolean };
  can_pin_messages?: boolean;
  can_post_messages?: boolean;
}

export interface ChatMemberAdmin extends ChatMember {
  status: "creator" | "administrator";
}

export function isAdminStatus(status: ChatMember["status"]): boolean {
  return status === "creator" || status === "administrator";
}

export async function sendMessage(payload: {
  chat_id: number | string;
  text: string;
  parse_mode?: "MarkdownV2" | "HTML";
  reply_markup?: unknown;
  disable_notification?: boolean;
  reply_to_message_id?: number;
}): Promise<SentMessage> {
  return await call<SentMessage>("sendMessage", payload);
}

export async function pinChatMessage(payload: {
  chat_id: number | string;
  message_id: number;
  disable_notification?: boolean;
}): Promise<boolean> {
  return await call<boolean>("pinChatMessage", payload);
}

export async function editMessageText(payload: {
  chat_id: number | string;
  message_id: number;
  text: string;
  parse_mode?: "MarkdownV2" | "HTML";
  reply_markup?: unknown;
}): Promise<unknown> {
  return await call<unknown>("editMessageText", payload);
}

export async function getChatMember(payload: {
  chat_id: number | string;
  user_id: number | string;
}): Promise<ChatMember> {
  return await call<ChatMember>("getChatMember", payload);
}

export async function setMyCommands(payload: {
  commands: Array<{ command: string; description: string }>;
  scope?: { type: string; chat_id?: number | string };
  language_code?: string;
}): Promise<boolean> {
  return await call<boolean>("setMyCommands", payload);
}
