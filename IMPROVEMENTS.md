# Chess Forge — Improvement Backlog

> **Session protocol:** Read this file first. Pick the top `🔴 Ready` item. Implement it. Test it. Update this file. Commit. Repeat.
>
> **This file is the thread.** Every improvement session updates it. Never start without reading it.

---

## Vision

A mobile-first chess training app Kevin can pick up at any moment and get genuine improvement value from. Two repertoires only: **Caro-Kann (Black)** and **Jobava London (White)**. Training is driven by real game mistakes and spaced repetition — not abstract puzzles. The experience should feel like a finished, polished product: clean board, no glitches, confident UX. It should reliably show Kevin positions he actually got wrong, teach him the right move, and remember whether he learned it.

**The test:** After a week of daily sessions, Kevin's opening accuracy in those two repertoires measurably improves.

---

## Current State (as of 2026-04-24)

- **V2 is live** at port 3001 (SPA mode, served by Bun backend)
- **562 games** imported from Chess.com, **497 analyzed**
- **97 games** have `bestMove` in analysis (rest are pre-March 2026, need backfill)
- **5,381 repertoire positions** across Caro-Kann (id=2) and Jobava London (id=3)
- **55 SM-2 progress rows**, 40 due now
- **579 deviation rows** in DB
- Drill pool sources: blunders (>1 pawn loss), deviations, SM-2 review
- Session size: 12 positions
- Teaching mode: up to 2 first-encounter coach animations per session
- Backend: Bun + SQLite on :3001
- Frontend: React/Vite/Tailwind, mobile-first, dark theme with forge-* design tokens

### Known Active Bugs
- [x] **`bestMove` missing** on 400 older games — 2026-05-05. "Refresh analysis" button on HomeScreen (exists since P0-1). Backend: `POST /api/v2/refresh-analysis`. Already shipped; bug entry just needed marking.
- [x] **Drill pool shows fewer than 12** — 2026-05-05. Added emergency pad in `v2_train_now.ts`: if session < 12 after normal fill, queries SM-2 progress rows ordered by due-or-overdue first then least-recently-reviewed, ignoring next_review gate, to guarantee 12 positions.
- [x] **Board rendering edge cases** — 2026-05-05. Audited all exit paths from teaching/explanation states — `clearCoach()` is called explicitly in `handleNext()`, `handleTeachingGotIt()`, and both BlunderExplanation `onClose` callbacks. The `useEffect` already calls `clearCoach()` on every `drilling`/`queued`/`idle`/`complete` state entry as a safety net. Added clarifying comment to make the invariant explicit.

---

## Codebase Health Pass — ✅ Shipped 2026-05-01

Six-phase audit + cleanup. UI behavior unchanged; quality up. Details in memory `codebase_health_pass_2026_05.md`.

- **Phase 1 (stop the bleeding):** broken CSS vars fixed (BottomNav, AppV2, TrainNowScreen, RepertoireRunScreen); N+1 on `game_positions` eliminated via `server/utils/gamePositions.ts`; BlunderExplanation Challenge borrows shared `engineStore` engine.
- **Phase 2 (design system):** `BOARD_THEME` constants in tokens; full forge-* sweep across V2 hot files; ESLint rule blocking arbitrary color literals (V1 exempt).
- **Phase 3 (server type-check):** `npm run typecheck:server` chained into build; `no-explicit-any` → warn; 5 latent errors fixed.
- **Phase 4 (dedup):** `server/utils/{fen,dateFormat,analysis}.ts` + `src/utils/san.ts`; replaced 5×normalizeFen, 3×looseSan, 2×SHORT_MONTHS, 5× inline `JSON.parse(analysis_json)`.
- **Phase 5 (architecture):** typed response envelope `server/utils/response.ts`; api.ts raw-fetch migrations; typed `fetchTrainNowSession`; legacy SM-2 branch routes through `computeSM2`.
- **Phase 6 (hygiene):** 17 one-off scripts → `scripts/archive/`; 15 shipped plans → `docs/plans/archive/`; `@legacy` headers on V1 entry points; Active-vs-Legacy table + Backend Conventions added to CLAUDE.md.

