// Centralised environment variable accessors. Reading via these helpers makes
// missing config a single, predictable error per setting.

function read(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function readOptional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  get telegramBotToken(): string {
    return read('TELEGRAM_BOT_TOKEN');
  },
  get telegramBotUsername(): string {
    // Tolerate optional leading @
    return read('TELEGRAM_BOT_USERNAME').replace(/^@/, '');
  },
  get telegramWebhookSecret(): string {
    return read('TELEGRAM_WEBHOOK_SECRET');
  },
  get jwtSecret(): string {
    return read('JWT_SECRET');
  },
  get jwtTtlSeconds(): number {
    return readNumber('JWT_TTL_SECONDS', 14400);
  },
  get authDateMaxAgeSeconds(): number {
    return readNumber('AUTH_DATE_MAX_AGE_SECONDS', 86400);
  },
  get cosmosEndpoint(): string {
    return read('COSMOS_ENDPOINT');
  },
  get cosmosKey(): string {
    return read('COSMOS_KEY');
  },
  get cosmosDatabaseId(): string {
    return read('COSMOS_DATABASE_ID');
  },
  get appBaseUrl(): string | undefined {
    return readOptional('APP_BASE_URL');
  },
  get miniAppShortName(): string {
    return readOptional('MINI_APP_SHORT_NAME') ?? 'app';
  },
};
