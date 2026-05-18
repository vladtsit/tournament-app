import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions';
import { validateInitData, InitDataError } from '../shared/telegramAuth.js';
import { issueSession } from '../shared/session.js';
import { resolveLanguage } from '../shared/i18n.js';
import { containers_ } from '../shared/cosmos.js';

interface AuthRequestBody {
  initData?: string;
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

app.http('authTelegram', {
  route: 'auth/telegram',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req: HttpRequest): Promise<HttpResponseInit> => {
    let body: AuthRequestBody;
    try {
      body = (await req.json()) as AuthRequestBody;
    } catch {
      return jsonError(400, 'invalid_body', 'Request body must be JSON.');
    }
    if (!body.initData) {
      return jsonError(400, 'missing_init_data', 'initData is required.');
    }

    let validated;
    try {
      validated = validateInitData(body.initData);
    } catch (err) {
      if (err instanceof InitDataError) {
        const status = err.code === 'expired' ? 401 : err.code === 'bad_signature' ? 401 : 400;
        return jsonError(status, err.code, 'initData validation failed.');
      }
      return jsonError(400, 'invalid_init_data', 'Could not parse initData.');
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
      // Read first so createdAt is preserved across upserts.
      const existing = await c.item(userId, userId).read<UserDoc>().catch(() => null);
      const existingResource = existing?.resource;
      if (existingResource) {
        doc.createdAt = existingResource.createdAt;
      }
      await c.items.upsert(doc);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'cosmos_error';
      return jsonError(503, 'cosmos_unavailable', message);
    }

    const token = await issueSession({ userId, language });

    return {
      status: 200,
      jsonBody: {
        token,
        expiresIn: Number(process.env['JWT_TTL_SECONDS'] ?? 14400),
        user: {
          id: userId,
          firstName: tgUser.first_name,
          lastName: tgUser.last_name ?? null,
          username: tgUser.username ?? null,
          language,
          photoUrl: tgUser.photo_url ?? null,
        },
        startParam: validated.startParam ?? null,
      },
    };
  },
});

function jsonError(status: number, code: string, message: string): HttpResponseInit {
  return {
    status,
    jsonBody: { error: { code, message } },
  };
}
