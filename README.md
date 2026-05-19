# Sunday Pádel — Telegram Mini App

Multi-tenant Telegram Mini App for organising casual pádel tournaments.

**Stack:** Vanilla React 18 + Vite 5 (TS) · Azure Static Web Apps (Free) · Managed Azure Functions v4 (Node 22 TS) · Azure Cosmos DB for NoSQL (Free Tier, shared-throughput DB).

Full requirements: [padel_telegram_mini_app_requirements.md](padel_telegram_mini_app_requirements.md).

## Layout

```
app/    Vanilla React + Vite SPA
api/    Managed Azure Functions (v4 programming model)
infra/  (optional) Bicep for SWA + Cosmos + Key Vault
```

## Prerequisites

- Node.js **22 LTS** (see [.nvmrc](.nvmrc))
- npm 10+
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) (`func`)
- [Azure Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/) (`swa`, installed as dev-dep)
- (Optional) Docker — to use the [.devcontainer](.devcontainer/devcontainer.json)
- An Azure Cosmos DB for NoSQL account (Free Tier) — local dev connects directly to Azure; no emulator is used.

## Quick start

```bash
npm install
cp api/local.settings.json.example api/local.settings.json   # fill in secrets
npm run dev                                                  # SWA emulator on http://localhost:4280
```

| Command            | What it does                                        |
| ------------------ | --------------------------------------------------- |
| `npm run dev`      | SWA emulator → proxies SPA (5173) and API (7071)    |
| `npm run dev:app`  | Vite only                                           |
| `npm run dev:api`  | `func start` only                                   |
| `npm run build`    | Build SPA + API                                     |
| `npm run lint`     | Lint both workspaces                                |
| `npm run typecheck`| `tsc --noEmit` both workspaces                      |

## Deployment

GitHub Actions workflow at `.github/workflows/azure-static-web-apps.yml` builds the SPA and managed Functions and deploys to Azure Static Web Apps.

See [§7.2 — Backend](padel_telegram_mini_app_requirements.md) and the runtime notes in the spec header for the **Node 22 → Node 24 (Flex Consumption) migration plan** (target Q1 2027 when Node 22 nears EOL).

## In-app Help

Tap the `?` button in the top-right of the app for an overview of every screen
(registration, pairing, live submission, leaderboard, history, overall ranking,
admin tools). The help text is localised to EN/ES/RU.

## Operations

Detailed runbook lives at [docs/operations.md](docs/operations.md). Quick
links:

- Webhook (re-)registration after secret rotation → `docs/operations.md#telegram-webhook`
- Rotating SWA app settings (Cosmos key, JWT secret, bot token) → `docs/operations.md#secret-rotation`
- Adding a new group / promoting an admin → `docs/operations.md#adding-a-group`
- Enabling Application Insights (Free 1 GB/month) → `docs/operations.md#application-insights`
- Exporting BBQ list and match results → `docs/operations.md#csv-exports`
