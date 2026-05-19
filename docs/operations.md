# Operations runbook

This document captures the routine maintenance tasks for the Sunday Pádel app.
Anything not here defers to the full spec at
[`padel_telegram_mini_app_requirements.md`](../padel_telegram_mini_app_requirements.md)
and the implementation plan at
[`implementation_plan.md`](implementation_plan.md).

## Environment overview

| Resource        | Name / value                                           |
| --------------- | ------------------------------------------------------ |
| Resource group  | `rg-freetier`                                          |
| Static Web App  | `swa-free`                                             |
| Public host     | `green-ground-018c96b03.7.azurestaticapps.net`         |
| Cosmos account  | `cdb-free` (serverless, free tier)                     |
| Cosmos database | `padel`                                                |
| Telegram bot    | `@tournamentes_bot`                                    |
| Mini app path   | `https://t.me/tournamentes_bot/app`                    |
| App sub-path    | `/tournamentes/`                                       |
| Repository      | `vladtsit/tournament-app` (`main` branch auto-deploys) |

All SWA configuration lives in `staticwebapp.config.json`. The Functions
runtime is **Node 22 LTS** on the SWA-managed Linux Consumption plan.

## Telegram webhook

The webhook handler is at `POST /api/telegram/webhook` and verifies the
`X-Telegram-Bot-Api-Secret-Token` header **before** parsing the body.

### Re-register after deploying

```bash
SECRET="$(az staticwebapp appsettings list -n swa-free -g rg-freetier \
  --query "properties.TELEGRAM_WEBHOOK_SECRET" -o tsv)"
TOKEN="$(az staticwebapp appsettings list -n swa-free -g rg-freetier \
  --query "properties.TELEGRAM_BOT_TOKEN" -o tsv)"

curl -sS "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  --data-urlencode "url=https://green-ground-018c96b03.7.azurestaticapps.net/api/telegram/webhook" \
  --data-urlencode "secret_token=${SECRET}" \
  --data-urlencode "drop_pending_updates=true"
```

To inspect the current webhook:

```bash
curl -sS "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | jq .
```

### Rotate the webhook secret

1. Generate a new token (1–256 chars, `[A-Za-z0-9_-]`):
   ```bash
   NEW="$(openssl rand -hex 32)"
   ```
2. Update the SWA app setting **and** Telegram together so there's no gap:
   ```bash
   az staticwebapp appsettings set -n swa-free -g rg-freetier \
     --setting-names TELEGRAM_WEBHOOK_SECRET="$NEW"
   curl -sS "https://api.telegram.org/bot${TOKEN}/setWebhook" \
     --data-urlencode "url=https://green-ground-018c96b03.7.azurestaticapps.net/api/telegram/webhook" \
     --data-urlencode "secret_token=$NEW"
   ```
3. The Functions host restarts within ~30 s after the setting changes.

## Secret rotation

All secrets are stored as **SWA application settings** (no Key Vault; cost
trade-off accepted per the implementation plan).

```bash
az staticwebapp appsettings list -n swa-free -g rg-freetier -o table
```

| Setting                                     | Used by                                    |
| ------------------------------------------- | ------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`                        | webhook + auth (bot username, sendMessage) |
| `TELEGRAM_BOT_USERNAME`                     | mini-app launch URL                        |
| `TELEGRAM_WEBHOOK_SECRET`                   | webhook handshake                          |
| `JWT_SECRET`                                | session token HS256 signature              |
| `JWT_TTL_SECONDS` (optional, default 14400) | session lifetime                           |
| `AUTH_DATE_MAX_AGE_SECONDS` (default 86400) | `initData` freshness window                |
| `COSMOS_ENDPOINT`                           | Cosmos client                              |
| `COSMOS_KEY`                                | Cosmos client                              |
| `COSMOS_DATABASE_ID`                        | Cosmos client (`padel`)                    |
| `APPLICATIONINSIGHTS_CONNECTION_STRING`     | optional telemetry                         |

Rotation steps for any secret:

```bash
az staticwebapp appsettings set -n swa-free -g rg-freetier \
  --setting-names <NAME>=<NEW_VALUE>
