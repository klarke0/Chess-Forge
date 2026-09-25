# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Focus: V2 Only

**The user is exclusively working on v2.** All new features, bug fixes, and improvements should target the v2 interface and backend. The v1 `App.tsx` / `src/App.tsx` is legacy — do not modify it unless explicitly asked.

- **V2 frontend entry:** `src/v2/AppV2.tsx` → routes between `HomeScreen`, `TrainNowScreen`, and `InsightsTab`
- **V2 backend:** `server/routes/v2_train_now.ts`, `server/routes/v2_insights.ts`, `server/routes/progress.ts`
- **V2 live at:** `/v2` route (ngrok tunnel for mobile testing)

---

## Commands

- **Dev server:** `npm run dev` (Vite)
- **Start all services:** `./dev.sh`
- **Start tunnel (ngrok):** `./dev.sh tunnel`
- **Stop all services:** `./dev.sh stop`
- **Build (Strict):** `./dev.sh build` (Always use this before restarting for mobile testing)

## AI Agent Protocols: Mobile Testing

**CRITICAL:** When pushing changes for mobile testing via ngrok, the backend serves the `dist/` folder. You MUST run `./dev.sh build` synchronously in the foreground and verify its success `exit 0` BEFORE attempting to restart the backend. Never string build and restart commands together in the background (`npm run build && restart &`), as silent TypeScript errors will result in the old buggy bundle being served to the user.

- **Lint:** `npm run lint` (ESLint with TypeScript + React hooks rules)
- **Preview prod build:** `npm run preview`
- **Rebuild repertoire data:** `node scripts/parseJobava.cjs` (parses PGN files from `bortnyk-and-naroditsky-s-jobava-london/` into `src/data/jobava_full.json`)

---

## V2 Architecture

### Overview

Full-stack React/TypeScript app (Vite + Tailwind + Bun backend) that trains chess improvement through spaced repetition of real game mistakes. The v2 interface replaces the static repertoire driller of v1 with a personalized mistake-based training loop.

### V2 Frontend (`src/v2/`)

- **`AppV2.tsx`** — Root component, handles navigation between screens
- **`HomeScreen.tsx`** — Session summary, drill count breakdown, start button
- **`TrainNowScreen.tsx`** — Main drill loop: loads session from API, cycles through positions, records SM-2 results. States: `idle → loading → queued → drilling → explanation → teaching → complete`
- **`BlunderExplanation.tsx`** — Gemini-powered coaching card. Only fires API call when `revealed=true` or `wrongMove !== null` (skips on first-try correct). Accepts `nextLabel` prop.

### V2 Backend (`server/routes/`)

- **`v2_train_now.ts`** — Drill pool builder. Three sources scored by:
  `score = cpLossWeight * recencyWeight * repetitionWeight * phaseMultiplier / familiarityDecay`
  - Source 1: Progress table (accuracy < 0.7 OR next_review due)
  - Source 2: Blunders from `analysis_json` — uses repertoire move if FEN is in repertoire, falls back to `m.bestMove` for positions outside repertoire
  - Source 3: Deviations table (player deviations only: `notes = 'player'`)
  - Session size: 12 positions. SM-2 caps: ease_factor max 2.5, interval_days max 180.

- **`progress.ts`** — SM-2 spaced repetition recording. Initial ease factor varies by source/severity: blunders >2 pawns → 1.3, blunders 1–2 pawns → 1.8, deviations → 2.0, review → 2.5.
- **`analyze.ts`** — route adapter for `POST /api/analyze/blunder` plus the streaming `analyzePosition`. The blunder coach path itself lives in `server/services/coach*.ts`.
- **`games.ts`** — Game sync, analysis save (`saveAnalysis`), backfill deviations.

### Key Data Dependencies

- **`bestMove` in `analysis_json`**: Required for blunder-first drilling of non-repertoire positions. Games analyzed by the old browser scan (`analysis_version` NULL, depth 12) may lack it; the server analysis job (below) overwrites them in place with `bestMove` present.
- **SM-2 intervals**: Capped at ease_factor 2.5 and interval_days **30** in `server/utils/sm2.ts`. If the drill pool feels stale ("same positions every session"), check the `progress` table for rows with `next_review` far in the future or `interval_days` near the cap.

### Analysis & coach updates — clear stale outputs

When shipping changes that alter the **shape of `analysis_json`** (new fields, changed grading, new bestMove semantics) or the **coach prompt / model** (`server/routes/analyze.ts`, `server/services/ai_coach.ts`), old cached outputs will misalign with the new logic and produce hallucinations or wrong UI. Clear them as part of the rollout — never ship the code change alone.

**What is cached and how to clear it:**

