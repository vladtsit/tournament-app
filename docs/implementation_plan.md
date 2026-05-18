# Plan: Develop Sunday Pádel Mini App (Full MVP)

End-to-end plan to deliver the Telegram Mini App against the existing free-tier Azure infra (`rg-freetier` / `swa-free` / `cdb-free`) and bot `@tournamentes_bot`, deployed via GitHub Actions. The SPA is served under `/tournamentes/`; the SWA root hosts a static placeholder reserved for unrelated future use. Plan tracks the 6 spec phases (§30) as verifiable checkpoints.

## Conventions / global decisions

- **App sub-path**: Vite `base: '/tournamentes/'`; SWA `routes` rewrites `/tournamentes/*` → SPA index. Root `/` serves a tiny static placeholder. `navigationFallback` excludes both root assets and `/api/*`.
- **Bot**: `@tournamentes_bot`. Mini App Web App URL = `https://<swa-host>/tournamentes/`. Launch link `https://t.me/tournamentes_bot/app?startapp=g_<short>`.
- **Languages**: English (`en`, default fallback), Spanish (`es`), Russian (`ru`). Initial language taken from Telegram `initDataUnsafe.user.language_code` (ISO 639-1, validated via signed `initData.user` server-side); falls back to `en` for any unsupported code. User can override in-app; override persisted in Telegram `CloudStorage` (key `lang`) with `localStorage` fallback.
- **Cosmos auth**: account key in SWA application settings (`COSMOS_AUTH_MODE=key`, `COSMOS_KEY=…`). Singleton `CosmosClient` in `api/src/shared/cosmos.ts`.
- **Secrets**: `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET_TOKEN`, `JWT_SIGNING_KEY`, `COSMOS_KEY` stored as plain SWA application settings (no Key Vault). Never logged. Local dev uses `api/local.settings.json` (gitignored).
- **Deployment**: existing workflow `.github/workflows/azure-static-web-apps.yml`. Once SWA → repo link is created in Phase 0, every push to `main` builds + deploys; PRs get preview environments.
- **Spec compliance**: keep `padel_telegram_mini_app_requirements.md` as source of truth; reference section numbers in commits when behavior is added.

---

## Phase 0 — Infra wiring + sub-path scaffold + auth handshake ✅ (live; BotFather pending)

Goal: pushing to `main` deploys the SPA at `https://green-ground-018c96b03.7.azurestaticapps.net/tournamentes/`, the placeholder lives at `/`, and a user opening the Mini App from `@tournamentes_bot` gets back a valid session JWT.

**Status (live, verified)**

- `GET /` → 200 placeholder ("Reserved").
- `GET /tournamentes/` → 200 SPA shell referencing `/tournamentes/assets/…`.
- `GET /api/config` → 200 `{"appName":"Sunday Pádel","botUsername":"tournamentes_bot","miniAppShortName":"app","languages":["en","es","ru"]}`.
- `GET /api/health` → 200.
- Deploy on push to `main` via `.github/workflows/azure-static-web-apps.yml`.

**Deploy lessons learned (post-mortem)**