```

For `JWT_SECRET`, expect all live sessions to fail until users reload the app
(they'll be prompted to reopen from Telegram). For `COSMOS_KEY`, you must
swap to the secondary key in the Cosmos portal **before** updating the SWA
setting so reads/writes never see a 401.

## Adding a group

Groups are created automatically the first time the bot is added to a group
chat and a member opens the Mini App from the pinned welcome message
(`/start@tournamentes_bot` flow inside the webhook). There is no admin
console for groups today.

### Promote / demote a group admin manually

Direct Cosmos write:

```bash
GROUP_ID="<group cosmos id>"
USER_ID="<user cosmos id>"

az cosmosdb sql container query -g rg-freetier -a cdb-free -d padel \
  -n group_users \
  --query-text "SELECT * FROM c WHERE c.id = '${GROUP_ID}_${USER_ID}'" \
  --partition-key-value "$GROUP_ID"
```

Then patch the `isAdmin` flag (use the Cosmos VS Code extension for a UI, or
the Data Explorer in the Azure portal). The change takes effect on the
user's next request (no cache).

## Application Insights

Wiring is **opt-in**: if `APPLICATIONINSIGHTS_CONNECTION_STRING` is unset,
the API skips loading the SDK entirely (zero cold-start cost). On the SWA
Free tier the App Insights Free quota is **1 GB ingestion / month** — the
SDK is configured to track HTTP requests + exceptions only, no live metrics
or performance counters.

### Enable

```bash
APP_INSIGHTS_CS="$(az monitor app-insights component create \
  -g rg-freetier -a ai-padel -l westeurope \
  --kind web --application-type web \
  --query connectionString -o tsv)"

az staticwebapp appsettings set -n swa-free -g rg-freetier \
  --setting-names APPLICATIONINSIGHTS_CONNECTION_STRING="$APP_INSIGHTS_CS"
```

The Functions host restarts within ~30 s. Requests show up under
**Application Insights → Investigate → Transaction search**, tagged with
cloud role `padel-api`.

### Daily ingestion check

```bash
az monitor app-insights events show -g rg-freetier -a ai-padel \
  --type requests --start-time $(date -u -d "1 day ago" +%FT%TZ) \
  --query 'value | length(@)'
```

If usage trends above ~30 MB / day, drop the sampling rate or disable
auto-collect exceptions until the spike is investigated. **Never log
`initData`, JWTs, bot tokens, or full Cosmos documents containing user
data.**

## CSV exports

Admin-only endpoints, accessible from the **Admin overview** card on the
Current tab:

| Endpoint                                             | What it returns                                              |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/tournaments/{tournamentId}/bbq-export`     | `userId,firstName,lastName,playing,bbq,updatedAt`            |
| `GET /api/tournaments/{tournamentId}/results-export` | `matchId,submittedAt,status,teamA,teamB,set1..set3,winner,…` |

Both honor the same `X-Session-Token` auth as the rest of the API; the
front-end downloads the file via `fetch` + `Blob` so the browser triggers
a normal download dialog.

## Useful one-liners

```bash
# Tail SWA function logs (last 1 h):
az monitor log-analytics query -w "$LAW_ID" \
  --analytics-query "FunctionAppLogs | where TimeGenerated > ago(1h) | project TimeGenerated, FunctionName, Level, Message | order by TimeGenerated desc"

# Count documents per container:
for c in users groups group_users audit tournaments registrations teams \
         team_invites team_slots matches player_stats idempotency; do
  echo -n "$c: "
  az cosmosdb sql container query -g rg-freetier -a cdb-free -d padel -n "$c" \
    --query-text "SELECT VALUE COUNT(1) FROM c" -o tsv
done

# Re-trigger the GitHub Actions deploy for the latest commit:
gh workflow run "Azure Static Web Apps CI/CD" --ref main
```