| Surface | Storage | Clear it by |
|---|---|---|
| Engine analysis (per-game) | `games.analysis_json` + `analysis_version` / `analysis_depth` columns | Bump `ANALYSIS_VERSION` in `server/services/analysis_config.ts`; the server job re-analyzes every older game in place (no gap with missing analysis). `POST /api/v2/refresh-analysis` is DEPRECATED. Grades can also be re-derived without the engine (`server/utils/grading.ts`). |
| Coach explanations | `coach_cache` table, keyed by prompt version | Bump `COACH_PROMPT_VERSION` in `server/services/coach_cache.ts`; old rows stop matching. |
| Frontend bundle (PWA / browser) | Service worker / browser cache | Run `./dev.sh build` then restart backend; the new asset hashes in `dist/assets/*` force a refetch. If a screenshot shows pre-fix behavior post-deploy, suspect stale PWA before re-debugging the code. |
| SM-2 progress / drill pool | `progress` table | See "Drill pool freshness" below. |

**Checklist when changing analysis_json shape or grading:**
1. Change `server/utils/grading.ts` AND its client mirror `src/utils/grading.ts` together (a parity test fails if they drift); update `analysis_json` consumers (`v2_train_now`, insights, review UI).
2. Bump `ANALYSIS_VERSION` in `server/services/analysis_config.ts` so the job re-analyzes older games.
3. Run `./dev.sh build` and restart the backend (the job resumes ~30 s after boot).
4. Verify with `curl localhost:3001/api/v2/analysis/status` (`counts.done` climbs to `total`) and `sqlite3 server/chess_trainer.db "SELECT analysis_version, COUNT(*) FROM games GROUP BY 1;"`.

### Game analysis job (server-side)

Game analysis runs on the SERVER (native Stockfish), not in the browser: `server/services/analysis_job.ts`, routes in `server/routes/v2_analysis.ts` (`GET /api/v2/analysis/status`, `POST .../start | stop | retry-failed`). Depth 14 with a 3 s per-position cap, own low-priority engine (`nice 10`, 2 threads) that exists only while there is work, resumable, newest games first, failures marked in `games.analysis_failed`. Evaluations are cached in `position_evals` (repeated openings are free). It starts ~30 s after boot and after a sync/import adds games; `ANALYSIS_AUTOSTART=0` disables the automatic start. A browser save (`POST /api/games/:id/analysis`) never overwrites a v2 analysis.

Grading (`server/utils/grading.ts`, mirrored in `src/utils/grading.ts`): win% loss on the lichess curve; `best` = the engine's top move while the measured drop is <= 5 pp, or a loss <= 0.2 pp; `excellent` <= 2, `good` <= 5, `inaccuracy` <= 10, `mistake` <= 20, `blunder` > 20 (percentage points of win chance). `analysis_json` shape is unchanged.

**Checklist when changing the coach prompt or model:**
1. Bump `COACH_PROMPT_VERSION` in `server/services/coach_cache.ts` (cached coach cards, including verifier-rejected templates, otherwise keep serving old output).
2. `./dev.sh build` and restart backend.
3. `curl` the `/api/analyze/blunder` endpoint with a known-bad FEN to verify the new prompt is live before debugging from screenshots — screenshots can be stale PWA renders.

### Drill pool freshness — DO NOT REGRESS

The drill pool is small (~75 progress rows, 12 positions/session). Any change that lets correct positions disappear for too long will make Kevin re-drill the same handful of failures forever. Past incident: a 180-day cap left 8 rows pinned at max and 12 rows scheduled into Sept 2026, starving the pool.

**Before merging changes that touch SM-2 or the drill pool**, verify:
1. `interval_days` cap stays ≤ 30 in `server/utils/sm2.ts` (raise only if you also grow the progress pool proportionally).
2. Session size in `server/routes/v2_train_now.ts` (currently 12) is still ≤ ~20% of available drillable rows.
3. After running a session locally, run:
   ```
   sqlite3 server/chess_trainer.db "SELECT COUNT(*), SUM(CASE WHEN next_review > datetime('now') THEN 1 ELSE 0 END) AS future, SUM(CASE WHEN next_review <= datetime('now') THEN 1 ELSE 0 END) AS due, MAX(interval_days) FROM progress;"
   ```
   The "future" count should be a small fraction of total. If most rows are future-dated, the pool is starving. **Also watch `due`**: if it is most of the table (and growing), the pool is over-supplied with unreviewed rows rather than starved — the earlier `future`-only check read as "healthy" while 174 of 178 rows were due. `due` counts every row, including blunder positions outside the repertoire, so a high number is normal early on; it should trend down as sessions consume the backlog.