### Follow-up shipped same day
- [x] `useDrillSession` state-machine extraction from `TrainNowScreen.tsx` (11 session-state useStates → single useReducer). New `src/v2/useDrillSession.ts` owns the state machine with atomic transitions; `TrainNowScreen` keeps timer + UI-input state local. **Needs on-device verification** before claiming victory — build passes but behavior must match original.

---

## Improvement Queue

Priority order: 🔴 Ready to build → 🟡 Needs design decision → ⚪ Future

---

### 🔴 P0 — Reliability & Core Loop

These block the app from being genuinely useful. Fix first.

#### ~~P0-1: Backfill `bestMove` for existing games — trigger from UI~~ ✅ DONE 2026-04-24
**Why:** 400 analyzed games have no `bestMove`. Drill pool is thin without it. Background analysis already captures it for new games; old games need re-analysis.
**What:** Add a "Refresh Analysis" button on the HomeScreen (or Settings). Calls a backend endpoint that clears `analysis_json` for the last N games (e.g. 200 most recent) and lets `BackgroundAnalysisQueue` re-analyze them. Show progress indicator. Notify when done.
**Files:** `server/routes/games.ts` (new endpoint), `src/v2/HomeScreen.tsx`

#### ~~P0-2: Fix session size — always deliver 12 positions~~ ✅ DONE 2026-04-24
**Why:** Session sometimes shows < 12. Likely a `correctSan` filter or `firstEncounter` state bug.
**What:** Add logging/tracing to `v2_train_now.ts` to understand what's being filtered out. Fix root cause. Add a fallback: if < 12 valid positions, pad with SM-2 review items regardless of `next_review` date.
**Files:** `server/routes/v2_train_now.ts`, `src/v2/TrainNowScreen.tsx`

#### ~~P0-3: Verify board state integrity after coach animation~~ ✅ DONE 2026-04-24
**Why:** `useCoachBoard` animates pieces through multiple FEN states. If a position is dismissed or the user taps "Next" mid-animation, the board can be left in a stale FEN.
**What:** Audit `TrainNowScreen` — ensure `clearCoach()` is called on every state transition that exits a position. Add a safety reset: on entry to `drilling` state, always set board FEN from `currentPosition.fen`.
**Files:** `src/v2/TrainNowScreen.tsx`, `src/v2/useCoachBoard.ts`

---

### 🔴 P1 — Training Quality

#### ~~P1-1: Opening Explorer integration on explanation screen~~ ✅ DONE 2026-04-24
**Why:** When Kevin sees a blunder or deviation, showing "in master games, 78% play Nd5 here" makes the lesson stick. Infrastructure exists (`useLichessMasters` hook, `explorer.lichess.ovh`).
**What:** Add a compact masters-stats widget to `BlunderExplanation` — top 3 moves, frequency bars, W/D/L. Fetch on mount when `fen` is available. Lightweight, no extra API cost.
**Files:** `src/v2/BlunderExplanation.tsx`, `src/hooks/useLichessMasters.ts`

#### ~~P1-2: Repertoire drill mode (pure opening practice)~~ ✅ DONE 2026-04-24
**Why:** Sometimes Kevin wants to just run through the Caro-Kann or Jobava from move 1, not just drill mistakes. Pure rehearsal of the full tree — answers with the repertoire move, opponent plays the main line response.
**What:** New session type selectable from HomeScreen: "Repertoire Run". Starts from starting position, Kevin plays his move, app responds with the mainline opponent move, Kevin continues. On wrong move: show correct move, continue. Track accuracy. End when Kevin reaches a leaf node or after N moves.
**Files:** New `src/v2/RepertoireRunScreen.tsx`, `server/routes/v2_repertoire_run.ts`, updates to `AppV2.tsx`