- **Do NOT set `skip_api_build: true`** on the SWA action — managed Functions deploy needs Oryx to detect Node inside its own container. Pre-built `api/dist` from the runner is not used.
- **`staticwebapp.config.json` must be inside `output_location`** (we copy it to `app/dist/` via `scripts/copy-placeholder.mjs`).
- **No duplicate route entries** for `/tournamentes` and `/tournamentes/` — SWA fails the route table validation silently and falls back to no config. The sub-path is served by `app/dist/tournamentes/index.html` (SWA's directory→index.html behaviour) + `navigationFallback`.
- Final SWA action inputs: `app_location: '/'`, `api_location: 'api'`, `output_location: 'app/dist'`, `app_build_command: 'npm run build:app'`.

**As-built notes**

- **SWA**: `swa-free` in `rg-freetier` (West Europe, Free SKU). Hostname **`green-ground-018c96b03.7.azurestaticapps.net`**.
- **Cosmos**: account `cdb-free` is **serverless** (not free-tier discounted, `enableFreeTier=false`). Throughput flags omitted on DB/container create. Cost at idle ≈ $0 (pay-per-request, no minimum RU/s).
- **GitHub repo**: `vladtsit/tournamentes-app` → secret `AZURE_STATIC_WEB_APPS_API_TOKEN` set.
- **Env var names** kept aligned with the existing `api/local.settings.json` (not the spec's verbatim names): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (stored without leading `@`), `TELEGRAM_WEBHOOK_SECRET`, `JWT_SECRET`, `JWT_TTL_SECONDS`, `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE_ID`, `AUTH_DATE_MAX_AGE_SECONDS`, `PIN_DEBOUNCE_SECONDS`, `APP_BASE_URL`, `LOG_LEVEL`. **No `COSMOS_AUTH_MODE` env** — key-only auth is the single path (SWA Free has no MI for managed Functions).

**Steps**

1. **Deployment token** — done: read via `az staticwebapp secrets list -g rg-freetier -n swa-free --query properties.apiKey -o tsv` and stored as repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. The existing workflow `.github/workflows/azure-static-web-apps.yml` deploys on push to `main` and previews PRs.
2. **Sub-path build** — done: `app/vite.config.ts` sets `base: '/tournamentes/'`, `build.outDir: 'dist/tournamentes'`, `emptyOutDir: true`. Router will switch to `BrowserRouter` with `basename="/tournamentes"` when route screens are added (Phase 1+); for now the SPA renders without a router.
3. **Placeholder at root** — done: source HTML at `scripts/placeholder.html`; `scripts/copy-placeholder.mjs` runs as part of `npm run build:app` and copies it to `app/dist/index.html`. Kept outside `app/public/` so Vite doesn't bundle it into the SPA.
4. **SWA routing** — done in [staticwebapp.config.json](../staticwebapp.config.json): only `/api/telegram/webhook` (POST/anon) + `/api/*` (anon) route entries; `navigationFallback.rewrite = /tournamentes/index.html` with excludes for `/`, `/index.html`, `/api/*`, asset patterns. `responseOverrides.404` rewrites SPA deep links. (Earlier `/tournamentes` + `/tournamentes/` routes removed — caused duplicate-rule validation failure.)
5. **GH workflow** — `app_location: '/'`, `api_location: 'api'`, `output_location: 'app/dist'`, `app_build_command: 'npm run build:app'`. CI pre-steps (typecheck/lint/build) kept for early failure; Oryx rebuilds inside the SWA container.
6. **API skeleton** — done:
   - `shared/env.ts` — centralised env reader (single error path for misconfig).
   - `shared/cosmos.ts` — singleton `CosmosClient` + `containers_.users()` helper.
   - `shared/telegramAuth.ts` — HMAC-SHA256 `initData` validation per spec §10.4 with 24h freshness window (`AUTH_DATE_MAX_AGE_SECONDS`), `InitDataError` codes.
   - `shared/session.ts` — HS256 `jose` JWT (issuer `tournamentes`, audience `tournamentes-app`, default TTL 4 h).
   - `shared/requireAuth.ts` — bearer extractor + `verifySession` wrapper (used from Phase 1 onwards).
   - `shared/i18n.ts` — server-side `resolveLanguage()` (`en|es|ru`).
   - `functions/config.ts` — `GET /api/config` → `{appName, botUsername, miniAppShortName, languages}`.
   - `functions/authTelegram.ts` — `POST /api/auth/telegram` → validates `initData`, upserts `users/{userId}` (partition `/userId`), returns `{token, expiresIn, user, startParam}`.
   - Registered in `api/src/index.ts` (health probe kept).
7. **App skeleton** — done:
   - `telegram.ts` — typed wrapper (`getWebApp`, `isInTelegram`, `storage` with `CloudStorage`→`localStorage` fallback, types for `MainButton`, `BackButton`, `HapticFeedback`).
   - `apiClient.ts` — `fetch` wrapper with `Authorization: Bearer`, `Accept-Language`, optional `Idempotency-Key`; `ApiClientError` carries `{status, code, message}`.
   - `hooks/useTelegramAuth.ts` — calls `/api/auth/telegram` on mount, stores JWT in memory.
   - `i18n/index.ts` + `locales/{en,es,ru}.json` — `i18next` initialised before first paint (see i18n section).
   - `App.tsx` — minimal UI: title, language picker, auth status (localized error messages by `error.code`).
   - Router not yet added — will arrive in Phase 1 alongside the group picker.
8. **Cosmos** — done: database `padel` + container `users` (partition `/userId`) provisioned via `az cosmosdb sql database create` / `container create` (serverless mode, no throughput args).
9. **SWA app settings** — done via `az staticwebapp appsettings set -g rg-freetier -n swa-free --setting-names …` for all keys listed under "As-built notes" above. Secrets generated with `openssl rand -hex 32` (webhook) / `-hex 48` (JWT).
10. **BotFather** (**MANUAL, pending**): `/newapp` for `@tournamentes_bot` → Web App URL `https://green-ground-018c96b03.7.azurestaticapps.net/tournamentes/`, short name `app`. Then Bot Settings → Menu Button → URL `https://t.me/tournamentes_bot/app`. Webhook registration is deferred to Phase 1 (when the handler exists).

**Verification**

1. ✅ `npm install && npm run typecheck && npm run lint && npm run build` clean locally; dist tree:
   - `app/dist/index.html` (placeholder)
   - `app/dist/tournamentes/index.html` + `assets/…`
   - `api/dist/src/**` compiled
2. On push to `main`: GitHub Actions deploys; browse `https://green-ground-018c96b03.7.azurestaticapps.net/` → placeholder; `…/tournamentes/` → SPA showing "Open this app from Telegram" (no `initData`).
3. `curl https://green-ground-018c96b03.7.azurestaticapps.net/api/config` returns `{ botUsername: "tournamentes_bot", … }`.
4. Open `https://t.me/tournamentes_bot/app` from Telegram (after step 10) → SPA loads localized, `/api/auth/telegram` returns 200, "Welcome, <name>" shown.

---

## Phase 1 — Multi-tenant onboarding (bot webhook + /setup) ✅ (live; awaiting in-group test)

Goal: a group admin can add `@tournamentes_bot`, promote it, run `/setup`, and the bot pins the Mini App launch message; subsequent member updates populate the membership cache.

**Status (live)**

- `POST /api/telegram/webhook` → 401 without correct secret header; processes valid updates.
- `GET /api/groups/mine` → 401 without auth (requires bearer JWT).
- Telegram webhook registered at `https://green-ground-018c96b03.7.azurestaticapps.net/api/telegram/webhook` with `allowed_updates=["message","my_chat_member","chat_member","chat_join_request","callback_query"]`. Confirmed via `getWebhookInfo`.
- Cosmos containers `groups`, `group_users`, `audit` created (partition `/groupId`, serverless).
- SPA shows a localized group picker when the user belongs to >1 active group.

**Shipped files**

- `api/src/shared/{ids,telegramApi,membership,pinnedMessage}.ts` + `i18n.ts` (added bot strings).
- `api/src/functions/{telegramWebhook,groupsMine}.ts`; `authTelegram.ts` extended (start_param → groupId, returns `groups[]`).
- `app/src/features/groups/GroupPicker.tsx`; `useTelegramAuth` reworked (status `picking_group`, `selectGroup` callback).
- `scripts/set-webhook.sh` (idempotent register / `--info` / `--delete`).

**Manual test (next)**

1. Add `@tournamentes_bot` to a Telegram group and promote it with **Pin messages** right.
2. Send `/setup` as an admin → expect:
   - Bot replies with localized confirmation.
   - A "Sunday Pádel" message gets posted and pinned with the `t.me/tournamentes_bot/app?startapp=g_<short>` link.
   - Cosmos `groups/{chatId}` doc exists with a 4-char `groupShortId`.
   - `group_users/{chatId}_{adminUserId}` exists with `isAdmin: true`.
3. Open the pinned link → SPA authenticates and lands directly on the (otherwise empty) home screen.
4. Add the bot to a second group, repeat → opening the Mini App without `startapp` shows the picker with both groups.

---

## Phase 2 — Registration + teams

Goal: players can register yes/no, set BBQ yes/no, create teams via invite/accept, or appear on a "looking for teammate" list.

**Steps**

1. **Containers**: `tournaments` (`/groupId`), `registrations` (`/groupId`), `teams` (`/groupId`), `team_invites` (`/groupId`), `team_slots` (`/userId`) — last one enforces "user in ≤1 active team per tournament".
2. **Admin tournament create/start endpoints**: `POST /api/groups/{groupId}/tournaments` (admin), state machine `draft → registration_open`.
3. **Registration** `POST /api/tournaments/{id}/registrations` (idempotent on `userId`): `{playing, bbq}`. Updates pinned message via debounced render.
4. **Team endpoints**: `POST /api/tournaments/{id}/teams` (creator), `POST /api/team-invites/{id}/respond` (accept/decline using transactional batch on a single `/groupId` partition: mutate invite + team + `team_slots`). `GET /api/tournaments/{id}/looking-for-teammate`.
5. **Idempotency** middleware (`shared/idempotency.ts`): `idem_{userId}_{key}` docs in `idempotency` container (`/userId`); body-hash mismatch ⇒ 422 `idempotency_conflict` (spec §22.5).
6. **SPA features**: `features/registration/`, `features/teams/`; reuse Telegram `MainButton` per spec §11; haptics on primary actions.

**Relevant files**

- `api/src/functions/{tournamentCurrent,registrationUpsert,teamCreate,teamInviteRespond,teamsAvailable}.ts`
- `api/src/shared/idempotency.ts`
- `app/src/features/{registration,teams}/`

**Verification**

1. Cosmos: registering twice with same `Idempotency-Key` only mutates once; different body ⇒ 422.
2. Same user cannot be in two active teams (transactional batch enforces `team_slots`).
3. Pinned message in Telegram group updates after registrations but no more than once per `pinDebounceSeconds`.

---

## Phase 3 — Live tournament + match results

Goal: admin starts the tournament; teams set availability; players submit padel results and confirm/dispute; leaderboard updates live; pinned message reflects live state.

**Steps**

1. **Containers**: `matches` (`/groupId`) with `_etag` concurrency.
2. **State transition** `registration_open → live` via admin endpoint; render live-phase pinned message.
3. **Team status** `POST /api/teams/{id}/status` (`available|resting|stopped`).
4. **Opponents list** `GET /api/tournaments/{id}/available-opponents` (excludes self team, ordered by least-played).
5. **Match submit** `POST /api/tournaments/{id}/matches` — requires `Idempotency-Key`; validates submitter is on one of the teams; validates padel set rules per spec §17 + `groups.settings.tiebreakRule`; warns (not blocks) if same pair played within 20 min.
6. **Confirm / dispute** `POST /api/matches/{id}/confirm|dispute` with `If-Match` ETag; background timer auto-confirms after 30 min via the existing webhook function (no Timer trigger needed on Free tier — piggy-back on next read using a lazy reconciliation pattern).
7. **Live leaderboard** `GET /api/tournaments/{id}/leaderboard` — min-matches gate from settings; pts/match + W/L + diff.
8. **SPA features**: `features/matches/`, `features/leaderboard/`, opponent finder UI, score entry stepper with BottomButton.

**Relevant files**

- `api/src/functions/{adminTournamentStart,teamStatusSet,teamsAvailable,matchSubmit,matchConfirm,matchDispute,leaderboard}.ts`
- `api/src/shared/scoring.ts` — padel set validation, leaderboard aggregation.
- `app/src/features/{matches,leaderboard}/`

**Verification**

1. Submit valid 6-4 6-2 set list ⇒ counted; invalid 6-5 ⇒ 400 `invalid_score`.
2. Two identical submissions with same `Idempotency-Key` return the same `matchId`.
3. Dispute flips badge in leaderboard without removing the points (spec §31 row 5).
4. Auto-confirm fires within ~30 min after submission (or on next read after threshold).

---

## Phase 4 — History + overall (cross-tournament) score

Goal: ending a tournament snapshots final standings; per-player `player_stats` aggregates podium points + 0.25 × wins across all ended tournaments in the group.

**Steps**

1. **Container**: `player_stats` (`/userId`) keyed by `{groupId}_{userId}_{season}`.
2. **Finalize endpoint** `POST /api/tournaments/{id}/end` (admin): compute final standings, write `tournaments.finalStandings`, update each player's `player_stats` doc in a single transactional batch per partition (spec §13.2 podium 10/7/5/3/1 + 0.25 × wins).
3. **History endpoints**: `GET /api/tournaments/history`, `GET /api/tournaments/{id}/leaderboard` (works for ended ones too), `GET /api/groups/{id}/overall-score`.
4. **Admin recompute** `POST /api/admin/recompute-stats` — recompute from match history if data drifts.
5. **SPA**: `features/history/` (list of past tournaments + overall-score table).

**Relevant files**

- `api/src/functions/{adminTournamentEnd,tournamentHistory,overallScore,adminRecomputeStats}.ts`
- `app/src/features/history/`

**Verification**

1. End a test tournament → `tournaments.finalStandings` populated, `player_stats` updated, history view shows the snapshot.
2. Recompute returns identical numbers to live values (idempotent).

---

## i18n (cross-cutting from Phase 0, completed by Phase 2)

Localization is MVP scope (overrides spec §27.3 which listed it as "later"). Bundled in Phase 0 with EN strings only so the auth/placeholder flow ships localized from day one; ES and RU translations added incrementally as features land in Phases 1–2.

**Library**: `i18next` + `react-i18next` (small, framework-agnostic, no server needed). No backend plugin; bundles are imported statically so they're tree-shaken into the Vite build per chunk.

**Steps**

1. **Install** (in `app/`): `i18next`, `react-i18next`. No `i18next-http-backend` — we want offline-first behavior inside Telegram.
2. **Locale resolution order** (`app/src/i18n/resolveLocale.ts`):
   1. Explicit user override from Telegram `CloudStorage` key `lang` (or `localStorage` fallback).
   2. `Telegram.WebApp.initDataUnsafe.user.language_code` truncated to the 2-letter primary subtag.
   3. `navigator.language` primary subtag (outside-Telegram fallback).
   4. `en`.
      Any code not in `['en','es','ru']` collapses to `en`.
3. **Bundles** (`app/src/i18n/locales/{en,es,ru}.json`): flat keys grouped by feature (`auth.*`, `registration.*`, `teams.*`, `matches.*`, `leaderboard.*`, `history.*`, `admin.*`, `errors.*`, `common.*`). Keep keys English-readable (`registration.bbq.title`).
4. **Init** (`app/src/i18n/index.ts`): create `i18next` instance with `fallbackLng: 'en'`, `interpolation.escapeValue: false`, `returnNull: false`. Call before mounting React. Re-init / `i18n.changeLanguage()` when the user picks a new language in settings.
5. **Language switcher** in app settings screen (added in Phase 2 with the registration UI): three buttons (EN / ES / RU), writes to `CloudStorage` and calls `i18n.changeLanguage()`. Haptic feedback on change.
6. **Server-side localization**: Telegram bot messages (pinned message, `/setup` reply, DM notifications) localized per **group**, not per user (a pinned group message has a single audience). Store `groups.settings.language` (default = language of the user who ran `/setup`, derived from their `initData.user.language_code`). API error responses include `error.code` only; the SPA renders the localized message from `errors.<code>`.
7. **Server bundles** (`api/src/shared/i18n.ts`): tiny `t(lang, key, vars?)` helper with the same three JSON files copied into `api/src/i18n/locales/` — used only for bot-side messages. Keep server bundles minimal (only `bot.*` and `errors.*` namespaces) to avoid drift; SPA strings stay app-side.
8. **Number / date formatting**: use `Intl.NumberFormat` and `Intl.DateTimeFormat` with the active locale; no extra library. Russian uses `'ru-RU'`, Spanish `'es-ES'` (configurable later if needed).
9. **Plurals**: rely on `i18next`'s built-in plural rules (`_one` / `_few` / `_many` / `_other`) — important for Russian which has 3 plural forms (`1 матч`, `2 матча`, `5 матчей`).
10. **RTL / text expansion**: none of EN/ES/RU is RTL. Reserve ≈20% extra width on button labels (Russian + Spanish are typically longer than English).

**Relevant files**

- `app/src/i18n/{index,resolveLocale}.ts`, `app/src/i18n/locales/{en,es,ru}.json`
- `app/src/features/settings/LanguageSwitcher.tsx`
- `app/src/main.tsx` — init before render.
- `api/src/shared/i18n.ts`, `api/src/i18n/locales/{en,es,ru}.json`
- `padel_telegram_mini_app_requirements.md` — amend §27.3 to move i18n from "later" into MVP.

**Verification**

1. With Telegram client language = Russian, opening the Mini App shows Russian UI on first paint (no flash of English).
2. User toggles to Spanish in settings → immediate re-render in ES; relaunch app on another device → still ES (CloudStorage sync).
3. Unsupported `language_code` (e.g. `de`) falls back to EN without errors.
4. `/setup` reply and pinned message render in the language of the admin who triggered it.
5. Pluralization: `"3 матча"` / `"5 матчей"` render correctly in RU leaderboard.
6. Missing-key audit: build step (`scripts/check-i18n.mjs`) fails CI if any key exists in `en.json` but is missing in `es.json` or `ru.json`.

---

## Phase 5 — Polish

Goal: ship-quality UX, admin tooling, exports, light telemetry.

**Steps**

1. **Telegram UI primitives** across all flows: `MainButton`/`BottomButton`, `BackButton`, `HapticFeedback` per spec §11.
2. **CloudStorage** for last group / last teammate / last opponent (spec §11).
3. **Admin dashboard polish**: counts, edit/delete result, dispute queue.
4. **Exports**: `GET /api/admin/bbq-export` (CSV), `GET /api/admin/results-export` (CSV).
5. **Rate limiting** middleware on POST endpoints (30/min per user + per IP).
6. **App Insights free-tier** wiring (1 GB/month cap): connection string in app settings, structured logs (never log `initData`, JWTs, tokens).
7. **README + ops docs**: webhook re-registration, secret rotation, "how to add a group".

**Relevant files**

- `app/src/features/admin/`, shared components `BottomActionButton.tsx`, `BackButton.tsx`.
- `api/src/functions/admin*.ts`, `api/src/shared/rateLimit.ts`.

**Verification**

1. UX walkthrough on a real Android + iOS Telegram client.
2. Rate-limit test: 31st POST/min returns 429 with `Retry-After`.
3. App Insights shows requests + auth-failure counter; daily ingestion stays < 30 MB at idle.

---

## Decisions

- **One SWA, sub-path SPA**: app under `/tournamentes/` via `vite base` + SWA route rewrite; root `/` is a static placeholder. Both live in `app/dist` and ship in one workflow run.
- **Cosmos auth**: account key in SWA app settings (SWA Free has no managed identity); singleton `CosmosClient`.
- **Secrets**: plain SWA application settings (no Key Vault) — accepts the trade-off; rotation = re-run the `az staticwebapp appsettings set` command.
- **Deployment**: existing GitHub Actions workflow + repo secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. PRs → preview environments.
- **No emulator**: local dev hits the same Cosmos account; document a separate `padel-dev` database to avoid trampling prod (Phase 0).
- **`initData` freshness**: 24h per spec §10.3 (`AUTH_DATE_MAX_AGE_SECONDS=86400`).
- **Auto-confirm 30 min**: lazy reconciliation on reads (no Timer trigger on Free tier).
- **i18n in MVP** (EN/ES/RU): `i18next` + `react-i18next`, language resolved from Telegram `initDataUnsafe.user.language_code` with user override persisted in `CloudStorage`. Server-side bot strings localized per-group via `groups.settings.language`. Amends spec §27.3 (was "later").
- **Scope excluded** (deferred to spec Phase 6 / §27.3): Ed25519 signature path, GDPR self-service, Stars payments, smart matchups.

## Further Considerations

1. **Local Cosmos isolation** — recommend a `padel-dev` database in the same `cdb-free` account; or per-developer container suffix? Recommendation: separate database (still free).
2. **Placeholder content** — what should `/` show? Recommendation: minimal "Reserved — see /tournamentes" page; finalize copy with the user.
3. **Domain** — using the auto-assigned `*.azurestaticapps.net` host is sufficient for BotFather. Custom domain can be added later without breaking the bot config if we keep the auto host as the canonical Web App URL.