4. Every drill source must honor `progress.next_review` (`deferredUntil()` in `v2_train_now.ts`). Not-yet-due positions are *deferred*: they only top up a session that would otherwise be short, soonest-due first. Don't add a source that bypasses this — Sources 2 and 3 once did, and one deviation was served in every session.

**Recovery if it regresses:** `UPDATE progress SET interval_days = 30 WHERE interval_days > 30; UPDATE progress SET next_review = datetime('now') WHERE next_review > datetime('now', '+30 days');`
- **Deviations**: Only `notes = 'player'` rows are valid for drilling. Run `POST /api/v2/backfill-deviations` to populate deviations for pre-v2 games.

### Database (`server/chess_trainer.db`)

Key tables:

- `games` — imported games with `analysis_json`, `game_shape`, `pgn`
- `game_positions` — per-move FENs (`fen_before`, `fen`, `san`) indexed by `game_id`
- `positions` — repertoire move tree (FEN → san)
- `progress` — SM-2 state per FEN per repertoire (`ease_factor`, `interval_days`, `next_review`, `total_attempts`, `correct_attempts`)
- `deviations` — player/opponent deviations from repertoire
- `repertoires` — id=2 (Caro-Kann), id=3 (Jobava London)

### Key Services

- **`services/engine.ts`** — `StockfishEngine` class. `evaluateOnce(fen, depth)` returns `{cp, mate, pv, bestMove}`.
- **`services/background_analysis.ts`** — Silently analyzes unanalyzed games. Now captures `bestMove` per move.
- **`services/ai_coach.ts`** — Legacy Gemini 2.0 Flash integration. The live coach path is `server/services/coach*.ts` (Gemini 2.5 Flash with Stockfish-grounded facts, claim verifier, template fallback), served by `server/routes/analyze.ts`. API key from `VITE_GEMINI_API_KEY` in `.env.local`.
- **Stockfish required on the server** (`brew install stockfish`) — without it the coach returns 503.

---

## Path Alias

`@/` maps to `./src/` (configured in both `vite.config.ts` and `tsconfig.json`).

## Style Conventions

- Tailwind CSS utility classes with `cn()` helper (clsx + tailwind-merge) for conditional classes
- **Design tokens system** — use `forge-*` Tailwind utilities instead of hardcoded hex values or raw Tailwind palette classes. See `src/design/tokens.ts` (single source of truth) — mirrored as static CSS vars in `src/index.css` (pre-JS/FOUC fallback) and mapped to Tailwind utilities in `tailwind.config.js`. **All three must be kept in sync by hand** when adding a token — there's no codegen step.
  - Colors: `bg-forge-card` not `bg-[#0d1117]`, `text-forge-danger` not `text-rose-400`, `border-forge-border-subtle` not `border-white/5`. Common backgrounds: `bg-forge-base` (shell), `bg-forge-surface`, `bg-forge-card`, `bg-forge-elevated`, `bg-forge-board`, `bg-forge-nav`.
  - Typography: the bold/uppercase/tracked "eyebrow label" pattern is tokenized as `text-forge-label-sm` (8px), `text-forge-label` (10px, dominant), `text-forge-label-lg` (11px) — use the `EyebrowLabel` component (`src/v2/components/`) rather than a raw arbitrary size.
  - Motion: `duration-forge-fast` (150ms) / `duration-forge-base` (300ms) with `ease-forge`.
  - **Chess-semantic layer** — `grade.{best,inaccuracy,mistake,blunder}` (engine move-quality, matches the grade strings in `server/utils/analysis.ts`) and `drillSource.{blunder,deviation,review,punish}` (which pool a Train Now card came from, matches `v2_train_now.ts`). Use via `StatusChip` (`src/v2/components/`, `tone="grade-blunder"` etc.) rather than hand-picking a color per call site — this is what previously caused `deviation` and `punish` to accidentally share the same amber.
  - Known exception: `GameReviewSummary.tsx`'s `MOVE_CATEGORIES` (brilliant/great/best/mistake/miss/blunder) deliberately mimics chess.com's own move-quality palette and is not mapped onto forge tokens — mapping it would change the intentional chess.com-lookalike colors.
