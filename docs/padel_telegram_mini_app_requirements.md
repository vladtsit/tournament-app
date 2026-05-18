# Telegram Mini App for Sunday Pádel Tournaments

## Developer Requirements and Recommended Implementation

**Version:** 2.1 (May 2026) — critical pre-implementation fixes applied
**Language:** English
**Target stack:** Telegram Bot (Bot API 10.0) + Telegram Mini App + Azure Static Web Apps (Free) + managed Azure Functions on **Node.js 22 LTS** + Azure Cosmos DB for NoSQL (Free Tier, shared-throughput database) + Vanilla React 18 (Vite, SPA)
**Primary goal:** Minimal-click, self-service tournament management inside Telegram, reusable across many groups, without flooding the group chat.
**Cost target:** ~$0/month under expected scale.

> **Node version note (May 2026):** Node.js **20 reached end-of-life on April 30, 2026**. All Functions code targets **Node 22 LTS** (EOL April 30, 2027), which is also the **last Node version supported on the Linux Consumption plan** used by SWA's managed Functions. Pinned in `api/package.json` (`"engines": { "node": ">=22 <23" }`) and in `staticwebapp.config.json` (`platform.apiRuntime: "node:22"`). When Node 22 approaches EOL, plan migration to Node 24+ on the **Flex Consumption** plan (no longer free).

---

## 1. Executive Summary

The product is a **single, multi-tenant Telegram Mini App** for informal weekly pádel tournaments. One deployment of the bot + app serves **any number of Telegram groups**; each group gets its own isolated tournaments, players, settings and history. New groups onboard themselves by adding the bot and running `/setup` — no per-group deployment.

The tournament does **not** use fixed rounds, brackets, or court reservations. Players form their own teams, find opponents themselves, use any free court physically available, play, and then record results inside the Mini App.

The Telegram group should remain clean. The group should contain only a pinned entry point message such as:

```text
🎾 Sunday Pádel

Registration is open.

Players registered: 24
Teams formed: 9
BBQ yes: 17

[Open Tournament App]
```

The Mini App handles:

- Player registration.
- BBQ attendance selection.
- Team formation.
- Finding available opponents.
- Match result entry.
- Per-tournament leaderboard.
- **Historical leaderboards and an all-time overall score per player.**
- Admin overview.
- Tournament start/end.
- Group-scoped access control.

---

## 2. Core Product Principles

### 2.1 No fixed schedule

The app should not generate rounds or enforce who plays whom.

Teams are free to:

- Play any other available team.
- Skip teams they do not want to play.
- Stop playing at any time.
- Rest and return later.
- Play repeated matches if they want.

### 2.2 No court management

The app should not claim, reserve, or assign courts.

Players physically find:

- Another team.
- A free court.
- A mutually agreed time to play.

The system only records teams, results, and standings.

### 2.3 No group chat flood

The Telegram group should not receive result messages, challenge messages, or status spam.

Use:

- One pinned message with the Mini App link.
- Optional admin-controlled summary messages.
- No result submission through regular group chat.

### 2.4 Maximum user self-service

Admin should not manually form teams or schedule matches.

Players should be able to:

- Register themselves.
- Choose BBQ participation.
- Create teams.
- Invite teammates.
- Find opponents.
- Enter results.
- Stop playing.

### 2.5 Access for group participants only

The Mini App may be technically reachable by URL, but tournament data and actions must be available only to verified members of the configured Telegram group.

Access control must be enforced by the backend.

---

## 3. Explicit Scope

### 3.1 In scope

- Telegram bot.
- Telegram Mini App.
- Azure Static Web Apps frontend.
- Azure Functions API.
- Database storage.
- Group membership verification.
- Admin setup flow.
- Player registration.
- BBQ yes/no tracking.
- Team formation.
- Team availability.
- Result submission.
- Result confirmation/dispute.
- Leaderboard.
- Admin edit/correction.
- Audit log.
- Export options.

### 3.2 Out of scope for MVP

- Court claiming or court queue.
- Fixed match rounds.
- Automatic schedule generation.
- Brackets.
- Payments.
- Rankings across seasons.
- Player skill balancing.
- Native mobile app.
- Chat-based score recording.
- Mandatory double-confirmation before counting a result.

---

## 4. User Roles

### 4.1 Group participant

A Telegram user who is currently a member of the configured Telegram group.

Can:

- Open Mini App.
- Register yes/no.
- Select BBQ yes/no.
- Create or join team.
- Change own registration before tournament starts.
- Mark team available/resting/stopped.
- Submit match result.
- Confirm or dispute result.
- View leaderboard.

### 4.2 Tournament admin

An app-level admin for a specific Telegram group.

Can:

- Configure tournament.
- Start registration.
- Start tournament.
- End tournament.
- View players, teams, BBQ count.
- Edit teams.
- Edit/delete results.
- Resolve disputes.
- Export data.
- Update pinned group message.

### 4.3 Telegram group admin

A Telegram group admin or creator.

Recommended privileges:

- Add bot to group.
- Make bot admin.
- Run `/setup`.
- Approve app admins.

Group admin and app admin may be the same person, but the app should support app-specific admins.

---

## 5. Platform Constraints and Design Decisions

### 5.1 Telegram features used (Bot API 10.0, May 2026)

The plan targets current Telegram capabilities:

- **Direct Link Mini Apps** with the modern `t.me/<bot>/<app>?startapp=...` form. The Mini App receives `chat_instance`, `chat_type`, and `start_param` in `initData`.
- **Main Mini App** profile button (Bot API 7.8+) so users can launch the app directly from the bot's profile.
- **CloudStorage** (Bot API 6.9+) for per-user client-side preferences (last group used, language).
- **`chat_member` / `my_chat_member` / `chat_join_request`** webhook updates for membership lifecycle.
- **Ed25519 third-party validation** (Bot API 9.x) optional, primary auth still uses HMAC.
- **`requestWriteAccess`** so the bot can send private DMs (admin notifications, invite links) without spamming the group.
- **Not used in MVP**: Guest Bots (10.0), Managed Bots (9.6), Telegram Stars payments, Business bots \u2014 noted as future options only.

### 5.2 Mini App launch links (preferred forms)

Use a **Direct Link Mini App** with a per-app slug, scoped by `startapp` to the group:

```text
https://t.me/<bot_username>/app?startapp=g_<groupShortId>
```

Example:

```text
https://t.me/padel_sunday_bot/app?startapp=g_a91f
```

This is preferred over `?startapp=` on the bot root because:

- It opens in the **current chat context** \u2014 `initData.chat_instance` and `chat_type` are populated, giving the backend a strong group-context signal even if `start_param` is missing.
- The Direct Link form is the documented modern path and supports `mode=compact` if half-screen is preferred.

The pinned group message uses a plain URL button to that link.

### 5.3 `startapp` is not security; `chat_instance` is not identity

Neither the `startapp` slug nor `chat_instance` is a secret. They are **context hints**. Security must come from:

1. Telegram `initData` HMAC validation server-side.
2. Server-side extraction of the Telegram user ID from the validated payload.
3. Confirming the user belongs to the requested group (see §10 for the layered strategy that does **not** assume `getChatMember` works).
4. App session token issued by the backend.

### 5.4 Telegram identity must be validated on server

The frontend must not trust `window.Telegram.WebApp.initDataUnsafe`. It must send the raw `window.Telegram.WebApp.initData` query string to the backend, which validates the HMAC-SHA256 signature with the bot token (constant key `WebAppData`).

### 5.5 `getChatMember` works, but `chat_member` updates need admin

`getChatMember(chat, user)` works for any bot that is **in the chat**, even without admin rights — it returns the user's status. The real reliability concerns are narrower:

- The bot must be a member of the chat (not just configured). If removed, every call fails.
- In supergroups with privacy mode on, the bot can still query specific users by id; the issue is the bot may not have *seen* a user post if it joined later (membership history is incomplete).
- The `chat_member` / `chat_join_request` **webhook updates** (the cheap real-time cache source) **do require the bot to be admin** and `allowed_updates` to include `chat_member`.

Consequence: the plan still does **not** rely on `getChatMember` alone — see §10 for the multi-source strategy — but `getChatMember` is a *valid first-class fallback*, not a broken path.

---

## 6. High-Level Architecture