#### ~~P1-3: Session summary screen with real stats~~ ✅ DONE 2026-04-24
**Why:** The complete screen currently shows raw counts. Kevin should see: positions seen, accuracy %, time spent, which positions he missed (with FEN thumbnails), streak update. Makes sessions feel meaningful.
**What:** Redesign the complete screen in `TrainNowScreen`. Show missed positions list (tap to review). Show streak. Show a grade (S/A/B/C based on accuracy).
**Files:** `src/v2/TrainNowScreen.tsx`

---

### 🔴 P2 — GUI Polish

#### ~~P2-1: Board sizing is inconsistent on iPhone~~ ✅ DONE 2026-04-24
**Why:** Board sometimes renders too small or clips on certain iPhone screen sizes. The `max-w-[430px]` container works on desktop but mobile Safari has safe areas and dynamic toolbar that affect available height.
**What:** Audit board sizing across `TrainNowScreen`, `BlunderExplanation`. Use `dvh` (dynamic viewport height) instead of `vh` where needed. Test at 375px (iPhone SE) and 390px (iPhone 14).
**Files:** `src/v2/TrainNowScreen.tsx`, `src/index.css`

#### ~~P2-2: Loading states feel janky~~ ✅ DONE 2026-04-24
**Why:** Transitions between drill states (loading → queued → drilling) have no smooth animation. The board just snaps.
**What:** Add subtle fade or slide transition between states. The queued → drilling transition especially needs a "position is appearing" feel. CSS transitions on the board container.
**Files:** `src/v2/TrainNowScreen.tsx`, `src/index.css`

#### ~~P2-3: HomeScreen feels sparse~~ ✅ DONE 2026-04-24
**Why:** The home screen has a train button and counts but little else to motivate opening the app. Should feel like a dashboard.
**What:** Add: last session date + grade, current streak prominently, a "your weakest position" preview card (the FEN thumbnail of the highest-scored un-drilled position), and a visual representation of the two repertoires (Caro-Kann / Jobava London) with position counts.
**Files:** `src/v2/HomeScreen.tsx`, possibly new API endpoint for "weakest position preview"

---

### 🟡 P3 — Features (needs design decision before building)

#### ~~P3-1: Pattern clustering in sessions~~ ✅ DONE 2026-05-05
Woodpecker Method — group positions by theme (back rank, overloaded piece, etc.) rather than random order. Requires either Gemini classification or heuristic approach. **Decision made:** Heuristic classifier (chess.js only, no Gemini).
**Shipped:** `classifyPattern()` in `v2_train_now.ts` detects 8 tactical patterns (back-rank, fork, pin, discovered-attack, promotion, endgame, opening, middlegame) at session-build time using chess.js board analysis. `pattern` field added to `TrainPosition` type throughout. Session ordering now sorts within each source group by pattern so similar themes are adjacent. `PatternBadge` component shows colour-coded theme chips in the queued screen (cluster preview) and in the coach hint during drilling.

#### P3-2: Lichess game import
Kevin may play on Lichess. Should be importable. **Decision needed:** Does Kevin actually use Lichess?

