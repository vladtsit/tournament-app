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
- **Env var names** kept aligned with the existing `api/local.settings.json` (not the spec's verbatim names): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (stored without leading `@`), `TELEGRAM_WEBHOOK_SECRET`, `JWT_SECRET`, `JWT_TTL_SECONDS`, `COSMOS_ENDPOINT`, `COSMOS_KEY`, `COSMOS_DATABASE_ID`, `AUTH_DATE_MAX_AGE_SECONDS`, `APP_BASE_URL`, `LOG_LEVEL`. **No `COSMOS_AUTH_MODE` env** — key-only auth is the single path (SWA Free has no MI for managed Functions).

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

## Phase 2 — Registration + teams ✅ (live)

Goal: players can register yes/no, set BBQ yes/no, and form teams via instant pairing from a "looking for teammate" list.

**Status: shipped** — all 10 Cosmos containers exist, endpoints deployed, SPA wired.

**Simplification vs original plan**: replaced the invite/accept multi-step team-formation flow with **instant pairing**. Caller picks a partner from `looking-for-teammate` and the team is formed atomically (two `team_slots` writes with rollback on conflict, since the `/userId` partition forbids a single transactional batch across both users). Rationale: simpler UX, no multi-step state machine, no `team_invites` doc lifecycle. The `team_invites` container still exists for future use.

**Steps (as shipped)**

1. **Containers** (all serverless in `cdb-free`/`padel`): `tournaments` (`/groupId`), `registrations` (`/groupId`), `teams` (`/groupId`), `team_invites` (`/groupId`, unused for now), `team_slots` (`/userId`), `idempotency` (`/userId`).
2. **Admin tournament endpoints**: `POST /api/tournaments` (admin-only, creates a single active tournament per group with status `registration_open`), `GET /api/tournaments/current` (returns active tournament + caller's registration + team + counts).
3. **Registration** `POST /api/tournaments/{id}/registrations` — body `{playing, bbq}`, requires `Idempotency-Key`, upserts `${tournamentId}_${userId}` doc with denormalized `firstName`. Pinned-message refresh deferred to Phase 3.
4. **Team endpoints**: `POST /api/tournaments/{id}/teams` (body `{partnerUserId}`, requires `Idempotency-Key`, instant pairing as described above), `GET /api/tournaments/{id}/looking-for-teammate` (playing registrations without a `team_slots` entry; caller sorted first).
5. **Idempotency** (`shared/idempotency.ts`): `idem_{userId}_{key}` docs; body-hash mismatch ⇒ 422 `idempotency_conflict` (spec §22.5).
6. **Group context helpers** (`shared/requireGroup.ts`): `requireGroup` / `requireGroupAdmin` for per-group endpoints; uniform `mapGroupContextError`.
7. **SPA**: `features/tournament/TournamentScreen.tsx` — one screen that shows the active tournament, the registration toggles (Playing / BBQ), the team card (when playing), or the "looking for teammate" picker (when playing and unpaired). Admin sees a "Start a new tournament" button when no tournament is active.

**Relevant files**

- `api/src/functions/{tournamentCreate,tournamentCurrent,registrationUpsert,teamCreate,teamsLookingForTeammate}.ts`
- `api/src/shared/{idempotency,requireGroup}.ts`, extended `api/src/shared/cosmos.ts`
- `app/src/features/tournament/TournamentScreen.tsx`, i18n keys `tournament.*`, `registration.*`, `teams.*` + new error codes in all three locales.

**Verification**

1. Cosmos: registering twice with same `Idempotency-Key` only mutates once; different body ⇒ 422.
2. Same user cannot be in two active teams: second `team_slots.create()` of the same `${tournamentId}_${userId}` fails with 409 and the partial team is rolled back.
3. `requireGroupAdmin` enforces tournament create; non-admins receive 403 `not_admin`.

**Phase 3 follow-ups**

- `team_invites` container is reserved should we want to re-introduce explicit consent for pairing later.

### Team-formation hardening (shipped post-Phase 3)

Protects against misclicks while keeping the one-tap pairing UX.

- **Confirm before pairing** — Mini App prompts `Pair up with <name>?` before calling `POST .../teams`.
- **`DELETE /api/tournaments/{tournamentId}/teams/{teamId}`** (`functions/teamDisband.ts`) — disband while tournament is `registration_open`; member-only; idempotent (404 on team → 200). Returns `409 cannot_leave_team` once `live|ended`.
- **Auto-disband on un-register** — `registrationUpsert.ts` calls `shared/teams.disbandTeamForUser` when the player toggles `playing=false`; both `team_slots` + the `teams` doc are deleted so the partner returns to the looking-for-teammate list.
- **Enriched conflict payloads** — `teamCreate` 409 (`already_in_team` / `partner_already_in_team`) now includes `error.conflict = { teamId, players[] }` so the SPA can show who the player is already paired with.
- **Shared helper** `api/src/shared/teams.ts` — `disbandTeam(groupId, tournamentId, teamId)` + `disbandTeamForUser(groupId, tournamentId, userId)`.
- **New i18n keys**: `teams.confirmPair`, `teams.leave`, `teams.leaveConfirm`, `errors.cannot_leave_team`, `errors.not_a_team_member` (en/es/ru).

---

## Phase 3 — Live tournament + match results ✅ (live)

Goal: admin starts the tournament; teams set availability; players submit padel results and confirm/dispute; leaderboard updates live; pinned message reflects live state.

**Status: shipped.** Endpoints `tournamentStart`, `matchSubmit`, `matchesList`, `matchConfirm`, `matchDispute`, `availableOpponents`, `tournamentLeaderboard` deployed; SPA `LiveSection` renders opponent picker, score entry, leaderboard, and confirm/dispute controls.

**Simplifications vs original plan**

- **No team-status endpoint** (`available|resting|stopped`) — the live-section opponent picker is computed from teams that exist and haven't played the caller's team yet; an explicit pause toggle wasn't needed for MVP.
- **No live-state pinned-message rewrite** — pinned message stays as the launch-link message from `/setup`. Live state is visible in the Mini App itself.
- **Auto-confirm**: lazy reconciliation in `shared/matches.ts` runs on every leaderboard read (no Timer trigger needed on Free tier).
- **20-min repeat-pair warning**: not implemented; deferred.

**Steps**

1. **Containers**: `matches` (`/groupId`) with `_etag` concurrency.
2. **State transition** `registration_open → live` via admin endpoint; render live-phase pinned message.
3. **Team status** `POST /api/teams/{id}/status` (`available|resting|stopped`).
4. **Opponents list** `GET /api/tournaments/{id}/available-opponents` (excludes self team, ordered by least-played).
5. **Match submit** `POST /api/tournaments/{id}/matches` — requires `Idempotency-Key`; validates submitter is on one of the teams; validates casual scoring per spec §17 (one game per record, `a !== b`, both ≤ 99); warns (not blocks) if same pair played within 20 min.
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

## Phase 4 — History + overall (cross-tournament) score ✅ (live)

Goal: ending a tournament snapshots final standings; per-player `player_stats` aggregates podium points + 0.25 × wins across all ended tournaments in the group.

**Status: shipped.** Container `player_stats` (`/groupId`, id `ps_{userId}`) created; admin can end a live tournament; `tournaments.finalStandings` snapshotted; `player_stats` updated; History + Overall tabs live in the SPA.

**Steps (as shipped)**

1. **Container**: `player_stats` partitioned by `/groupId` (not `/userId` as originally proposed) so all of a group's stats live in a single logical partition for cheap aggregate reads. Doc id `ps_{userId}`.
2. **Finalize endpoint** `POST /api/tournaments/{id}/end` (admin, in `functions/tournamentEnd.ts`): runs `reconcileMatches`, computes final standings via `scoring.computeFinalStandings` (re-ranks `ranked` ++ `needsMore`), then `playerStats.applyPlayerDeltas` updates each member's doc (parallel point-reads + upserts; no transactional batch — different partitions per tournament are uncommon and the small fan-out is acceptable). Tournament doc upserted with `status='ended'`, `endedAt`, `finalStandings`.
3. **History + overall endpoints**: `GET /api/tournaments/history?limit=20` (podium-only summary, with user displayName lookup); `GET /api/groups/overall-score?limit=50` (full `player_stats` rows sorted per spec §18.6 tie-break). `GET /api/tournaments/{id}/leaderboard` returns a _frozen_ board derived from `finalStandings` when the tournament is ended (`frozen: true`).
4. **Admin recompute** `POST /api/admin/recompute-stats` — **deferred** (not yet implemented). Recovery path if drift is ever observed.
5. **SPA**: `features/history/HistoryScreen.tsx` + `OverallScreen.tsx`, wired into a tabbed view in `App.tsx` (Current / History / Overall). Tab persisted in CloudStorage.

**Relevant files**

- `api/src/functions/{tournamentEnd,tournamentHistory,overallScore,tournamentLeaderboard}.ts`
- `api/src/shared/{scoring,playerStats}.ts`
- `app/src/features/history/{HistoryScreen,OverallScreen}.tsx`

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

## Phase 5 — Polish ✅ (shipped)

Goal: ship-quality UX, admin tooling, exports, light telemetry.

**Status**

- ✅ Telegram **HapticFeedback** on create / register / start / end / pair / submit / confirm / dispute / tab-switch (`telegram.haptic.{impact,notify,selection}`).
- ✅ **BackButton** wired on non-current tabs (`hooks/useBackButton.ts`).
- ✅ **CloudStorage** persistence of last-used tab (key `lastTab`).
- ✅ **Rate limiting**: `shared/rateLimit.ts` — 30 mutating requests / 60s per user, in-memory; auto-enforced inside `requireAuth` for POST/PUT/PATCH/DELETE; HTTP 429 carries `Retry-After` header + JSON `error.retryAfterSec` (see Phase 5.5). i18n key `errors.rate_limited` in en/es/ru.
- ✅ **CloudStorage** persistence: `lastTab` (active tab) and `lastPartner_{groupId}` (recommended teammate). `lastOpponent_{tournamentId}` intentionally dropped — opponent selection is short, transient, and per-tournament; persisting it would surface stale teams across matches.
- ✅ **MainButton** integration across all primary flows: create tournament, start tournament, end tournament (admin without team), pair teammate, submit match. Conditions are mutually exclusive so only one is bound at any time.
- ✅ **Admin dashboard polish**: counts banner (teams + match status counts), `PATCH /api/matches/{id}` (admin edit + resolve dispute), `DELETE /api/matches/{id}` (admin remove), and a dedicated **Disputes admin sub-screen** (full-page overlay with BackButton) opened from the admin overview card.
- ✅ **CSV exports** `GET /api/tournaments/{id}/bbq-export`, `GET /api/tournaments/{id}/results-export` (admin-only; download buttons in Admin overview).
- ✅ **App Insights** Free-tier wiring: opt-in via `APPLICATIONINSIGHTS_CONNECTION_STRING` (`api/src/shared/telemetry.ts`); HTTP requests + exceptions only, no live metrics, cloud role `padel-api`.
- ✅ **In-app Help** (`?` button → `HelpScreen`) with 11 localised sections (intro / registration / pairing / live / matches / leaderboard / history / overall / admin / language / privacy) in en/es/ru.
- ✅ **README + ops docs**: `README.md` links to `docs/operations.md`, which covers webhook (re-)registration, secret rotation, group/admin management, App Insights enablement, CSV exports, and useful Cosmos one-liners.

**Verification**

1. UX walkthrough on a real Android + iOS Telegram client.
2. Rate-limit test: 31st POST/min returns 429 with `Retry-After`.
3. App Insights shows requests + auth-failure counter; daily ingestion stays < 30 MB at idle.

---

## Phase 5.5 — Pre-preview hardening ✅ (shipped)

Goal: close the correctness and resilience gaps surfaced by the pre-launch
code review (May 2026) so the app is safe to expose to real preview users.

**Status (shipped, commit `25f9fe9`)**

- ✅ **Opposing-team match confirmation** (`functions/matchConfirm.ts`, `shared/matches.ts`, `functions/matchSubmit.ts`): every match now persists `submittedByTeamId` at submit time; confirm requires `myTeamId !== submittedByTeamId` so the submitter's **partner** can no longer rubber-stamp their own team's result. Legacy docs without the field fall back to the old user-id check.
- ✅ **Retry-safe `Idempotency-Key`s in the SPA** (`features/tournament/TournamentScreen.tsx`): registration / pairing / leave-team / match-submit keys now use `crypto.randomUUID()` per user intent instead of `Date.now()`. Combined with the apiClient 401 retry below, retries hit the stored idempotency record instead of creating duplicate writes.
- ✅ **`player_stats` double-apply guard** (`shared/playerStats.ts`, `functions/tournamentEnd.ts`): `applyPlayerDeltas` takes `tournamentId` and writes `lastAppliedTournamentId` on each row; rows whose marker matches are skipped, so a retry after a partial `tournamentEnd` failure no longer double-counts podium points.
- ✅ **`Retry-After` HTTP header on 429** (`shared/requireGroup.ts`): `mapGroupContextError` now returns a full `HttpResponseInit` and sets the `Retry-After` header (plus `error.retryAfterSec` in the JSON body) when the rate limiter trips. All 20 endpoint handlers simplified to `return mapGroupContextError(err);`.
- ✅ **Silent JWT refresh on 401** (`apiClient.ts`, `hooks/useTelegramAuth.ts`): `setReauthHandler` lets the apiClient re-run `/api/auth/telegram` (with the remembered `lastGroupId`) on a single `401 invalid_token | missing_token`, then retries the original request once with the same headers (including `Idempotency-Key`). Deduped via an inflight promise so concurrent 401s share one re-auth. Fixes the silent dead-end users would otherwise hit after the 4h JWT TTL.
- ✅ **Outbound Telegram fetch timeout** (`shared/telegramApi.ts`): every `bot/<method>` call now wraps `fetch` in an `AbortController` with an 8s ceiling; aborted calls surface as `TelegramApiError(method, 408, "timeout")` so a hung Telegram round-trip can no longer stall a Functions invocation.

**Verification**

1. `npm run typecheck && npm run lint && npm run build` — all green.
2. Two-player team: partner can no longer confirm a match their teammate submitted (server returns 403 `cannot_confirm_own_submission`).
3. Double-tapping "Submit match" yields exactly one match doc (replay → 200 with the original record).
4. After the JWT TTL elapses, the next API call transparently re-auths and succeeds; user sees no error.
5. Triggering the rate limit returns `HTTP 429`, `Retry-After: <n>`, JSON `error.retryAfterSec === <n>`.

---

## Phase 5.6 — Casual scoring relaxation ✅ (shipped)

Goal: padel preview testers reported the strict 6/7-set and super-tiebreak
validators rejected friendly pickup scores (e.g. `9-7`, `6-5`). Relax the
scoring engine to "casual mode": one record = one game with a single score
pair, `a !== b`, both non-negative integers ≤ 99. Teams that play multiple
games against each other submit multiple records — each counts independently.

**Status (shipped)**

- ✅ **Scoring engine rewrite** (`shared/scoring.ts`): `evaluateMatch` now accepts exactly one `SetScore`, validates `Number.isInteger`, range `[0, 99]`, `a !== b`, and returns `winner`/`setsA`/`setsB`/`gamesA`/`gamesB` directly. `ScoringError` codes reduced to `invalid_set_count` and `invalid_set_score`; `invalid_super_tiebreak` and `no_winner` removed. `normalizeTiebreakRule` retained as a no-op for back-compat with stored settings.
- ✅ **Leaderboard tiebreak update** (`shared/scoring.ts` `aggregateLeaderboard`): drop `setRatio` from the comparator (it equals `winRate` under one-record-per-game). New sort key: `winRate desc → gameRatio desc → matches desc → teamId asc`. `setRatio` is still computed on each row for back-compat with the SPA.
- ✅ **Endpoints simplified** (`functions/matchSubmit.ts`, `functions/matchAdminEdit.ts`): dropped the `tiebreakRule` Cosmos read on submit/edit (saves one point-read per submit), call `evaluateMatch(sets)` with no rule argument.
- ✅ **SPA score entry** (`features/tournament/TournamentScreen.tsx` `LiveSection`): replaced 3 set rows + 6 state fields with a single `<SetScoreInput>` and `scoreA`/`scoreB` pair. Client-side guard rejects `a === b` before submitting. Admin edit prompt (`adminEditMatch`) and `DisputesScreen.editMatch` switched to a single `"a-b"` prompt.
- ✅ **i18n updated** (`app/src/i18n/locales/{en,es,ru}.json`): rewrote `errors.invalid_set_count` and `errors.invalid_set_score` copy; removed `errors.invalid_super_tiebreak` and `errors.no_winner`.
- ✅ **Docs amended**: spec §17 rewritten for casual mode; `.github/copilot-instructions.md` "Padel scoring" section updated.

**Backward compatibility**

- Legacy match docs (2–3 sets stored from before this phase) keep their `winner` / `setsA` / `setsB` / `gamesA` / `gamesB` and continue to aggregate correctly into the leaderboard.
- `groups.settings.tiebreakRule` and `tournaments.settings.tiebreakRule` are still written by `tournamentCreate` / `telegramWebhook` but are ignored at read time. No data migration required.

**Verification**

1. `npm run typecheck && npm run lint && npm run build` — all green.
2. `POST /api/tournaments/{id}/matches` with `{ sets: [{a:6,b:4}] }` → 201 with `winner=A`, `gamesA=6`, `gamesB=4`.
3. `{ sets: [{a:11,b:8}] }` → 201 (previously rejected as invalid set).
4. `{ sets: [{a:5,b:5}] }` → 400 `invalid_set_score`.
5. `{ sets: [] }` or 2+ entries → 400 `invalid_set_count`.
6. Existing legacy 2/3-set match docs still appear correctly in the leaderboard.

---

## Phase 6 — Registration / teams / lifecycle refactor ✅ (shipped)

Goal: introduce a `review` state between `registration_open` and `live` so
admins can vet the roster and lock teams before the tournament starts; give
admins first-class controls for players, teams, and first-round courts; and
let groups optionally restrict team formation to admin-only.

**Status (shipped, May 2026)**

- ✅ **State machine** (`shared/tournamentState.ts`): `draft → registration_open → review → live → ended` with a `TRANSITIONS` table and `assertCanTransition` helper. New endpoints `POST /api/tournaments/{id}/stop-registration` and `…/reopen-registration` flip between the first two states; `…/start` now requires `review` and enforces `not_all_confirmed`, `odd_player_count`, `courts_not_assigned` before promoting to `live`.
- ✅ **Per-team admin confirm** (`teams.confirmedByAdmin`): admin endpoints `POST|DELETE /api/teams/{teamId}/admin-confirm`, `POST /api/tournaments/{id}/admin/teams` (create with `confirmedByAdmin=true`), `DELETE /api/teams/{teamId}/admin-disband`. `teamDisband` (player-side) returns `409 team_locked_by_admin` once a team is confirmed; resigning still tears the team down.
- ✅ **Admin player roster controls**: `POST /api/tournaments/{id}/admin/registrations`, `DELETE /api/tournaments/{id}/admin/registrations/{userId}`, `POST /api/tournaments/{id}/admin/registrations/{userId}/unlock` (clears the `resigned` flag). `GET /api/groups/{groupId}/members?q=&tournamentId=` returns the active group roster annotated with `alreadyRegistered/isPlaying/resigned` for the admin add-player picker.
- ✅ **Resign lock** (`registrationUpsert.ts`): toggling `playing:true → false` sets `resigned=true`, `resignedAt`; re-entry is blocked with `409 registration_locked` until an admin unlocks. Confirmed-by-admin teams that contain the resigning player are still disbanded so the partner returns to the unpaired pool.
- ✅ **First-round courts**: `groups.settings.courts` seeded by `/setup` to 5 fixed entries (id `1`,`2` green; `3`,`4`,`5` blue). `PUT /api/tournaments/{id}/courts` (review-only) accepts `{ assignments: [{ courtId, teamIds[] }] }`, validates each team belongs to the tournament and is referenced at most once, and stores the result in `tournaments.settings.firstRoundCourts`.
- ✅ **`tournamentCurrent` enrichment**: admin callers now receive `registrations[]`, `teams[]`, `group.courts`; every caller receives `group.playersCanFormTeams` so the SPA can branch in one round-trip.
- ✅ **Pinned message review variant** (`shared/pinnedMessage.ts`, `shared/refreshPin.ts`): new `kind: "review"` state with `statusReview` / `confirmedLabel` / `courtsAssignedYes`/`No` strings localised in en/es/ru.
- ✅ **Frontend — `AdminTournamentScreen`** (`app/src/features/admin/AdminTournamentScreen.tsx`): Players / Teams / Courts sections plus a sticky bottom bar with **Stop registration** / **Reopen** / **Start** (with inline blocker reasons). `TournamentScreen` widens its status union, delegates to the admin screen when `isAdmin && (registration_open | review)`, shows a review banner for non-admins, surfaces the locked-by-admin badge, and prompts before a player resigns. Admin pair modal remembers the last `{a, b}` per tournament in `localStorage` (`lastAdminPair_${tournament.id}`) and pre-restores it when both are still unpaired.
- ✅ **`playersCanFormTeams` group toggle** (`groups.settings.playersCanFormTeams`, defaults to `false` on new `/setup`, also back-filled to `false` for existing groups on re-setup). When `false`, `teamCreate` returns `403 players_cannot_form_teams` and the player-side TeamSection renders an "Admin will form teams" empty-state instead of the find-partner list.
- ✅ **Tooling**: `scripts/wipe-cosmos.mjs` (`npm run wipe:cosmos`, dry-run by default; `-- --confirm` to actually delete) wipes the 12 application containers when the schema needs a clean slate.

**Bug fixes during rollout**

- **Azure Functions reserves the `admin/` path prefix.** The first cut of the 6 admin endpoints used routes like `admin/tournaments/{id}/registrations`; they silently failed to register with _"The specified route conflicts with one or more built in routes"_, so SWA returned 404 and the SPA surfaced _"Something went wrong. Try again."_ Renamed all six (`tournaments/{id}/admin/...`, `teams/{teamId}/admin-confirm`, `teams/{teamId}/admin-disband`). **Lesson learned**: never start a Functions HTTP route with `admin/` or `runtime/`.

**Verification**

1. `npm run typecheck && npm run lint && npm run build` — green.
2. End-to-end on Azure: admin can Stop registration → see review screen → add/remove/unlock players, confirm teams, assign courts, Start; start is blocked with inline reason when any guard fails.
3. With `groups.settings.playersCanFormTeams=false`, a player opening the app sees the "Admin will form teams" empty-state and `POST .../teams` is rejected with `403`.
4. App Insights confirms every renamed endpoint registers and is invoked (no remaining route-conflict traces).

**Compatibility**

- All new fields are optional with safe falsy defaults; no Cosmos wipe required for existing data.
- Existing groups created before this phase have no `groups.settings.courts` or `playersCanFormTeams` — admins must re-run `/setup` once to back-fill both. Existing `registration_open` tournaments must transition through **Stop registration** before they can be started.

---

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