```text
+-----------------+         +--------------------------+         +------------------------+
| Telegram client | ----->  | Azure Static Web Apps    | ----->  | Managed Azure Functions|
| (Mini App view) |         | (Vanilla React SPA, Vite)|  /api/* | (TypeScript, Node 22)  |
+-----------------+         +--------------------------+         +-----------+------------+
        |                                                                    |
        | Bot API (HTTPS)                                                    | Cosmos SDK (AAD MSI)
        v                                                                    v
+-----------------+         +-------------------------------+      +---------------------------+
| Telegram Bot    | <-----> | Webhook /api/telegram/webhook |      | Azure Cosmos DB for NoSQL |
| (single bot)    |         | (secret_token header)         |      | (Free tier: 1000 RU/s,    |
+-----------------+         +-------------------------------+      |  25 GB; partitioned by    |
                                                                   |  /groupId)                |
                                                                   +---------------------------+
                                                                                |
                                                                                v
                                                                   +---------------------------+
                                                                   | Azure Key Vault           |
                                                                   | (BOT_TOKEN, WEBHOOK_SEC)  |
                                                                   +---------------------------+
```

Key choices:

- **One** SWA Free + **one** Functions runtime (managed by SWA) + **one** Cosmos account serve all groups. Multi-tenancy is enforced by `groupId` partition keys and server-side scoping.
- Cosmos DB is the system of record. No PostgreSQL, no Azure Tables (NoSQL is needed for `etag` optimistic concurrency, transactional batch, the free-tier RU pool, and SDK partition-key tooling).
- The frontend is a **vanilla React SPA built with Vite** (no Next.js, no SSR). SWA serves the static build; runtime config comes from `/api/config`.
- Functions are invoked via SWA's `/api/*` proxy, so the SPA never needs a separate function URL or CORS.
- Webhook traffic is authenticated by Telegram's `secret_token` header (set with `setWebhook`).

## 7. Recommended Azure Implementation

### 7.1 Frontend — Vanilla React + Vite on SWA Free

- **Framework:** Vanilla React 18 (functional components + hooks). No Next.js, no SSR, no React Router server features.
- **Bundler:** Vite 5 (TypeScript, fast HMR, tiny production bundle).
- **Routing:** `react-router-dom` v6 in `HashRouter` or `BrowserRouter` (with SWA `navigationFallback` to `/index.html`).
- **State:** Local React state + `@tanstack/react-query` for server cache.
- **Telegram bridge:** `<script src="https://telegram.org/js/telegram-web-app.js"></script>` in `index.html` — **unpinned** so Bot API 10.0 features (CloudStorage, BottomButton, requestWriteAccess, requestChat) are available. Pin only if you have a regression. Typed wrapper in `src/telegram.ts`.
- **Styling:** Telegram theme CSS variables (`var(--tg-theme-bg-color)` etc.) + a tiny utility CSS layer. No heavy UI library required; consider `@telegram-apps/telegram-ui` only if it does not bloat the bundle.
- **Build output:** `dist/` deployed by SWA's GitHub Action.

### 7.2 Backend — Managed Azure Functions (TypeScript, **Node 22 LTS**)

- Functions live in `/api` and are managed by SWA (free, no separate Function App).
- **Runtime:** Node 22 LTS. Pinned via `api/package.json` `"engines": { "node": ">=22 <23" }` and `staticwebapp.config.json` `"platform": { "apiRuntime": "node:22" }`. Node 20 is end-of-life as of April 30, 2026.
- HTTP-triggered functions only for MVP. **Programming model v4** (`@azure/functions` v4).
- Singleton `CosmosClient` per host instance (created at module load, reused across invocations).
- AAD managed identity for Cosmos access where the SWA Standard tier is used; on Free tier (no managed identity for SWA), fall back to a Cosmos **resource key** stored as Key Vault reference. Document both paths in `shared/cosmos.ts`.
- All endpoints behind `requireAuth(req, { group?: 'member'|'admin' })` middleware that validates the session JWT.

### 7.3 Data store — Azure Cosmos DB for NoSQL (Free Tier)

- One Cosmos account, free tier (1000 RU/s + 25 GB free, one per subscription).
- One database `padel`.
- Containers partitioned by `/groupId` (multi-tenant isolation + cheap per-group queries).
- Optimistic concurrency via `_etag` on mutable docs (matches, teams, registrations).
- Transactional batch for atomic multi-doc updates within a single partition (e.g., accept-invite mutates invite + team in one operation).

### 7.4 Secrets — Azure Key Vault

- `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET_TOKEN`, `JWT_SIGNING_KEY` stored in Key Vault.
- SWA references them via `@Microsoft.KeyVault(...)` syntax in application settings.

---

## 8. Repository Structure

```text
padel-telegram-miniapp/
  README.md
  package.json                 # workspace root
  pnpm-workspace.yaml          # or npm workspaces
  staticwebapp.config.json
  .github/workflows/azure-static-web-apps.yml

  app/                         # Vanilla React SPA (Vite)
    index.html
    vite.config.ts
    tsconfig.json
    package.json
    src/
      main.tsx
      App.tsx
      telegram.ts              # typed WebApp wrapper
      apiClient.ts             # fetch wrapper, auto-attaches session
      routes.tsx
      hooks/
        useTelegramAuth.ts
        useCurrentTournament.ts
      features/
        auth/
        groups/                # group picker for users in multiple groups
        registration/
        teams/
        matches/
        leaderboard/
        history/               # past tournaments + overall score
        admin/
      components/
        BottomActionButton.tsx # wraps Telegram MainButton/BottomButton
        BackButton.tsx
        Page.tsx
        Loading.tsx
        ErrorState.tsx
      styles/
        theme.css

  api/                         # Managed Azure Functions (TypeScript)
    package.json
    host.json
    local.settings.json.example
    src/
      index.ts                 # function registration (v4 model)
      functions/
        config.ts              # GET /api/config
        authTelegram.ts        # POST /api/auth/telegram
        telegramWebhook.ts     # POST /api/telegram/webhook
        groupsMine.ts          # GET /api/groups/mine
        groupSetup.ts          # POST /api/groups/setup (bot-initiated)
        tournamentCurrent.ts
        tournamentHistory.ts   # GET /api/tournaments/history
        tournamentLeaderboard.ts # GET /api/tournaments/{id}/leaderboard
        registrationUpsert.ts
        teamCreate.ts
        teamInviteRespond.ts
        teamStatusSet.ts
        teamsAvailable.ts
        matchSubmit.ts         # idempotent
        matchConfirm.ts
        matchDispute.ts
        leaderboard.ts
        overallScore.ts        # GET /api/groups/{id}/overall-score
        adminTournamentStart.ts
        adminTournamentEnd.ts
        adminEditResult.ts
        adminBbqExport.ts
      shared/
        cosmos.ts              # singleton client + container handles
        telegramAuth.ts        # HMAC + Ed25519 validation
        telegramApi.ts         # sendMessage, pinChatMessage, getChatMember
        session.ts             # JWT issue/verify
        requireAuth.ts
        membership.ts          # multi-source membership resolution
        scoring.ts             # padel set-based scoring + overall score
        idempotency.ts
        audit.ts
        ids.ts                 # deterministic doc ID helpers
      tests/

  infra/                       # optional: Bicep for SWA + Cosmos + KV
    main.bicep
```

---

## 9. Telegram Bot Setup

### 9.1 Bot creation (one-time, BotFather)

```text
/newbot           → store TELEGRAM_BOT_TOKEN as a secret
/setjoingroups    → Enable                       (allow adding to groups)
/setprivacy       → Enable (the default; keep)   (privacy ON; the bot still receives /setup@bot and @-mentions)
/newapp           → interactive flow; create a Direct Link Mini App
                    ├ Title: Sunday Pádel
                    ├ Description: …
                    ├ Photo + demo GIF (optional)
                    ├ Web App URL: https://<swa-host>/
                    └ Short name: app
```

Then, in BotFather → **Bot Settings → Menu Button**, set:

- Label: `Open Tournament`
- URL: `https://t.me/<bot_username>/app`

(Equivalent API call: `setChatMenuButton` with `{ type: 'web_app', text: 'Open Tournament', web_app: { url: 'https://<swa-host>/' } }`.)

Do **not** run `/setdomain` — that is for the Telegram Login Widget, not Mini Apps.

After `/newapp`, the launch URL becomes:

```text
https://t.me/<bot_username>/app?startapp=g_<groupShortId>
```

### 9.2 Webhook registration

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<swa-host>/api/telegram/webhook",
    "secret_token": "'$WEBHOOK_SECRET_TOKEN'",
    "allowed_updates": ["message","my_chat_member","chat_member","chat_join_request","callback_query"]
  }'
```

**Secret-token constraints (Telegram):** 1–256 chars from `[A-Za-z0-9_-]`. Generate with `openssl rand -hex 32`.

The function rejects any POST whose `X-Telegram-Bot-Api-Secret-Token` header does not match (constant-time compare).

### 9.3 Group onboarding

1. Group admin adds the bot to the Telegram group.
2. Group admin **promotes the bot to admin** with: *Read Members*, *Pin Messages*, *Send Messages* (Delete Messages optional).
3. Group admin sends `/setup` in the group.
4. The bot:
   - Validates the sender is a Telegram admin of the chat (`getChatMember`).
   - Verifies it received `my_chat_member` confirming it is admin; if not, replies with the missing rights and stops.
   - Generates a 4-char `groupShortId` (collision-checked).
   - Creates the `groups/{groupId}` document.
   - Marks the `/setup` sender as the first **app admin**.
   - Posts and pins:

```text
🎾 Pádel app connected.

