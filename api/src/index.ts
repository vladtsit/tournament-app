import { app } from "@azure/functions";

// v4 programming model: register HTTP functions here (one import per endpoint).
import "./functions/config.js";
import "./functions/authTelegram.js";
import "./functions/telegramWebhook.js";
import "./functions/groupsMine.js";
import "./functions/tournamentCreate.js";
import "./functions/tournamentCurrent.js";
import "./functions/registrationUpsert.js";
import "./functions/teamsLookingForTeammate.js";
import "./functions/teamCreate.js";

// Health probe (kept lightweight; used by SWA + uptime checks).
app.http("health", {
  route: "health",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (req) => {
    const headers: Record<string, string> = {};
    try {
      const entries =
        typeof (req.headers as unknown as { entries?: () => Iterable<[string, string]> }).entries === "function"
          ? Array.from(
              (req.headers as unknown as { entries: () => Iterable<[string, string]> }).entries(),
            )
          : [];
      for (const [k, v] of entries) {
        headers[k] = k.toLowerCase().includes("auth") ? `len=${v.length}:prefix=${v.slice(0, 12)}` : v;
      }
    } catch (e) {
      headers["__err"] = e instanceof Error ? e.message : "unknown";
    }
    return {
      status: 200,
      jsonBody: {
        ok: true,
        ts: new Date().toISOString(),
        headerCount: Object.keys(headers).length,
        headers,
      },
    };
  },
});
