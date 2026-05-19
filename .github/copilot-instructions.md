# GitHub Copilot — Repository Instructions

These rules apply to every Copilot interaction in this repository. They are deliberately short — defer to [padel_telegram_mini_app_requirements.md](../padel_telegram_mini_app_requirements.md) (v2.1) for anything not covered here.

## Project at a glance

Multi-tenant **Telegram Mini App** for organising casual pádel tournaments per Telegram group.

| Layer    | Tech                                                                    |
| -------- | ----------------------------------------------------------------------- |
| Frontend | **Vanilla React 18 + Vite 5** (TypeScript), workspace `app/`            |
| Backend  | **Managed Azure Functions v4** (TypeScript, **Node 22 LTS**), `api/`    |
| Hosting  | **Azure Static Web Apps — Free tier** (managed Functions, no BYOF)      |
| Data     | **Azure Cosmos DB for NoSQL** (Free tier, shared-throughput database)   |
| Auth     | Telegram `initData` (HMAC + Ed25519) → JWT HS256 (4h, bearer-preferred) |

Cost target: **$0/month** at low volume. Do not propose changes that violate this (e.g. Premium Functions, Cosmos dedicated throughput, SWA Standard tier, App Insights tier above Free).

## Workspace conventions

- **npm workspaces** (`app/`, `api/`). Do **not** introduce pnpm/yarn/turbo/nx.
- Top-level scripts: `dev`, `build`, `lint`, `typecheck`. Add new scripts at workspace level first, hoist only when shared.
- TypeScript only. **No** plain `.js` source files (config files like `eslint.config.js` are fine).
- TS strict mode is on, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Honour these — don't loosen the config.
- ES modules everywhere (`"type": "module"` in `app/`; Node16 module resolution in `api/`).
- Keep files small and feature-scoped per the layout in spec §8.

## Frontend rules (`app/`)

- **Vanilla React** only: no Next.js, no Remix, no React Server Components, no meta-frameworks.
- Routing: `react-router-dom` v6. State: prefer local state + URL; introduce `zustand` only if a real cross-page need appears.
- Telegram WebApp script is loaded in `index.html`; access via a typed wrapper (`src/telegram.ts`), never via `window.Telegram` directly in components.
- Use Telegram's native UI primitives where applicable: **MainButton/BottomButton**, **BackButton**, **HapticFeedback**, **CloudStorage** (per spec §11).
- Respect Telegram theme variables (`var(--tg-theme-*)`). Do **not** ship a custom theme system.
- All API calls go through `src/apiClient.ts`, which:
  - Attaches the session JWT as `Authorization: Bearer …` (bearer is preferred over cookies per spec §10.7).
  - Sends `Idempotency-Key` headers for mutating endpoints listed in spec §22.5.

## Backend rules (`api/`)

- **Azure Functions v4 programming model** (`app.http(...)`, no `function.json`).
- Register all endpoints by importing them in `src/index.ts`.
- One handler per file in `src/functions/`; shared logic in `src/shared/`.
- **Singleton** `CosmosClient` (export from `shared/cosmos.ts`) — never `new CosmosClient()` per request.
- Cosmos partitioning (spec §12.2): `/groupId` for tenant-scoped containers; `/userId` for `users`, `idempotency`, `team_slots`.
- Use the **shared-throughput database** at 1000 RU/s — do not create per-container throughput.
- **Auth flow** (spec §10): `POST /api/auth/telegram` validates `initData` (HMAC `WebAppData`, fallback Ed25519), returns short-lived JWT. All other endpoints use `requireAuth`.
- **Idempotency** (spec §22.5): mutating endpoints honour `Idempotency-Key` via `idem_{userId}_{key}` docs; body-hash mismatch → 422 `idempotency_conflict`.
- **Telegram webhook** (`/api/telegram/webhook`): verify `X-Telegram-Bot-Api-Secret-Token` header **before** parsing body.
- **Secrets**: never hardcode. Read from `process.env`. Production uses Key Vault references; locally uses `api/local.settings.json` (gitignored).
- Never log `initData`, JWTs, bot tokens, or full Cosmos documents containing user data.

## Padel scoring (spec §17)

- Best-of-3 sets; sets stored as `[{a:number, b:number}, …]`.
- Valid set: `(winner=6, loser∈0..4)` ∨ `(winner=7, loser∈{5,6})` ∨ deciding super-tiebreak `≥10` with lead `≥2`.
- The third set may be a regular set or a super-tiebreak — controlled by `groups.settings.tiebreakRule` (`"regular_set" | "super_tiebreak_to_10"`).
- Overall-score points per spec §13.2: podium **10 / 7 / 5 / 3 / 1** + `0.25 × wins`.

## Telegram specifics (spec §5, §9)

- Telegram Bot API target version: **10.0** (May 2026).
- Mini App launch URL format: `https://t.me/<bot_username>/app?startapp=g_<groupShortId>`.
- `initData` freshness window: **24 hours** (`AUTH_DATE_MAX_AGE_SECONDS`, spec §10.3 — not 5 minutes).
- Webhook `secret_token` charset: `[A-Za-z0-9_-]`, 1–256 chars.

## Things to NOT do

- ❌ Suggest Next.js, Remix, App Router, Server Components, or any SSR framework.
- ❌ Suggest pnpm/yarn/turbo/nx/lerna.
- ❌ Suggest Cosmos DB SDK v3 (use `@azure/cosmos` v4+).
- ❌ Suggest Azure Functions v3 programming model or `function.json`.
- ❌ Suggest Flex Consumption / Premium / Dedicated plans (Free tier requires managed Linux Consumption; see spec header).
- ❌ Suggest Application Insights ingestion above the Free 1 GB/month quota.
- ❌ Suggest Postgres, Redis, Service Bus, Cognitive Search, or any paid Azure service unless explicitly asked.
- ❌ Add docstrings, comments, or type annotations to code you didn't change.
- ❌ Refactor "for cleanliness" — make only the changes asked.

## When extending the requirements

- The spec file is the source of truth. If a code change implies a spec change, update the spec section explicitly and reference its number in the commit message.
- Section numbering is stable — when adding new content, append a sub-section rather than renumbering.

## Useful commands

```bash
npm install                 # install all workspaces
npm run dev                 # SWA emulator → app + api together
npm run dev:app             # Vite only (5173)
npm run dev:api             # func start only (7071)
npm run build               # build both
npm run typecheck           # strict TS check
npm run lint                # ESLint both workspaces
```
