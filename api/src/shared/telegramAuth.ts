import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

// Telegram Mini App initData HMAC-SHA256 validation.
// Spec §10.4 + https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: Date;
  startParam?: string;
  chatInstance?: string;
  chatType?: string;
  queryId?: string;
  raw: Record<string, string>;
}

export type InitDataValidationError =
  | 'missing_hash'
  | 'missing_user'
  | 'missing_auth_date'
  | 'bad_signature'
  | 'expired'
  | 'malformed';

export class InitDataError extends Error {
  constructor(public readonly code: InitDataValidationError, message?: string) {
    super(message ?? code);
    this.name = 'InitDataError';
  }
}

/**
 * Validate the raw `initData` string from `window.Telegram.WebApp.initData`.
 * Throws `InitDataError` on any failure; returns the parsed payload on success.
 */
export function validateInitData(initData: string): ValidatedInitData {
  if (!initData || typeof initData !== 'string') {
    throw new InitDataError('malformed');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new InitDataError('missing_hash');

  const authDateStr = params.get('auth_date');
  if (!authDateStr) throw new InitDataError('missing_auth_date');

  const userStr = params.get('user');
  if (!userStr) throw new InitDataError('missing_user');

  // Build the data-check-string: all params except `hash`, sorted by key,
  // joined as `key=value` with `\n`.
  const entries: [string, string][] = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    entries.push([k, v]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  // secret = HMAC_SHA256(key="WebAppData", message=bot_token)
  const secretKey = createHmac('sha256', 'WebAppData').update(env.telegramBotToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expectedBuf = Buffer.from(hash, 'hex');
  const computedBuf = Buffer.from(computed, 'hex');
  if (expectedBuf.length !== computedBuf.length || !timingSafeEqual(expectedBuf, computedBuf)) {
    throw new InitDataError('bad_signature');
  }

  // Freshness window
  const authDateSec = Number(authDateStr);
  if (!Number.isFinite(authDateSec)) throw new InitDataError('malformed');
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDateSec > env.authDateMaxAgeSeconds) {
    throw new InitDataError('expired');
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userStr) as TelegramUser;
  } catch {
    throw new InitDataError('malformed');
  }
  if (typeof user.id !== 'number' || typeof user.first_name !== 'string') {
    throw new InitDataError('malformed');
  }

  const raw: Record<string, string> = {};
  for (const [k, v] of params.entries()) raw[k] = v;

  const result: ValidatedInitData = {
    user,
    authDate: new Date(authDateSec * 1000),
    raw,
  };
  const startParam = params.get('start_param');
  if (startParam) result.startParam = startParam;
  const chatInstance = params.get('chat_instance');
  if (chatInstance) result.chatInstance = chatInstance;
  const chatType = params.get('chat_type');
  if (chatType) result.chatType = chatType;
  const queryId = params.get('query_id');
  if (queryId) result.queryId = queryId;
  return result;
}