Open app:
https://t.me/<bot>/app?startapp=g_<short>
```

### 9.4 Lifecycle webhook handling

The `/api/telegram/webhook` handler must process:

| Update | Action |
| --- | --- |
| `my_chat_member` → bot promoted/demoted | Update `groups.botRights`, surface admin warning if rights insufficient. |
| `my_chat_member` → bot kicked | Mark group `status='inactive'`; stop scheduled work. |
| `chat_member` | Upsert `group_users/{groupId}_{userId}` with latest status & timestamp. |
| `chat_join_request` | Optional auto-approve, or record pending join. |
| `message` containing `/setup`, `/help`, `/status` | Reply with Mini App link, group state, or admin help. |
| `migrate_to_chat_id` (in `message`) | Update `groups.telegramChatId` to the new supergroup id; preserve `groupId`. |

This **proactively maintains a `group_users` cache** so reads never depend on `getChatMember` at request time.

---

## 10. Authentication and Authorization

### 10.1 Auth flow (multi-group aware)

```text
1. User opens Mini App (from group pinned link, bot profile, or deep link).
2. Frontend reads Telegram.WebApp.initData (full string) + initDataUnsafe (for chat_instance, start_param, chat_type).
3. Frontend POSTs { initData, startParam, chatInstance, chatType } → /api/auth/telegram.
4. Backend:
   a. Validates HMAC-SHA256 of initData using bot token.
   b. Optionally verifies the Ed25519 signature for third-party guarantees.
   c. Rejects if auth_date older than 5 minutes (replay protection).
   d. Upserts users/{userId} from the validated `user` payload.
   e. Resolves target group (see §10.6 Group resolution).
   f. Loads group_users/{groupId}_{userId} from Cosmos (proactively maintained by webhook).
      - If absent, attempts a one-shot getChatMember as a fallback and caches the result.
      - If still unknown, returns the group picker payload (user belongs to multiple groups or none verified).
   g. Issues a session JWT (15-min TTL) bound to {userId, groupId, isAdmin} and an opaque refresh handle.
   h. Sets the JWT as an HttpOnly, SameSite=None, Secure cookie AND returns it in the response body for clients that cannot use cookies inside the Mini App webview.
5. Frontend stores token (cookie + in-memory) and continues.
```

### 10.2 Frontend startup (Vanilla React)

```ts
// src/telegram.ts
export const tg = window.Telegram?.WebApp;

export async function bootstrapTelegramSession() {
  if (!tg) throw new Error("not-in-telegram");
  tg.ready();
  tg.expand();
  tg.enableClosingConfirmation();

  const res = await fetch("/api/auth/telegram", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      initData: tg.initData,
      startParam: tg.initDataUnsafe?.start_param ?? null,
      chatInstance: tg.initDataUnsafe?.chat_instance ?? null,
      chatType: tg.initDataUnsafe?.chat_type ?? null,
    }),
  });

  if (res.status === 409) {
    // user belongs to multiple groups; backend returns { groups: [...] }
    return { kind: "pickGroup", ...(await res.json()) };
  }
  if (!res.ok) throw new Error("auth-failed");
  return { kind: "session", ...(await res.json()) };
}
```

### 10.3 Backend `initData` validation (HMAC-SHA256)

```ts
import crypto from "node:crypto";

export function validateTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("missing-hash");
  params.delete("hash");
  // signature param (Ed25519, if present) is not part of the HMAC payload
  params.delete("signature");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const ok =
    calc.length === receivedHash.length &&
    crypto.timingSafeEqual(Buffer.from(calc, "hex"), Buffer.from(receivedHash, "hex"));
  if (!ok) throw new Error("bad-signature");

  const authDate = Number(params.get("auth_date"));
  // 24 h freshness: matches Telegram's own recommendation. Replay protection comes
  // from HMAC + bot-token secrecy + short-lived session JWT. Tighter windows (5 min)
  // break in-app refresh because `initData` only regenerates when the Mini App is
  // reopened, not while it is open.
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) throw new Error("stale-auth");

  const userJson = params.get("user");
  if (!userJson) throw new Error("missing-user");
  return { user: JSON.parse(userJson), authDate, params };
}
```

### 10.4 Optional Ed25519 third-party signature

For added defense-in-depth, also validate the `signature` query parameter using Telegram's production public key
`e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d`. Build the data-check string as `<bot_id>:WebAppData\n<sorted-key=value lines>` and verify with Node's `crypto.verify('ed25519', ...)`. This is **optional** for MVP since HMAC + bot-token secrecy is already strong, but it lets third parties verify auth without holding the bot token.

### 10.5 Multi-source group membership

For each access decision, resolve membership in this order; **stop at the first definitive answer**:

1. **Cached `group_users/{groupId}_{userId}`** populated by the `chat_member` webhook (requires bot admin + `allowed_updates` includes `chat_member`). Status: `creator|administrator|member|restricted+is_member|left|kicked`. TTL: 1 hour for active, 5 minutes for boundary statuses.
2. **First-open auto-enrollment via `chat_instance`** — if `chat_instance` from initData matches `groups.chatInstance` (recorded at `/setup`), upsert membership = `member` even before a webhook arrives. Safe because `chat_instance` is produced by Telegram for a chat the user is in.
3. **One-shot `getChatMember(chatId, userId)`** call. This is a **first-class fallback**, not a broken path — it works for any bot that is in the chat, even without admin rights. Only fails when the bot has been removed from the chat (then no membership is verifiable at all).
4. **`chat_join_request` capture** — if the group requires admin approval to join, the bot receives `chat_join_request` for every applicant; the handler can optionally auto-approve and upsert membership.
5. **Manual admin allow-list** — an app admin can add users by Telegram username as a last resort.

Membership is a Cosmos doc, not a Telegram round-trip per request.

### 10.6 Group resolution order

```text
1. validated initData → chat_instance → groups WHERE chatInstance = ?
2. start_param (g_<short>) → groups WHERE shortId = ?
3. user's known groups (group_users WHERE userId = ?, status in {creator,administrator,member}):
   - exactly one → use it
   - many → return 409 { groups: [...] } so frontend shows a group picker
   - zero → 403 with onboarding hint
