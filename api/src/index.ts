import { app } from '@azure/functions';

// v4 programming model: register HTTP functions here (one import per endpoint).
// Endpoints are added incrementally as per the requirements doc §8 / §22.
//
// Example:
//   import './functions/config';
//   import './functions/authTelegram';
//   import './functions/telegramWebhook';

// Health probe (kept lightweight; used by SWA + uptime checks).
app.http('health', {
  route: 'health',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async () => ({
    status: 200,
    jsonBody: { ok: true, ts: new Date().toISOString() },
  }),
});
