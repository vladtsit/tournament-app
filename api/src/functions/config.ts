import { app, type HttpResponseInit } from "@azure/functions";
import { env } from "../shared/env.js";

// Public runtime config for the SPA. No secrets here.
app.http("config", {
  route: "config",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (): Promise<HttpResponseInit> => ({
    status: 200,
    jsonBody: {
      appName: "Sunday Pádel",
      botUsername: env.telegramBotUsername,
      miniAppShortName: env.miniAppShortName,
      languages: ["en", "es", "ru"],
    },
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  }),
});
