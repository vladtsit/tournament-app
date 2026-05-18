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
import "./functions/tournamentStart.js";
import "./functions/matchSubmit.js";
import "./functions/matchesList.js";
import "./functions/matchConfirm.js";
import "./functions/matchDispute.js";
import "./functions/availableOpponents.js";
import "./functions/tournamentLeaderboard.js";

// Health probe (kept lightweight; used by SWA + uptime checks).
app.http("health", {
  route: "health",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async () => ({
    status: 200,
    jsonBody: { ok: true, ts: new Date().toISOString() },
  }),
});
