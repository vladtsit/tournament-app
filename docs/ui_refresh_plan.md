# UI/UX Refresh Plan

Modern, colorful, bigger, attractive, convenient, self-describing, simple — without
breaking Telegram-native feel. Introduce a small design-token CSS layer + accent
padel palette, extract typed UI primitives, add `lucide-react` icons, then refresh
every screen on top of the primitives. Inline `style={}` stays allowed for layout
glue; visual styling moves to tokens/classes so we get `:hover`, `:focus-visible`,
transitions, and responsive media queries.

## Decisions (locked)

- **Scope**: Visual refresh (not light polish, not full nav overhaul).
- **Brand**: TG vars + subtle padel accent — keep `--tg-theme-*` for chrome,
  layer custom palette for status, podium, accents, focus.
- **Styling**: Tiny CSS layer + tokens — one `app/src/styles/tokens.css` plus
  per-primitive `.module.css`. Inline styles permitted for one-off layout.
- **Primitives**: Full set in `app/src/ui/` — typed, themed, used app-wide.
- **Icons**: `lucide-react` (~1 KB per icon, tree-shaken).

## Design tokens

Defined as CSS custom properties on `:root`, overridable via
`[data-tg-color-scheme="dark"]` and TG theme vars. Primitives consume tokens — never
raw hex.

- **Color**: `--surface`, `--surface-2`, `--text`, `--text-muted`, `--text-on-accent`,
  `--border`, `--border-strong`, `--accent`, `--accent-hover`; padel palette
  `--padel-green #16a34a`, `--padel-yellow #facc15`, `--padel-clay #ea580c`;
  podium `--podium-gold #eab308`, `--podium-silver #94a3b8`,
  `--podium-bronze #b45309`; `--success`, `--warning`, `--danger`, `--focus-ring`.
- **Spacing** (4 px base): `--space-1..7` = 4 / 8 / 12 / 16 / 24 / 32 / 48.
- **Radius**: `--radius-sm` 8, `--radius-md` 12, `--radius-lg` 16, `--radius-pill` 999.
- **Type**: 12 / 14 / 16 / 18 / 22 / 28; line-heights 1.3 / 1.5; weights 400/500/600/700.
- **Shadow**: `--shadow-card`, `--shadow-sticky`.
- **Motion**: `--ease-out: cubic-bezier(.22,1,.36,1)`, `--dur-fast` 120 ms,
  `--dur-med` 220 ms. Honor `prefers-reduced-motion`.
- **Touch**: `--tap-min: 44px`.

## Phases

### Phase 0 — Foundation

1. Add `lucide-react` to `app/package.json`.
2. Create `app/src/styles/tokens.css` (tokens + reset + dark mode + focus-visible).
3. Import once from `app/src/main.tsx`.
4. Propagate `Telegram.WebApp.colorScheme` → `document.documentElement.dataset.tgColorScheme`
   in `app/src/telegram.ts`; subscribe to `themeChanged`.
5. Smoke build.

### Phase 1 — UI primitives (`app/src/ui/`)

Each primitive in its own file + co-located `.module.css`, exported from
`app/src/ui/index.ts`:

`Button` (variants primary/secondary/ghost/danger, sizes sm/md/lg, icon slots,
loading, fullWidth), `IconButton`, `Card` (flat/elevated), `Badge` (info/success/
warning/danger/neutral), `Stack` & `Inline`, `SectionTitle`, `ListRow` (selected,
interactive), `ToggleChip`, `ScoreInput` (steppers, big numerals), `EmptyState`,
`Spinner`, `Modal` (focus trap, ESC), `LanguagePicker`, `Skeleton`.

### Phase 2 — Shell refresh (`App.tsx`)

- Sticky top bar: title + `LanguagePicker` + `IconButton(HelpCircle)`.
- Tabs become a segmented control with lucide icons
  (`Trophy` / `History` / `BarChart3`); ≥ 44 px tap targets.
- Replace "…" loading text with `Spinner`.
- Help opens in the new `Modal`.

### Phase 3 — TournamentScreen refresh (6 slices)

- **3a Hero status header**: tournament name (`--font-xl`), status `Badge`,
  icon-led count metrics (`Users`/`Flame`), `IconButton(RefreshCw)` that spins
  while `silentReload` is in flight.
- **3b Registration** as `ToggleChip` row (Playing / BBQ).
- **3c TeamSection**: partner `ListRow`s with avatar initials circle, `Star` for
  last partner, `Check` when selected, `EmptyState` when no partners.
- **3d Match entry**: opponent picker as scroll `Chip` row, `ScoreInput` per set,
  pre-submit summary line with validation hint.
- **3e Match list & leaderboard** as `ListRow`s with state `Badge`s and podium
  tints for top 3.
- **3f Admin overview**: 2×2 metrics grid + action row (Export BBQ/Results,
  Open Disputes with count badge).

### Phase 4 — History & Overall refresh

- HistoryScreen: cards with podium ribbon, avatars, W-L badge, date badge.
- OverallScreen: `<table>` → row cards with rank chip, avatar, big score, podium
  counts, accent border for current user.

### Phase 5 — Disputes & Help refresh

- DisputesScreen wrapped in `Modal`; `Intl.DateTimeFormat(currentLocale, …)`.
- HelpScreen wrapped in `Modal` with accordion sections + lead icons.

### Phase 6 — Polish & a11y

- focus-visible rings, 44 px tap targets, contrast ≥ 4.5:1 light & dark, subtle
  transitions honoring reduced-motion, new i18n keys (en/es/ru), drop dead style
  constants.

### Phase 7 — Verification

`npm run typecheck && lint && build`; manual smoke in browser; Telegram iOS +
Android (light + dark); Lighthouse a11y ≥ 95; bundle delta < +30 KB gzip.

## Files touched

- **New**: `app/src/styles/tokens.css`, `app/src/ui/*.{tsx,module.css}`,
  `app/src/ui/index.ts`.
- **Modified**: [app/src/main.tsx](../app/src/main.tsx),
  [app/src/telegram.ts](../app/src/telegram.ts),
  [app/src/App.tsx](../app/src/App.tsx),
  [app/src/features/tournament/TournamentScreen.tsx](../app/src/features/tournament/TournamentScreen.tsx),
  [app/src/features/history/HistoryScreen.tsx](../app/src/features/history/HistoryScreen.tsx),
  [app/src/features/history/OverallScreen.tsx](../app/src/features/history/OverallScreen.tsx),
  [app/src/features/admin/DisputesScreen.tsx](../app/src/features/admin/DisputesScreen.tsx),
  [app/src/features/help/HelpScreen.tsx](../app/src/features/help/HelpScreen.tsx),
  [app/src/features/groups/GroupPicker.tsx](../app/src/features/groups/GroupPicker.tsx),
  [app/src/i18n/locales/en.json](../app/src/i18n/locales/en.json) +
  [es.json](../app/src/i18n/locales/es.json) +
  [ru.json](../app/src/i18n/locales/ru.json).

## Scope boundaries

**In**: tokens, primitives, icons, dark-mode parity, motion, a11y, empty/loading
polish.

**Out**: nav restructure, framer-motion or any animation lib, Tailwind/CSS-in-JS
migration, theme-customization UI, new features, any `api/**` or spec edits.

## Risks

- MainButton choreography is delicate (recent bugs) — Phase 3 keeps current wiring
  untouched; primitives only replace the non-Telegram fallback buttons.
- TG theme inheritance — tokens always fall back to `--tg-theme-*`; no hardcoded
  chrome colors.
- Bundle size — per-icon imports only; verify in build output.