```

### 10.7 Session model

- **JWT (HS256)** signed with `JWT_SIGNING_KEY` from Key Vault.
- TTL **4 hours** (covers a full Sunday tournament without re-auth). On 401, the frontend re-runs `bootstrapTelegramSession()`; this only succeeds if `initData` is still fresh, i.e. the user has reopened the Mini App. A 15-minute TTL was rejected because `initData` does **not** refresh while the app is open, causing forced re-opens mid-interaction.
- Stored as **HttpOnly `Secure; SameSite=None`** cookie scoped to the SWA host **and** returned in the JSON body. The `apiClient` **prefers the `Authorization: Bearer` header** because third-party cookies in Telegram's webview are unreliable on iOS Safari and inconsistent on Telegram Android — treat the cookie as best-effort.
- Payload: `{ sub: userId, gid: groupId, adm: boolean, iat, exp, jti }`.

### 10.8 Webhook authentication

Every request to `/api/telegram/webhook` must include `X-Telegram-Bot-Api-Secret-Token: <WEBHOOK_SECRET_TOKEN>`. Constant-time compare; reject with 401 otherwise. The secret is configured at `setWebhook` time.

---

## 11. Access Rules

### 11.1 Group participants

Can:

- View current and **past** tournaments of their group.
- View overall (cross-tournament) score.
- Register / unregister.
- Set BBQ yes/no.
- Create team, invite teammate, accept/decline invite.
- Mark own team status.
- Submit result for a match they played in.
- Confirm / dispute a result they were on the other side of.
- View leaderboards.

### 11.2 App admins (per group)

Everything above, plus:

- Open / close registration.
- Start / end tournament.
- Edit or delete any team, match, registration.
- Resolve disputes.
- Promote/demote other app admins.
- Export BBQ list, results CSV.
- Trigger pinned-message refresh.

The user who runs `/setup` is the first app admin. They can promote others. **App admin is independent of Telegram group admin** — a Telegram admin is not automatically an app admin.

### 11.3 Non-members

Receive 403 with message:

```text
This app is only available to members of this group.
```

No tournament data is returned. The webhook may surface a "Join request" link for the group, but the app itself returns nothing.

---

## 12. Cosmos DB Data Model

### 12.1 Account / database

- Account: 1, free-tier enabled, NoSQL API.
- Database: `padel`, **shared-throughput database at 1000 RU/s** with the free-tier discount applied to the database. All containers in the database share these 1000 RU/s — this is the only way to stay at $0/month with 10+ containers. Per-container dedicated throughput would cost ~400 RU/s minimum per extra container = paid.
- Free-tier rule: **one** database (or one container) per Azure **subscription** gets the discount; pick the database here.
- Optional: bump one hot container (e.g. `matches`) to its own dedicated throughput later if shared 1000 RU/s becomes a bottleneck.

### 12.2 Container layout

Most containers partition by `/groupId` for tenant isolation. **Two exceptions** are partitioned by `/userId` because their natural access pattern is user-first and they are not group-scoped.

| Container | Partition key | Document id pattern | Purpose |
| --- | --- | --- | --- |
| `groups` | `/groupId` | `g_<short>` (= `id`) | One doc per group. Each group lives in its own partition; fine at the expected scale (≤ tens of thousands of groups). |
| `users` | **`/userId`** | `u_<telegramUserId>` (= `id`) | Global user profile (Telegram identity). Cross-group; partitioned per user for O(1) reads. |
| `group_users` | `/groupId` | `{groupId}_{userId}` | Membership cache + per-group app role. |
| `tournaments` | `/groupId` | `t_{yyyymmdd}_{short}` | One per tournament. Ordered by `tournamentDate`. |
| `registrations` | `/groupId` | `r_{tournamentId}_{userId}` | One per user per tournament. Deterministic id prevents duplicates. |
| `team_slots` | `/groupId` | `ts_{tournamentId}_{userId}` | **Reservation doc** that asserts "this user is in some team in this tournament". One per user per tournament. Created atomically with the team; see §12.3. |
| `teams` | `/groupId` | `tm_{tournamentId}_{userIdA}_{userIdB}` (sorted ids) | Deterministic id: same two players in same tournament = same doc. |
| `team_invites` | `/groupId` | `ti_{tournamentId}_{inviter}_{invitee}` | One pending invite per pair per tournament. |
| `matches` | `/groupId` | `m_{tournamentId}_{ulid}` | Append-mostly. `_etag` for concurrency on edits. |
| `player_stats` | `/groupId` | `ps_{userId}` | Overall (all-time) per-player score; updated on tournament end. |
| `audit` | `/groupId` | `a_{ulid}` | Admin action log. TTL: 365 days. |
| `idempotency` | **`/userId`** | `idem_{userId}_{key}` | Idempotency keys scoped to the calling user. TTL: 24 hours. `/userId` partition supports pre-auth POSTs (where `groupId` is not yet known) and prevents key-guessing replay attacks. |

All deterministic IDs use lowercase ULIDs or short hashes; player-pair IDs sort the two `userId`s lexicographically so `tm_{t}_{a}_{b}` == `tm_{t}_{b}_{a}`.

### 12.3 Example documents

**`groups/{groupId}`**

```json
{
  "id": "g_a91f3c7e",
  "groupId": "g_a91f3c7e",
  "shortId": "a91f",
  "telegramChatId": -1001234567890,
  "telegramChatTitle": "Sunday Pádel Madrid",
  "chatInstance": "8235492756128945612",
  "timezone": "Europe/Madrid",
  "language": "en",
  "createdByUserId": "u_123",
  "botRights": { "isAdmin": true, "canPin": true, "canReadMembers": true },
  "status": "active",
  "settings": {
    "scoring": "padel_best_of_3_sets",
    "minMatchesForRanking": 3,
    "allowReplay": true,
    "bbqForNonPlaying": true,
    "pinDebounceSeconds": 60
  },
  "createdAt": "2026-05-18T12:00:00Z"
}
```

**`users/{userId}`**

```json
{
  "id": "u_123",
  "userId": "u_123",
  "telegramUserId": 123456789,
  "firstName": "Vlad",
  "lastName": "T",
  "username": "vladtsit",
  "photoUrl": "https://...",
  "languageCode": "en",
  "createdAt": "2026-05-18T12:00:00Z",
  "lastSeenAt": "2026-05-18T12:00:00Z"
}
```

**`group_users/{groupId}_{userId}`**

```json
{
  "id": "g_a91f3c7e_u_123",
  "groupId": "g_a91f3c7e",
  "userId": "u_123",
  "membershipStatus": "member",
  "membershipSource": "chat_member_webhook",
  "appRole": "admin",
  "lastCheckedAt": "2026-05-18T12:00:00Z"
}
```

**`tournaments/{tournamentId}`**

```json
{
  "id": "t_20260524_x7q2",
  "groupId": "g_a91f3c7e",
  "tournamentId": "t_20260524_x7q2",
  "title": "Sunday Pádel — 24 May",
  "tournamentDate": "2026-05-24",
  "timezone": "Europe/Madrid",
  "status": "registration_open",
  "scoringMode": "padel_best_of_3_sets",
  "minMatchesForRanking": 3,
  "createdByUserId": "u_123",
  "startedAt": null,
  "endedAt": null,
  "finalStandings": null,
  "createdAt": "2026-05-18T12:00:00Z"
}
```

**`registrations/{r_{t}_{u}}`**

```json
{
  "id": "r_t_20260524_x7q2_u_123",
  "groupId": "g_a91f3c7e",
  "tournamentId": "t_20260524_x7q2",
  "userId": "u_123",
  "isPlaying": true,
  "bbqYes": true,
  "lookingForTeammate": false,
  "updatedAt": "2026-05-18T12:00:00Z"
}
```

**`teams/{tm_{t}_{a}_{b}}`**

```json
{
  "id": "tm_t_20260524_x7q2_u_123_u_456",
  "groupId": "g_a91f3c7e",
  "tournamentId": "t_20260524_x7q2",
  "members": ["u_123", "u_456"],
  "memberKey": "u_123|u_456",
  "status": "available",
  "createdByUserId": "u_123",
  "createdAt": "2026-05-18T12:00:00Z",
  "updatedAt": "2026-05-18T12:00:00Z"
}
```

**Two-write reservation pattern for team uniqueness** (Cosmos transactional batches cannot contain queries):

1. For each of the two members, attempt `Create` on `team_slots/ts_{tournamentId}_{userId}` with body `{ groupId, tournamentId, userId, teamId }`. Cosmos enforces id-uniqueness per partition; a duplicate `id` returns **HTTP 409** → that user is already in a team for this tournament → return `error.code = 'already_in_team'` and roll back any reservation already created in this request.
2. Only after both reservations succeed, `Create` the `teams/{tm_..._a_b}` document. A duplicate team (same pair) likewise 409s on the deterministic id.
3. On team disband (delete or replace teammate), delete both `team_slots` docs and the team doc inside a **transactional batch** (single partition `/groupId`, no query needed).

This avoids stored procedures and is fully atomic from the user's perspective.

**`matches/{m_{t}_{ulid}}`**

```json
{
  "id": "m_t_20260524_x7q2_01HZ...",
  "groupId": "g_a91f3c7e",
  "tournamentId": "t_20260524_x7q2",
  "teamAId": "tm_..._u_123_u_456",
  "teamBId": "tm_..._u_789_u_012",
  "sets": [ {"a":6,"b":4}, {"a":3,"b":6}, {"a":7,"b":5} ],
  "winnerTeamId": "tm_..._u_123_u_456",
  "submittedByUserId": "u_123",
  "status": "submitted",
  "idempotencyKey": "abc-123",
  "submittedAt": "2026-05-18T13:00:00Z",
  "confirmedAt": null,
  "disputedAt": null,
  "_etag": "..."
}
```

**`player_stats/ps_{userId}`** — see §18.6.

**`audit/{a_{ulid}}`** — `{ actorUserId, action, entityType, entityId, before, after, createdAt }`.

### 12.4 Indexing policy

`include /*` with **explicit excludes** to keep write RU charges low on free tier (each indexed path ≈ 5–10 write RUs):

- `matches`: exclude `/sets/*`, `/adminNote/?`
- `tournaments`: exclude `/finalStandings/*` (snapshot read whole; never queried by inner field)
- `audit`: exclude `/before/*`, `/after/*` (blobs)
- `team_invites`, `registrations`, `team_slots`: defaults fine (small docs).

Composite indexes:

- `tournaments`: `(groupId asc, tournamentDate desc)` — history listing.
- `matches`: `(groupId asc, tournamentId asc, submittedAt desc)` — per-tournament feeds.
- `group_users`: `(groupId asc, appRole asc)` — admin listing.
- `player_stats`: `(groupId asc, overallScore desc)` — overall leaderboard.

### 12.5 TTL

- `idempotency` 86400 s.
- `audit` 31536000 s.
- All others: no TTL.

---

## 13. Tournament Lifecycle

```text
draft
  |
  v
registration_open
  |
  v
live
  |
  v
ended
  |
  v
archived
```

### 13.1 Draft

Admin creates tournament.

Visible to admin only or visible as upcoming.

### 13.2 Registration open

Players can:

- Register yes/no.
- Select BBQ yes/no.
- Create or join team.
- Change teammate.
- Cancel participation.

Admin can see counts.

### 13.3 Live

Players can:

- Mark team available/resting/stopped.
- Find opponents.
- Submit results.
- Confirm/dispute results.
- View leaderboard.

Team changes after tournament start should create a new team by default.

### 13.4 Ended

Players can:

- View final leaderboard.
- View match history.

Admins can:

- Edit final corrections.
- Export data.

### 13.5 Archived

Read-only historical tournament. **Transition:** a daily Functions Timer trigger flips tournaments from `ended` to `archived` 90 days after `endedAt`. Archived tournaments are excluded from the default history listing but accessible via `?includeArchived=true`.

---

## 14. Registration Flow

### 14.1 Entry

Player opens Mini App and sees:

```text
Sunday Pádel

Registration is open.

[Register]
```

### 14.2 Participation

No “maybe”.

```text
Are you playing?

[Yes]
[No]
```

If user selects No:

- Store registration with `is_playing = false`.
- Do not show team formation.
- Still allow BBQ selection if relevant.

### 14.3 BBQ

No “maybe”.

```text
Post-tournament BBQ?

[Yes]
[No]
```

Store as:

```text
bbq_yes = true/false
```

### 14.4 Team choice

If playing:

```text
Do you already have a teammate?

[Choose teammate]
[Looking for teammate]
[Decide later]
```

Notes:

- “Looking for teammate” is a team formation state, not a participation maybe.
- “Decide later” means user is playing but has no team yet.

### 14.5 Final registration summary

```text
You are registered.

Playing: Yes
BBQ: Yes
Team: Vlad / Alex

[Change BBQ]
[Change teammate]
[Cancel registration]
```

---

## 15. Team Formation Flow

### 15.1 Create team with teammate

Player selects teammate from registered players.

The selected teammate receives in-app pending invite:

```text
Vlad invited you to form a team.

[Accept]
[Decline]
```

Once accepted:

```text
Team confirmed:
Vlad / Alex
```

### 15.2 Looking for teammate

Player can mark themselves as looking for teammate.

Screen:

```text
Players looking for teammate

Maria
[Invite]

Sergey
[Invite]
```

### 15.3 Team constraints

- Team has exactly 2 players when complete.
- A player can be in only one active team per tournament.
- Before tournament starts, team changes are allowed.
- After tournament starts, changing teammate creates a new team by default.

### 15.4 Admin team correction

Admin can:

- Create team manually.
- Split team.
- Replace teammate.
- Delete incorrect team.
- Move player to another team.

Every admin change should write audit log.

---

## 16. Live Tournament Flow

### 16.1 Start tournament

Admin taps:

```text
[Start tournament]
```

The system:

- Sets tournament status to `live`.
- Updates pinned group message.
- Activates complete teams.
- Marks incomplete teams as requiring action.

### 16.2 Player home screen during live tournament

```text
Sunday Pádel Live

Your team:
Vlad / Alex

Status:
Available

[Find opponent]
[Enter result]
[Leaderboard]
[Rest]
[Stop playing today]
```

### 16.3 Team statuses

Allowed team statuses:

```text
forming
available
resting
stopped
deleted
```

Meaning:

- `forming`: team not complete yet.
- `available`: team is ready to play.
- `resting`: team is temporarily unavailable.
- `stopped`: team has finished for the day.
- `deleted`: admin removed invalid team.

### 16.4 Find opponent

Opponent list should sort by:

1. Available teams.
2. Teams not played yet.
3. Teams with similar number of matches played.
4. Teams waiting longer.
5. Repeated opponents last.

Screen:

```text
Available opponents

Dani / Pablo
Not played yet
[View]

Maria / Ivan
Not played yet
[View]

Leo / Max
Played once
[View]
```

No app-level challenge is required for MVP. Players can just physically agree and play.

Optional later feature:

- Lightweight challenge/request.
- No court claim.

---

## 17. Result Recording Flow

### 17.1 Submit result (padel best-of-3 sets)

The submitter enters set scores. The frontend's `BottomActionButton` is the only submit affordance.

```text
Enter result

Opponent:  Dani / Pablo

Set 1:  [-] 6 [+]   [-] 4 [+]
Set 2:  [-] 4 [+]   [-] 6 [+]
Set 3:  [-] 7 [+]   [-] 5 [+]   (optional)

[Submit result]   ← Telegram BottomButton
```

Client sends an `Idempotency-Key` header (UUID generated when the form mounts). Re-submits within 24 h are deduped server-side via the `idempotency` container.

### 17.2 Server-side rules

- Submitter must be on `teamA` or `teamB` (otherwise 403).
- **Valid padel set** (from either side's perspective): `(winner = 6, loser ∈ {0..4})` OR `(winner = 7, loser ∈ {5, 6})` OR — for the **deciding set only**, if `groups.settings.tiebreakRule = 'super_tiebreak_to_10'` — `(winner ≥ 10, winner − loser ≥ 2)`.
- `groups.settings.tiebreakRule` defaults to `'super_tiebreak_to_10'`; alternative `'full_third_set'` enforces a normal third set.
- Match winner = first team to win 2 sets. Server computes and stores `winnerTeamId`; rejects with `validation` if no team has 2 sets.
- Status starts as `submitted` and **counts immediately** in the leaderboard.
- A 30-minute auto-confirm timer (`autoConfirmAt` field, polled by a 1-min Functions Timer trigger) flips status to `confirmed` if no dispute by then.

### 17.3 Opponent confirmation / dispute

Opponent sees:

```text
Vlad / Alex   6-4 · 4-6 · 7-5   Dani / Pablo

[Confirm]   [Dispute]
```

Dispute moves the match to `disputed`; it stays visible **and continues to count** with a clear "Disputed" badge. Only an app admin can resolve.

### 17.4 Duplicate-pair warning

If the same pair recorded a match within the last 20 min, the client shows:

```text
These teams logged a match 12 min ago.
Is this a new match or do you want to edit the previous one?

[New match]   [Edit previous]
```

The group setting `allowReplay` defaults to true.

---

## 18. Scoring and Leaderboards

### 18.1 Padel-appropriate scoring (default)

Stored shape: `sets: [{a,b}, {a,b}, {a,b}?]`. Match win = took 2 sets. **Per-match points**:

```text
Win  = 3
Loss = 0
(No draws — best-of-3 has a winner)
```

### 18.2 Per-tournament ranking (live leaderboard)

Sort key:

1. **Win rate** = `wins / matches`, only counts once a team has reached `minMatchesForRanking` (default 3).
2. **Sets ratio** = `setsWon / setsLost` (avoids ties).
3. **Games ratio** = `gamesWon / gamesLost`.
4. **Head-to-head** (only between two compared teams).
5. **Matches played** (more is better, encourages activity).

Teams below `minMatchesForRanking` are shown in a "Needs more matches" section, **not** mixed into the main table.

### 18.3 Live leaderboard screen

```text
Sunday Pádel — live

1. Vlad / Alex      4 m · 3W 1L · 75% · sets 7/4
2. Maria / Ivan     5 m · 3W 2L · 60% · sets 7/6
3. Dani / Pablo     4 m · 2W 2L · 50% · sets 5/5

Needs more matches
   Leo / Max       1 m · needs 2 more
```

### 18.4 Configurable scoring (future)

`groups.settings.scoring` is a discriminator; alternative modes (`timed_games`, `single_set`) can be added without schema changes.

### 18.5 Historical leaderboards (per-tournament archive)

Every tournament that transitions to `ended` triggers `finalizeTournament()`:

1. Compute the final standings (same algorithm as live leaderboard).
2. Snapshot them into `tournaments.finalStandings`:

   ```json
   "finalStandings": [
     { "rank": 1, "teamId": "tm_...", "members": ["u_123","u_456"],
       "matches": 5, "wins": 4, "losses": 1, "setsFor": 9, "setsAgainst": 4 },
     ...
   ]
   ```

3. Apply the result to `player_stats` (see §18.6).
4. Update `tournaments.status = 'ended'`, `endedAt = now`.

Endpoints:

- `GET /api/tournaments/history?groupId=…&limit=20&cursor=…` → list past tournaments (date, title, top-3 teams summary).
- `GET /api/tournaments/{tournamentId}/leaderboard` → frozen `finalStandings` if ended, live computation otherwise.

The history screen shows a vertical list of date cards; tapping a card opens that tournament's frozen leaderboard with full match list.

### 18.6 Overall (all-time) player score

A **single number per player per group**, easy to understand, designed to reward both participation and winning.

**Formula per tournament**, applied at `finalizeTournament()`:

| Finish | Points |
| --- | --- |
| 1st place team | 10 |
| 2nd place team | 7 |
| 3rd place team | 5 |
| 4th place team | 3 |
| Participated (≥ 1 match) | 1 |

Plus a per-match bonus: `+0.25 × wins`.

Accumulated in `player_stats/ps_{userId}`:

```json
{
  "id": "ps_u_123",
  "groupId": "g_a91f3c7e",
  "userId": "u_123",
  "tournamentsPlayed": 14,
  "matchesPlayed": 62,
  "wins": 38,
  "losses": 24,
  "setsFor": 92,
  "setsAgainst": 71,
  "podiums": { "first": 3, "second": 4, "third": 2 },
  "overallScore": 142.5,
  "lastUpdatedAt": "2026-05-24T20:00:00Z"
}
```

**Overall leaderboard tie-break order**: `overallScore desc → wins desc → winRate desc → tournamentsPlayed desc`.

Endpoint: `GET /api/groups/{groupId}/overall-score?limit=50` → ranked list with avatar, first name, score, win rate, podium counts.

Recomputable: a one-off admin endpoint `POST /api/admin/groups/{groupId}/recompute-stats` reruns all ended tournaments to rebuild `player_stats` (safe because tournaments are immutable once ended).

### 18.7 Easy UX touches

- Show the user's own overall rank with a sticky highlighted row.
- Show a delta on the main screen after a tournament ends: *"+10 points (1st place!)"*.
- Cache last viewed leaderboard scope (current / history / overall) in `CloudStorage` so it reopens to the same place.

---

## 19. BBQ Tracking

### 19.1 Player choice

```text
BBQ after tournament?

[Yes]   [No]
```

No "maybe". Setting `bbqForNonPlaying` controls whether non-playing users can pick BBQ (default `true`).

### 19.2 Admin BBQ dashboard

```text
BBQ

Yes: 17    No: 8

[View yes list]   [Export CSV]
```

### 19.3 Storage & export

Stored on `registrations.bbqYes`. Export CSV fields:

```text
First name, Last name, Telegram @username, Telegram user ID, Playing (Y/N), Team, BBQ (Y/N)
```

---

## 20. Admin Dashboard

### 20.1 Registration phase

```text
Admin dashboard — Sunday Pádel

Status: Registration open

Players:
24 playing yes
8 playing no

Teams:
9 complete teams
6 players without team
2 pending team invites

BBQ:
17 yes
15 no

[Message unteamed players]
[Start tournament]
```

### 20.2 Live phase

```text
Sunday Pádel Live

Teams:
10 available
2 resting
1 stopped

Matches:
18 submitted
14 confirmed
1 disputed

BBQ:
19 yes
14 no

[End tournament]
[Edit results]
[Export]
```

### 20.3 Ended phase

```text
Tournament ended

Final leaderboard available.

[Export results]
[Export BBQ]
[Archive tournament]
```

---

## 21. Telegram Group Message Strategy

### 21.1 Registration message (pinned)

```text
🎾 Sunday Pádel

Registration is open.

Players: 24    Teams: 9    BBQ yes: 17

[Open Tournament App]
```

The inline keyboard uses a URL button to `https://t.me/<bot>/app?startapp=g_<short>`.

### 21.2 Live message (edit-in-place)

The bot **edits the same pinned message** (`editMessageText`) rather than posting a new one:

```text
🎾 Sunday Pádel — LIVE

Teams active: 10    Matches: 18

[Open Tournament App]
```

### 21.3 End message (replace pin)

```text
🏁 Sunday Pádel finished

🥇 Vlad / Alex
🥈 Maria / Ivan
🥉 Dani / Pablo

[Full results]
```

### 21.4 Debouncing

Pinned-message updates are **debounced server-side to once per minute** per group (`groups.settings.pinDebounceSeconds = 60`). Updates that arrive during the cooldown coalesce into a single render; this avoids `editMessageText` rate-limit issues during result bursts.

### 21.5 No result spam

The bot **never posts a message per result**. The only group messages are: registration-opened (one), pin-edits, end-of-tournament summary (one), and direct admin commands' replies.

---

## 22. API Design

All endpoints under `/api`. JSON in/out. Bearer-token (or cookie) auth via `requireAuth(req, { role?: 'member'|'admin' })`. Write endpoints accept `Idempotency-Key` (UUID) header where noted; the server stores the key in the `idempotency` container with the response and replays it on retry.

### 22.0 Auth

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/telegram` | Body: `{ initData, startParam?, chatInstance?, chatType? }`. Returns session JWT + group context, or `409 { groups: [...] }` for multi-group picker, or `403` if not a member. |
| `GET`  | `/api/config` | Public. Returns `{ botUsername, miniAppShortName, env }`. |

### 22.1 Groups

| Method | Path | Notes |
| --- | --- | --- |
| `GET`  | `/api/groups/mine` | Returns groups this user belongs to (`groupId`, title, last activity). Powers the picker. |
| `POST` | `/api/groups/{groupId}/select` | Re-issues session JWT bound to a different group. |
| `GET`  | `/api/groups/{groupId}` | Group metadata + settings (member-readable subset). |
| `PATCH`| `/api/groups/{groupId}/settings` | Admin only. Body: partial `settings`. |
| `GET`  | `/api/groups/{groupId}/overall-score` | Overall (cross-tournament) leaderboard. `?limit=50&cursor=`. |
| `POST` | `/api/admin/groups/{groupId}/recompute-stats` | Admin only. Recomputes `player_stats`. |

### 22.2 Tournaments

| Method | Path | Notes |
| --- | --- | --- |
| `GET`  | `/api/tournaments/current` | The active tournament (`registration_open` or `live`) for the session's group. |
| `GET`  | `/api/tournaments/history` | `?limit=20&cursor=` — past tournaments newest first. |
| `GET`  | `/api/tournaments/{tournamentId}` | Single tournament (incl. `finalStandings` if ended). |
| `GET`  | `/api/tournaments/{tournamentId}/leaderboard` | Live computation if active; frozen snapshot if ended. |
| `POST` | `/api/admin/tournaments` | Admin only. Create draft. Body: `{ title, tournamentDate, timezone }`. |
| `POST` | `/api/admin/tournaments/{tournamentId}/open` | Admin. Move `draft → registration_open`. |
| `POST` | `/api/admin/tournaments/{tournamentId}/start` | Admin. Move `registration_open → live`. |
| `POST` | `/api/admin/tournaments/{tournamentId}/end` | Admin. Move `live → ended`. Runs `finalizeTournament()`. |

### 22.3 Registrations

| Method | Path | Notes |
| --- | --- | --- |
| `PUT`  | `/api/tournaments/{tournamentId}/registration` | Body: `{ isPlaying, bbqYes, lookingForTeammate? }`. Upserts. Deterministic id ensures one per user. |
| `GET`  | `/api/tournaments/{tournamentId}/registrations` | List for admin & "looking for teammate" widget. |

### 22.4 Teams

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/tournaments/{tournamentId}/teams` | Body: `{ teammateUserId }`. Creates `forming` team and a `team_invite`. Idempotent on `(inviter, invitee, tournamentId)`. |
| `POST` | `/api/team-invites/{inviteId}/accept` | Transactional batch: invite → `accepted`, team → `available`, enforce one-active-team rule. |
| `POST` | `/api/team-invites/{inviteId}/decline` | |
| `POST` | `/api/teams/{teamId}/status` | Body: `{ status: 'available'|'resting'|'stopped' }`. ETag-checked. |
| `GET`  | `/api/tournaments/{tournamentId}/teams/available` | Sorted opponent list (see §16.4). |
| `DELETE` | `/api/admin/teams/{teamId}` | Admin. Soft-delete (status = `deleted`). |

### 22.5 Matches

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/tournaments/{tournamentId}/matches` | **Requires `Idempotency-Key`** header (UUID). Body: `{ teamAId, teamBId, sets: [{a,b},...] }`. |
| `POST` | `/api/matches/{matchId}/confirm` | Opponent only. |
| `POST` | `/api/matches/{matchId}/dispute` | Opponent only. Body: `{ reason? }`. |
| `PATCH`| `/api/admin/matches/{matchId}` | Admin. Body: partial `{ sets, status, adminNote }`. Uses `If-Match` ETag. |
| `DELETE` | `/api/admin/matches/{matchId}` | Admin. Soft-delete. |

**Idempotency replay rules** (all POSTs that accept `Idempotency-Key`):

1. Store `{ userId, key, requestHash, responseStatus, responseBody, createdAt }` in `idempotency` (partition `/userId`, id `idem_{userId}_{key}`, TTL 24 h).
2. On replay (same `userId`, same `key`): if `requestHash` matches → return cached response. If different → **422 `idempotency_conflict`** (do **not** silently overwrite — a different request body with a reused key is a client bug or attack).
3. The replay scope is **always the calling `userId`**; cross-user replay is impossible by construction.

### 22.6 Admin extras

| Method | Path | Notes |
| --- | --- | --- |
| `GET`  | `/api/admin/tournaments/{tournamentId}/bbq-export` | CSV. |
| `GET`  | `/api/admin/tournaments/{tournamentId}/results-export` | CSV. |
| `POST` | `/api/admin/groups/{groupId}/admins` | Body: `{ userId }`. Promote. |
| `DELETE` | `/api/admin/groups/{groupId}/admins/{userId}` | Demote. |
| `POST` | `/api/admin/groups/{groupId}/pin-refresh` | Force re-render & re-pin of the group message. Debounced server-side. |

### 22.7 Webhook

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/telegram/webhook` | Telegram-only. Requires `X-Telegram-Bot-Api-Secret-Token`. |

### 22.8 Response envelopes

Success:
```json
{ "ok": true, "data": { ... } }
```

Error:
```json
{ "ok": false, "error": { "code": "not_member", "message": "..." } }
```

Codes: `not_member`, `not_admin`, `bot_not_admin`, `bot_not_in_chat`, `stale_auth`, `bad_signature`, `idempotency_conflict`, `etag_conflict`, `validation`, `not_found`, `rate_limited`, `already_in_team`, `bbq_disabled_for_non_playing`.

---

## 23. Azure Static Web Apps Configuration

Example `staticwebapp.config.json`:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html"
  },
  "routes": [
    {
      "route": "/api/*",
      "allowedRoles": ["anonymous"]
    }
  ],
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
  },
  "responseOverrides": {
    "404": {
      "rewrite": "/index.html",
      "statusCode": 200
    }
  }
}
```

Note:

- Azure SWA built-in authentication is not the primary auth system here.
- Telegram auth is handled by Azure Functions.
- `/api/*` remains anonymous from Azure's perspective, but every Function must enforce Telegram auth manually.

---

## 24. Environment Variables

Backend application settings (SWA Configuration → Application settings; secrets via Key Vault references):

```text
TELEGRAM_BOT_TOKEN          = @Microsoft.KeyVault(SecretUri=...)
BOT_USERNAME                = padel_sunday_bot
MINI_APP_SHORT_NAME         = app
APP_BASE_URL                = https://<swa-host>
WEBHOOK_SECRET_TOKEN        = @Microsoft.KeyVault(SecretUri=...)
JWT_SIGNING_KEY             = @Microsoft.KeyVault(SecretUri=...)
COSMOS_ENDPOINT             = https://<acct>.documents.azure.com:443/
COSMOS_DATABASE             = padel
COSMOS_AUTH_MODE            = aad           # 'aad' (managed identity) or 'key'
COSMOS_KEY                  = @Microsoft.KeyVault(SecretUri=...)   # only if COSMOS_AUTH_MODE=key
APPLICATIONINSIGHTS_CONNECTION_STRING = ...
MEMBERSHIP_CACHE_TTL_SECONDS = 3600
PIN_DEBOUNCE_SECONDS_DEFAULT = 60
```

**Precedence:** every `groups.settings.*` field overrides the matching `*_DEFAULT` env var. Env defaults are used only at group-creation time to seed new `groups` docs; once a group exists, its stored settings win.

Frontend public (Vite env, prefix `VITE_`):

```text
VITE_APP_NAME=Sunday Pádel
```

No secrets are exposed to the frontend. `botUsername` and `miniAppShortName` are fetched at runtime from `/api/config`.

---

## 25. Error Handling

| Situation | UI message |
| --- | --- |
| Opened outside Telegram | "Please open this app from Telegram." |
| Not a group member | "This app is only available to members of this group." |
| Bot lacks admin rights | (admin-only banner) "Promote the bot to admin with *Read Members* and *Pin Messages* so it can verify members and update the pinned message." |
| User belongs to multiple groups, no `start_param` | Group picker screen. |
| Tournament invalid/ended | "This tournament is no longer active." |
| No team during live tournament | "You need a team before entering results. [Form team]" |
| Duplicate result | "These teams logged a match 12 min ago." |
| Rate limited | "Slow down — try again in a few seconds." |
| Network error | Retry button + offline-detection banner. |

All errors include an `error.code` from §22.8 so the UI can localize.

---

## 26. Security Requirements

### 26.1 Required

- Validate Telegram `initData` HMAC-SHA256 server-side; reject if `auth_date` older than 5 minutes (replay protection).
- Use timing-safe hash comparison.
- Validate the `X-Telegram-Bot-Api-Secret-Token` header on every webhook call.
- Never trust frontend-supplied user identity, group identity, or admin role.
- Never expose `TELEGRAM_BOT_TOKEN`, `JWT_SIGNING_KEY`, `WEBHOOK_SECRET_TOKEN`, or `COSMOS_KEY` to the frontend.
- Enforce per-tenant scoping: every query filters by `groupId` from the session JWT, **not** from the request body.
- Enforce app-admin role for all `/api/admin/*` endpoints.
- Enforce "submitter must be on one of the teams" for `POST /api/.../matches`.
- Require `Idempotency-Key` on match submission; replay on retry.
- Use ETag (`If-Match`) optimistic concurrency for match/team edits.
- Persist an audit log entry for every admin action (`audit` container).
- Apply per-IP and per-userId rate limits on `POST` endpoints (e.g., 30 / minute).
- Validate score shapes: integers ≥ 0, padel-valid sets, exactly one winning team.
- Use HTTPS only; HttpOnly + Secure + SameSite=None cookies.

### 26.2 Recommended

- Optional Ed25519 `signature` verification (third-party assurance).
- AAD managed identity for Cosmos (no key in app settings).
- Application Insights with sampling for telemetry; alert on auth failure spikes.
- Daily background job to refresh stale `group_users` rows.
- Lock down SWA staging slots behind Entra ID.
- CSP header restricting scripts to `self` + `https://telegram.org`.

### 26.3 GDPR (deferred)

A user-visible "Delete my data" flow is **out of scope for MVP** but tracked. When implemented, it must purge `users`, `group_users`, `registrations`, `team_invites`, anonymize match references, and emit an audit entry. (TODO: full policy in v2.1.)

---

## 27. MVP Feature List

### 27.1 Must have

- Single bot, multi-tenant: groups self-onboard with `/setup`.
- Direct Link Mini App launch (`t.me/<bot>/app?startapp=g_<short>`).
- HMAC `initData` validation + JWT session + cookie/bearer dual delivery.
- Multi-source membership (webhook cache + `getChatMember` fallback + invite-link self-attest).
- Registration yes/no, BBQ yes/no.
- Team creation, invite/accept/decline, looking-for-teammate list.
- Tournament lifecycle (draft → registration_open → live → ended).
- Team statuses (available/resting/stopped), opponent finder.
- Match submission (padel best-of-3 sets) with `Idempotency-Key`.
- Confirm/dispute, auto-confirm after 30 min.
- Live leaderboard with min-matches gate.
- **Historical leaderboards** (frozen `finalStandings` per ended tournament).
- **Overall (cross-tournament) per-player score** (`player_stats`).
- Admin dashboard, edit/delete results, BBQ export, results export.
- Pinned group message (registration → live → end), debounced.
- Audit log for all admin actions.

### 27.2 Should have

- CloudStorage caching of last group, last teammate, last opponent.
- Telegram `BottomButton` + `HapticFeedback` on every primary action.
- `requestWriteAccess` so the bot can DM users for invite/admin alerts.
- Deep-link shortcuts (`startapp=register-yes`, `enter-result`).
- Recompute-stats admin endpoint.
- Per-group settings UI (scoring, min matches, BBQ for non-playing).

### 27.3 Later

- Optional Ed25519 third-party signature.
- Multi-language UI (i18n bundles).
- Smart opponent suggestions (skill / matchup balance).
- QR code at the club.
- Push reminders via private DM.
- Telegram Stars payment for premium per-group features.
- Investigate **Managed Bots** (Bot API 9.6) if some groups need a fully-branded child bot.
- **Guest Bots** (Bot API 10.0) as a fallback for cross-group queries.
- GDPR self-service deletion flow.

---

## 28. UI Screens

### 28.1 Registration home

```text
Sunday Pádel

Registration is open.

[Register]
[Leaderboard]
```

### 28.2 Registration form

```text
Are you playing?

[Yes]
[No]

BBQ after tournament?

[Yes]
[No]
```

### 28.3 Team screen before tournament

```text
Your registration

Playing: Yes
BBQ: Yes

Team:
No team yet

[Invite teammate]
[Looking for teammate]
[Cancel registration]
```

### 28.4 Team confirmed

```text
Your team

Vlad / Alex

[Change teammate]
[Change BBQ]
```

### 28.5 Live player home

```text
Sunday Pádel Live

Team:
Vlad / Alex

Status:
Available

[Find opponent]
[Enter result]
[Leaderboard]
[Rest]
[Stop playing today]
```

### 28.6 Available opponents

```text
Available opponents

Dani / Pablo
Not played yet

Maria / Ivan
Not played yet

Leo / Max
Played once
```

### 28.7 Enter result

```text
Who did you play?

[Choose opponent]

Score

Vlad / Alex      [-] 6 [+]
Dani / Pablo     [-] 4 [+]

[Submit result]
```

### 28.8 Leaderboard

```text
Main ranking — minimum 3 matches

1. Vlad / Alex
   4 matches · 3W 1L · 2.25 pts/match · +8

2. Maria / Ivan
   5 matches · 3W 2L · 1.80 pts/match · +6

Needs more matches

Leo / Max
1 match · needs 2 more
```

### 28.9 Admin overview

```text
Admin dashboard

Status: Registration open

Players playing: 24
Players not playing: 8

Teams complete: 9
Players without team: 6

BBQ yes: 17
BBQ no: 15

[Start tournament]
```

---

## 29. Acceptance Criteria

### 29.1 Group-only access

- Given a non-member opens the Mini App link, they cannot view tournament data.
- Given a group member opens the Mini App link, they can authenticate and access the tournament.
- Given a removed group member opens the Mini App after membership cache expires, access is denied.

### 29.2 Registration

- Player can select playing yes/no.
- Player can select BBQ yes/no.
- Admin can see accurate counts.
- No maybe states exist in the registration UI or data model.

### 29.3 Team formation

- Player can invite teammate.
- Teammate can accept or decline.
- A user cannot join two active teams in one tournament.
- Admin can correct team mistakes.

### 29.4 Live tournament

- Admin can start tournament.
- Team can mark available/resting/stopped.
- Team can see available opponents.
- Users can submit result without chat messages.
- Leaderboard updates after result submission.

### 29.5 Results

- Result counts immediately.
- Opponent can confirm or dispute.
- Admin can edit/delete result.
- Duplicate warning appears for recent repeated team pair.

### 29.6 BBQ

- Admin can see BBQ yes/no counts.
- Admin can export BBQ list.
- BBQ has no maybe state.

---

## 30. Implementation Roadmap

### Phase 0 — Technical spike (1–2 days)

- Provision: SWA Free + Cosmos free-tier (NoSQL) + Key Vault, all in one resource group.
- Create bot via BotFather; create Direct Link Mini App "app".
- Vite vanilla React app deployed to SWA via GitHub Action.
- Functions v4 skeleton with `/api/config` and `/api/auth/telegram` (HMAC validation only).
- Confirm the Mini App launches from a Direct Link, receives `initData`, and a session JWT comes back.

### Phase 1 — Multi-tenant onboarding

- `/api/telegram/webhook` with `secret_token` auth.
- `/setup` flow + `groups` / `group_users` containers + `my_chat_member` / `chat_member` handlers.
- Group picker for users in multiple groups.
- Pinned message render (registration phase only) with debounce.

### Phase 2 — Registration + teams

- Containers: `tournaments`, `registrations`, `teams`, `team_invites`.
- Endpoints: tournament CRUD, registration upsert, team create/invite/accept, looking-for-teammate list.
- UI: registration screen, team formation, BBQ.

### Phase 3 — Live + results

- `matches` container with idempotency + ETag.
- Live leaderboard, opponent finder.
- Auto-confirm timer.
- Live pinned message updates.

### Phase 4 — History + overall score

- `finalizeTournament()` snapshot + `player_stats`.
- History and overall-score endpoints + UI.
- Admin recompute endpoint.

### Phase 5 — Polish

- BottomButton + Haptics on every screen.
- CloudStorage for last group / teammate / opponent.
- Admin dashboard polish, CSV exports.
- Application Insights dashboards + alerts.

### Phase 6 — Optional next

- i18n, Ed25519 signature, GDPR self-service, premium per-group settings.

---

## 31. Open Questions — Resolved for v2.0

| # | Question | Decision |
| --- | --- | --- |
| 1 | Scoring format | Padel best-of-3 sets; pluggable via `groups.settings.scoring`. |
| 2 | Min matches for ranking | 3 (configurable). |
| 3 | BBQ for non-playing users | Allowed by default (`bbqForNonPlaying = true`). |
| 4 | Teams replay each other | Allowed; show duplicate warning if within 20 min. |
| 5 | Disputed results count | Yes, immediately, with a visible "Disputed" badge. |
| 6 | App admins vs Telegram admins | Separate; first app admin = the user who ran `/setup`. |
| 7 | `getChatMember` reliability | Not the sole gate; multi-source resolution (§10.5). |
| 8 | Multi-group identity | Direct Link Mini App + `chat_instance` → `start_param` → user's known groups → picker. |
| 9 | Idempotent writes | Required on `POST /matches` via `Idempotency-Key` header. |
| 10 | GDPR | Deferred to v2.1; placeholder noted (§26.3). |
| 11 | One bot or many | One bot, multi-tenant. Managed Bots / Guest Bots noted as future options. |

Remaining genuinely open items:

- Super-tiebreak rules per group (10 points vs 7 points)? — exposed in settings, default 10.
- Should overall-score reset annually (seasons)? — track via `season` field on `player_stats`; default season = calendar year, configurable per group.

---

## 32. Official Documentation References

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram Mini Apps (Web Apps): https://core.telegram.org/bots/webapps
- Telegram Mini App `initData` validation: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
- Direct Link Mini Apps: https://core.telegram.org/bots/webapps#direct-link-mini-apps
- Azure Static Web Apps overview: https://learn.microsoft.com/azure/static-web-apps/overview
- Azure SWA + Functions API: https://learn.microsoft.com/azure/static-web-apps/apis-functions
- Azure SWA configuration: https://learn.microsoft.com/azure/static-web-apps/configuration
- Azure SWA application settings + Key Vault refs: https://learn.microsoft.com/azure/static-web-apps/application-settings
- Azure Cosmos DB for NoSQL: https://learn.microsoft.com/azure/cosmos-db/nosql/
- Cosmos DB Free Tier: https://learn.microsoft.com/azure/cosmos-db/free-tier
- Cosmos DB partitioning best practices: https://learn.microsoft.com/azure/cosmos-db/partitioning-overview
- Cosmos DB optimistic concurrency (ETag): https://learn.microsoft.com/azure/cosmos-db/nosql/database-transactions-optimistic-concurrency
- Cosmos DB transactional batch (Node SDK): https://learn.microsoft.com/azure/cosmos-db/nosql/transactional-batch
- Cosmos DB Well-Architected guidance: https://learn.microsoft.com/azure/well-architected/service-guides/cosmos-db
- Azure Functions Node.js v4 programming model: https://learn.microsoft.com/azure/azure-functions/functions-reference-node
- Azure Functions managed identity: https://learn.microsoft.com/azure/app-service/overview-managed-identity

---

## 33. Recommended Final Design (one-paragraph summary)

A **single multi-tenant Telegram bot** + a **vanilla React (Vite) SPA on Azure Static Web Apps Free** + **managed Azure Functions** + **Cosmos DB for NoSQL on the free tier**, with every container partitioned by `/groupId`. Groups self-onboard by adding the bot and running `/setup`; users open the Mini App via a **Direct Link** (`t.me/<bot>/app?startapp=g_<short>`); auth is HMAC-validated `initData` issuing a 15-minute JWT; membership is resolved from a **webhook-maintained `group_users` cache** so the app never depends on `getChatMember` at request time. Matches are stored as best-of-3 padel sets with idempotent writes and ETag concurrency. Every ended tournament is **snapshotted** into `tournaments.finalStandings` (historical leaderboards) and rolled into a per-player `player_stats` doc (**overall cross-tournament score**). The group chat receives only one pinned message that the bot edits in place. Total expected cost at the target scale: **≈ $0/month** (within SWA Free + Functions free grant + Cosmos free tier).

The system optimizes for:

- **Zero group spam.**
- **No fixed schedule, no court management.**
- **Maximum player self-service**, minimum taps (BottomButton + Haptics + remembered last choices via CloudStorage).
- **Admin visibility** into players, teams, BBQ, disputes, and history.
- **Secure, per-group isolated access.**
- **Free-tier sustainability** and easy growth to many groups without re-deployment.