- **Component library** — `src/v2/components/`: `ForgeCard` (the `bg-forge-card border rounded-forge-xl` wrapper, `forgeCardClass()` export for non-`<div>` cards like buttons), `EyebrowLabel`, `StatusChip`.
- **Style guide** — dev-only route at `/v2?styleguide=true` (`src/v2/StyleGuideScreen.tsx`, wired in `src/main.tsx` alongside the existing `?v1=true` legacy-shell param). Renders the real tokens and real components — not a mockup — so keep it live when a token changes rather than letting it drift.
- **Board theming** — every `<Chessboard>` instance spreads `BOARD_THEME` (or `BOARD_THEME_MUTED` for the dashboard thumbnail) from `src/design/tokens.ts`. Do not pass raw `customDarkSquareStyle` / `customLightSquareStyle` props.
- **ESLint enforces it** — `.eslintrc.cjs` has a `no-restricted-syntax` rule (base config, all files) that flags `bg-[#...]`, `border-[#...]`, `text-[#...]`, and `bg/border/text-white/N`. A `src/v2/**`-scoped override additionally flags raw Tailwind palette classes (`text-slate-400`, `bg-indigo-600`, etc.) now that every high-frequency one has a forge-* equivalent. A handful of one-off shades with no clean token (odd opacities, the `sky-*` phase-filter color) are knowingly left unflagged. V1 legacy files are exempted via a separate `overrides` block.
- Dark theme only — near-black backgrounds, slate text, indigo accents, all tokenized under `--forge-*` CSS vars. `index.css` also has a dormant `data-theme="night"` (OLED-darker) variant that predates this system and isn't wired into any UI control — left as-is, not a live feature.
- Very large border-radius on cards — use `rounded-forge-xl` (2rem) or `rounded-forge-lg` (1.5rem) from token system
- Sounds loaded from chess.com CDN URLs
- Icons from lucide-react

---

## Active vs Legacy Inventory

V2 is the only product surface that gets new work. V1 files are preserved (still reachable via `?v1=true` for diffing/recovery) but flagged with `@legacy` headers; do not extend.

| Path | Status | Notes |
|---|---|---|
| `src/v2/**` | **ACTIVE** | V2 product surface |
| `src/components/{Layout,TrainTab,ReviewTab,LibraryTab,ChapterLibrary,CoachPanel,SettingsPanel}.tsx`, `src/components/ExplorePanel/**` | LEGACY | V1 only; preserved |
| `src/components/{GamesTab,InsightsTab,GameAnalysis}.tsx`, `src/components/MoveTickerStrip.tsx`, etc. | SHARED | Used by both V1 + V2 |
| `src/App.tsx`, `src/hooks/useTraining.ts`, `src/stores/trainingStore.ts` | LEGACY | V1 root + state. `@legacy` header in file. |
| `src/services/{api,engine,background_analysis,ai_coach,pgn_parser}.ts` | SHARED | |
| `src/stores/{repertoireStore,engineStore,backgroundStore,coachStore,settingsStore}.ts` | SHARED | |
| `src/utils/{cn,normalizeFen,san,deviations}.ts` | SHARED | |
| `src/design/tokens.ts` | ACTIVE | Single source of truth for theme |
| `server/routes/v2_*.ts`, `server/routes/{progress,games,analyze,repertoire}.ts` | ACTIVE | V2 hot path |
| `server/routes/{patterns,sessions}.ts` | LEGACY | V1 only — `@legacy` header in file |
| `server/utils/{fen,san*,dateFormat,gamePositions,analysis,response,sm2,deviations,gameShape}.ts` | ACTIVE | Shared helpers |
| `scripts/parseJobava.cjs` | ACTIVE | Reusable PGN→JSON converter |
| `scripts/archive/**` | ARCHIVED | One-off importers/migrations already run |
| `docs/plans/archive/**` | ARCHIVED | Shipped feature plans, kept for context |

## Backend conventions

- **Shared helpers (use these — don't redefine):**
  - `server/utils/fen.ts` — `normalizeFen` (4-field FEN normalization). Mirrors `src/utils/normalizeFen.ts`.
  - `server/utils/gamePositions.ts` — `batchLoadGamePositions(ids)` to avoid the per-game N+1 SELECT against `game_positions`.
  - `server/utils/analysis.ts` — `parseAnalysisJson(json, gameId?)` returns a typed `AnalysisMove[] | null`. Always use this; never `JSON.parse(game.analysis_json)` inline.
  - `server/utils/dateFormat.ts` — `SHORT_MONTHS`, `formatWeekLabel`, `formatShortDate`.
  - `server/utils/response.ts` — `ok<T>(data)` / `err(msg, status)` typed envelope. **Use in any new V2 route**; existing routes can be migrated incrementally.
- **SM-2** — call `computeSM2()` from `server/utils/sm2.ts`. Don't hand-roll the formula. The `progress` route's bool-only path already routes through `computeSM2` with a derived grade.
- **Server type-checking** — `npm run typecheck:server` runs `tsc -p server/tsconfig.json`. Wired into `./dev.sh build`. Keep it green.
- **api.ts client** — every endpoint goes through `request<T>(...)` (10-second AbortController timeout, typed body). No raw `fetch` in `src/services/api.ts` for `/api/*` routes.