#### ~~P3-3: Opponent punishment lines~~ ✅ DONE 2026-05-05
When Kevin deviates, show what the opponent *should* have played as punishment. Already in v1 as "Play Demo". **Decision needed:** Should this be automatic after each deviation drill?
**Shipped:** In the `explanation` state for deviation drills (`source === 'deviation'`), a dismissible amber "Opponent could punish" banner appears below the BlunderExplanation card. The banner computes the post-deviation FEN (position after Kevin's deviation `san`), asks Stockfish at depth 12 for the best opponent reply, shows the move in SAN notation with a "Show" button that triggers `triggerCoachLine` to animate the punishment move on the board in purple. Replay button shows after first animation. Banner is dismissible with X. Falls back gracefully if engine is unavailable or `san` is missing.

#### ~~P3-4: Daily challenge / streak goal~~ ✅ DONE 2026-05-05
A defined daily target (e.g. "do 1 session") with streak tracking. Already has streak in HomeScreen. **Decision needed:** Should there be a notification/reminder?
**Shipped:** `DailyChallenge` card on HomeScreen between the Train card and phase filter. Shows circle → checkmark when goal is done today, flame icon + count for the streak. Backend `getProgressStats` now computes a true consecutive-day streak (walks backward from today, breaks on gap) and returns `dailyGoalDone`. No push notifications — inline UI only.

---

### ⚪ Future (not yet prioritized)

- ~~Full insights dashboard (time management, game shape, opening stats by repertoire)~~ ✅ DONE 2026-05-05 — Time-of-day accuracy panel + Opening accuracy by repertoire panel added to InsightsTab. Backend: `GET /api/v2/insights/dashboard` returns both datasets. Pure CSS/Tailwind bars, forge-* tokens, no chart library.
- ~~Performance over time charts~~ ✅ DONE 2026-05-05 — Weekly SM-2 drill accuracy trend chart added to InsightsTab. Backend: `GET /api/v2/insights/weekly-accuracy` returns last 8 ISO-weeks of accuracy from the progress table. Frontend: `WeeklyAccuracyPanel` with pure CSS bars, forge-* tokens, trend comparison (last 4w vs prior 4w), colour-coded bars (green ≥80%, amber ≥60%, red below). No chart library.
- ~~Lichess Masters integration in Gemini coach prompts~~ ✅ DONE 2026-05-10 — `explainBlunder` now fetches Lichess Masters data server-side (4s timeout) before calling Gemini. Top-3 master moves with W/D/L% injected into both the prose prompt and the structured steps prompt. Skipped when <5 master games exist for the position.
- ~~Opening tree visualization~~ ✅ DONE 2026-05-05 — `OpeningTreePanel` added to InsightsTab. Two collapsible repertoire cards (Caro-Kann, Jobava London), each loads positions + progress on mount and builds a depth-8 move tree. Nodes color-coded: green ≥80%, amber 50–79%, red <50%, gray = undrilled. Mastery summary bar in the header shows green/amber/red distribution at a glance. Mobile-first: collapsed by default, tap to expand branches. Uses forge-* tokens, no chart library.
- Settings screen for repertoire management (add/remove PGN)
- ~~Opponent model~~ ✅ DONE 2026-05-10 — `GET /api/v2/insights/top-opponents` queries deviations+games tables, groups by opponent name, returns top 5 by deviation count with per-opponent win/draw/loss context. `OpponentModelPanel` added to InsightsTab showing ranked bars with W%/D%/L% breakdown. Uses forge-* tokens throughout.

---

## Completed (this backlog's scope)

*Items move here when merged and verified working on device.*

- [x] Coach board animation (`useCoachBoard.ts`) — wrong→correct reveal sequence
- [x] Teaching mode — first-encounter positions get a coach reveal before drilling
- [x] Drill-from-games-tab — `onDrillDeviation(fen)` wired in `AppV2.tsx`
- [x] Occurrence-weighted scoring — repeat blunders score higher
- [x] Smooth exponential recency decay (replaced step function)
- [x] Dismissed positions table + endpoint + filter in drill pool
- [x] N+1 DB query fix — batch game_positions load
- [x] Non-repertoire blunders included via engine bestMove (≥2 pawns)
- [x] `dev.sh` stop no longer kills Furu's Vite process (PID-file approach)
- [x] Menubar controller updated — Furu and Chess Forge run independently

---

## Design Principles (don't violate these)

1. **Mobile-first** — everything must work on iPhone with one thumb
2. **Forge design tokens** — use `forge-*` utilities, never hardcoded hex
3. **Dark theme** — near-black backgrounds, slate text, indigo accents
4. **No modal hell** — prefer inline state changes over popups
5. **SM-2 is sacred** — never bypass spaced repetition scheduling
6. **V1 is frozen** — do not touch `src/App.tsx` or v1 components unless asked
