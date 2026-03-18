# Chess Trainer Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the navigation shell into a focused 3-tab app (Train / Games / Library) and fix all critical backend bugs, while keeping all working hooks/stores/services intact.

**Architecture:** Option B — new shell, keep the logic. All hooks, stores, services are untouched (minor cleanup only). The component layer is rewritten under a coherent 3-tab structure. Backend schema is corrected so the games database works.

**Tech Stack:** React 18 / TypeScript / Tailwind CSS / Zustand / Bun + SQLite / chess.js / react-chessboard / Lucide React

---

## Phase 1 — Critical Backend Fixes

### Task 1: Fix Games DB Schema

**Files:** `server/db.ts`

**Problem:** The `games` table uses wrong column names (`source`, `source_id`, `white`, `black`, `played_at`) but `games.ts` writes to `uuid`, `white_username`, `black_username`, `user_color`, `opening_class`, `date`. The `game_positions` table doesn't exist. Result: the entire games database is broken.

**Step 1: Read `server/db.ts` to understand current migration structure**

**Step 2: In `runMigrations`, add a schema check before the games tables**

Before the `for (const sql of statements)` loop, add:
- Use `db.query("PRAGMA table_info(games)").all()` to get column names
- If the result does not include a column named `uuid`, drop `deviations`, `game_positions`, and `games` tables

Then replace the existing `games` and `deviations` CREATE TABLE statements with:

```sql
-- games table (correct schema)
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE,
  white_username TEXT,
  black_username TEXT,
  user_color TEXT,
  result TEXT,
  white_result TEXT,
  black_result TEXT,
  time_control TEXT,
  time_class TEXT,
  pgn TEXT,
  opening_class TEXT,
  date TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);

-- game positions for Lab stats
CREATE TABLE IF NOT EXISTS game_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  fen TEXT,
  fen_before TEXT,
  san TEXT
);
CREATE INDEX IF NOT EXISTS idx_game_positions_fen ON game_positions(fen);
CREATE INDEX IF NOT EXISTS idx_game_positions_fen_before ON game_positions(fen_before);

-- deviations (unchanged structure)
CREATE TABLE IF NOT EXISTS deviations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
  fen TEXT NOT NULL,
  expected_san TEXT NOT NULL,
  played_san TEXT NOT NULL,
  move_number INTEGER NOT NULL,
  eval_diff REAL,
  notes TEXT
);
```

**Step 3: Add `side` column migration for `repertoires`**

After the `statements` loop, add a try/catch that runs:
```sql
ALTER TABLE repertoires ADD COLUMN side TEXT DEFAULT 'white'
```
(SQLite will error if column already exists; catch and ignore the error.)

**Step 4: Verify**

Start the server and confirm no crash:
```bash
cd "/Users/kevin/Chess Trainer/server" && bun run index.ts
```
Expected: starts without "no such column" errors.

---

### Task 2: Fix Chess.com Sync Route

**Files:** `server/routes/games.ts`

**Problem 1:** `syncGames` inserts into wrong columns.
**Problem 2:** `insertPos.run(gameId, ...)` runs inside the transaction body BEFORE `insertGame.run(...)`, so `gameId` is undefined at that point. Positions are never inserted.

**Step 1: Add `deriveTimeClass` helper at top of file**

```typescript
function deriveTimeClass(timeControl: string): string {
  const base = parseInt(timeControl?.split('+')[0] || '0', 10);
  const increment = parseInt(timeControl?.split('+')[1] || '0', 10);
  const total = base + 40 * increment;
  if (total < 180) return 'bullet';
  if (total < 600) return 'blitz';
  if (total < 1800) return 'rapid';
  return 'classical';
}
```

**Step 2: Rewrite `syncGames` transaction**

Key changes:
- INSERT columns: `uuid, white_username, black_username, user_color, result, white_result, black_result, time_control, time_class, pgn, opening_class, date`
- Use `g.white.result` / `g.black.result` for `white_result` / `black_result`
- Use `g.time_control` / `g.time_class || deriveTimeClass(g.time_control)`
- Move `insertPos` calls AFTER `insertGame.run()` returns, using `res.lastInsertRowid`
- Parse verbose history BEFORE the insert, store in a local variable `verboseHistory`

**Step 3: Rewrite `uploadGames` with same fixes**

Same column names, same insert-order fix.

**Step 4: Fix `getGameStats`** to use `white_username` not `white`.

**Step 5: Add `listGames` export**

```typescript
export function listGames(req: Request): Response {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const rows = db.query(`
    SELECT id, uuid, white_username, black_username, user_color, result,
           white_result, black_result, time_control, time_class,
           opening_class, date, imported_at
    FROM games ORDER BY date DESC, imported_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
  return Response.json(rows);
}
```

**Step 6: Wire `listGames` in `server/index.ts`**

Read `server/index.ts` to understand the routing pattern, then add:
`GET /api/games` → `listGames(req)`

**Step 7: Verify upload works**

```bash
curl -s -X POST http://localhost:3001/api/games/upload \
  -H 'Content-Type: application/json' \
  -d '{"pgn":"[Event \"Test\"]\n[White \"TestUser\"]\n[Black \"Opponent\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0","username":"TestUser"}'
```
Expected: `{"imported":1}`

---

### Task 3: Update API Service + Add GameRecord Type

**Files:** `src/services/api.ts`

**Step 1: Add `GameRecord` interface**

```typescript
export interface GameRecord {
  id: number;
  uuid: string | null;
  white_username: string | null;
  black_username: string | null;
  user_color: 'white' | 'black' | null;
  result: 'win' | 'loss' | 'draw' | null;
  white_result: string | null;
  black_result: string | null;
  time_control: string | null;
  time_class: 'bullet' | 'blitz' | 'rapid' | 'classical' | null;
  opening_class: string | null;
  date: string | null;
  imported_at: string;
}
```

**Step 2: Add `listGames` function**

```typescript
export function listGames(limit = 50, offset = 0) {
  return request<GameRecord[]>(`/games?limit=${limit}&offset=${offset}`);
}
```

**Step 3: TypeScript check**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -30
```

---

## Phase 2 — Frontend Cleanup

### Task 4: Delete Dead Code

**Files to DELETE:**
- `src/components/ImportModal.tsx`
- `src/components/ActionBar.tsx`
- `src/components/SessionStats.tsx`
- `src/components/SessionHistory.tsx`
- `src/components/RepertoireSelector.tsx`
- `src/stores/gameStore.ts`

**Step 1: Confirm none are imported**

Search for any import of these names in `src/`:
```bash
grep -r "ImportModal\|ActionBar\|SessionStats\|SessionHistory\|RepertoireSelector\|gameStore" \
  "/Users/kevin/Chess Trainer/src" --include="*.tsx" --include="*.ts" -l
```
Expected: only the files themselves (no importers).

**Step 2: Delete all 6 files**

**Step 3: Remove duplicate store actions**

In `src/stores/trainingStore.ts`:
- Remove `incrementMistakes` (duplicate of `incrementMistake`)
- Remove `resetTraining` (duplicate of `reset`)

In `src/stores/repertoireStore.ts`:
- Remove `setChapters` (duplicate of `setShowChapters`)
- Remove `saveWeakPoint` (duplicate of `recordMistake`)

**Step 4: TypeScript check — expect zero new errors**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -30
```

---

### Task 5: Remove `useStockfish()` Hook from engine.ts

**Files:** `src/services/engine.ts`

**Step 1: Read `src/services/engine.ts`**

**Step 2: Locate and remove the `useStockfish()` React hook** (the part that calls `useState`/`useEffect` and returns engine state). Keep the `StockfishEngine` class entirely.

**Step 3: Verify**

```bash
grep -r "useStockfish" "/Users/kevin/Chess Trainer/src" --include="*.ts" --include="*.tsx"
```
Expected: no results.

---

## Phase 3 — Universal Board Component

### Task 6: Create UniversalBoard

**Files:** Create `src/components/UniversalBoard.tsx`

This replaces `ChessBoardPanel`. It is used in all tabs.

**Layout:**
- Board container (same vmin sizing as current: `w-[min(85vmin,800px)]`)
- Eval bar: absolute, `-left-6 lg:-left-10`, hidden on mobile; horizontal bar `-top-6` on mobile
- Vision overlay (conditional)
- "Coach Demo" badge (conditional on `status === 'demo'`)
- "Proceed" overlay (conditional on `awaitingNext` or prop override)
- **Control strip** below board: 4 icon buttons in a row — Flip (`RotateCw`), Vision (`Layers`), Engine (`Cpu`), Coach (`Wand2`)
- **Coach popup**: Floating card above the strip, shows when Coach button toggled. Contains `🧙` emoji + speech bubble with `currentInsight` from `useCoachStore`.
- **Engine lines panel**: Below control strip, shown when `showLines === true`. Shows top 3 lines from `topLines` with score + PV moves.

**Props:**
```typescript
interface UniversalBoardProps {
  fen: string;
  onDrop?: (source: string, target: string) => boolean;
  onProceed?: () => void;
  orientation?: 'white' | 'black';  // overrides auto-detect
  showProceedOverlay?: boolean;       // overrides awaitingNext
  arrows?: [string, string, string?][];
  readonly?: boolean;
}
```

**Key implementation notes:**
- `orientation` state initialized from `orientationProp ?? repertoireSide`; synced via `useEffect`
- Control strip buttons use `rounded-xl p-2.5 bg-[#0d1117] border border-white/10` as base; active variant adds color tint
- Coach popup: `absolute bottom-12 right-0 w-72 bg-[#0d1117] border border-white/10 rounded-2xl p-4 shadow-2xl z-50`
- Engine lines: `w-[min(85vmin,800px)] mt-2 bg-[#0d1117] border border-white/5 rounded-xl p-3`; each line: score (`font-mono text-indigo-400`) + PV (`text-slate-400 font-mono truncate`)

**Step 2: Verify compiles**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | grep UniversalBoard
```
Expected: no errors.

---

## Phase 4 — New 3-Tab Shell

### Task 7: New Layout.tsx (3 Tabs: Train / Games / Library)

**Files:** Modify `src/components/Layout.tsx`

Replace current 5-tab layout. New interface:

```typescript
type TabMode = 'train' | 'games' | 'library';

interface LayoutProps {
  children: React.ReactNode;
  activeMode: TabMode;
  onNavigate: (mode: TabMode) => void;
  dueBadge?: number;  // count of SRS positions due today; shown as rose chip on Train tab
}
```

**Tabs:**
| Tab | Icon | Active color |
|-----|------|-------------|
| Train | `Sword` | indigo |
| Games | `Database` | emerald |
| Library | `BookOpen` | amber |

**Due badge:** Small rose `rounded-full` chip in the top-right of the Train tab button. Shows `dueBadge` count (capped at `99+`). Only shown when `dueBadge > 0`.

**Drop:** Remove the tool buttons (Tree/Stats/Engine) from the sidebar — these are accessed via UniversalBoard's control strip.

**Shape:** Sidebar buttons use `rounded-xl`. Desktop sidebar is `w-[90px]`. Mobile bottom nav is `h-16`.

**Step 2: Verify the import in App.tsx won't break** (TabMode union needs to match).

---

### Task 8: TrainTab Component

**Files:** Create `src/components/TrainTab.tsx`

This wraps the current training-mode layout.

**Props:**
```typescript
interface TrainTabProps {
  fen: string;
  onDrop: (source: string, target: string) => boolean;
  onProceed: () => void;
  onStartTraining: (chapterIdx?: number) => void;
  onDeepAnalysis: () => void;
  onPlayDemo: () => void;
  onShowSolution: () => void;
  onGiveUp: () => void;
  onJumpToMove: (flatIdx: number) => void;
}
```

**Layout:** Same `flex-col lg:flex-row` split as current App.tsx training mode:
- Left: `<UniversalBoard>` + floating `<ModeSelector>` top-right
- Right: `w-full lg:w-[420px]` sidebar with `<TacticalMonitor>` + `<MoveLedger>` + `<CoachPanel>`

**Review Due:** Add local state `showReview: boolean`. When true, render `<ReviewTab onClose={() => setShowReview(false)} />` full-screen.

**ModeSelector change:** Pass `onReviewDue={() => setShowReview(true)}` as a new optional prop. In `ModeSelector.tsx`, if `onReviewDue` is provided, show a "Review Due" option that calls it.

---

### Task 9: GamesTab Component

**Files:** Create `src/components/GamesTab.tsx`

**Segmented control:** Two options — `Database` | `Analysis`. Rendered as pill buttons in a header bar.

**Database view:**
- `useEffect` on mount: call `api.listGames()` → store in local state
- Loading: centered spinner text
- Empty: `Database` icon + "No games yet. Sync from Chess.com or upload a PGN." text
- Game rows: `bg-[#0a0d14] rounded-xl border border-white/5 hover:border-white/10`
  - W/L/D badge: `Trophy`/`X`/`Minus` icon in colored `w-8 h-8 rounded-lg` box
    - win: `bg-emerald-500/10 border-emerald-500/20 text-emerald-400`
    - loss: `bg-rose-500/10 border-rose-500/20 text-rose-400`
    - draw: `bg-slate-500/10 border-slate-500/20 text-slate-400`
  - Time class chip: `text-[9px] font-black uppercase px-2 py-0.5 rounded-full` with per-class color
    - bullet: `text-red-400 bg-red-400/10`, blitz: amber, rapid: emerald, classical: indigo
  - Opening name: `text-[9px] text-slate-500`
  - Date: `text-[9px] text-slate-600 font-mono`

**Analysis view:** Just render `<GameLab />` filling the available space.

---

### Task 10: LibraryTab Component

**Files:** Create `src/components/LibraryTab.tsx`

**Layout:**
- Header bar: `BookOpen` icon + "Library" title + "Import PGN" button (`Upload` icon, amber style)
- Below: `<ChapterLibrary onSelectChapter={onSelectChapter} onClose={() => {}} />`
- Import PGN button opens `<PgnImportModal>` which on import calls `api.importRepertoire` then `loadFromApi()`

**Props:**
```typescript
interface LibraryTabProps {
  onSelectChapter: (idx: number) => void;
}
```

---

### Task 11: Rewrite App.tsx

**Files:** Modify `src/App.tsx`

**Key changes from current:**
1. `activeMode` union: `'train' | 'games' | 'library'` (was 5 modes)
2. Load `dueBadge` via `api.getDuePositions(repertoireId)` in `useEffect` on mount
3. Remove all the `storedGames`, `selectedAnalyzedGame`, `lastGame`, `showPgnModal`, `showChessComModal`, `isSyncing` state (these move into GamesTab)
4. Remove: `ChessComModal`, `PgnImportModal` imports (move into GamesTab/LibraryTab)
5. Remove: `ProgressDashboard`, `RepertoireTree` overlay renders (these move into respective tabs or are dropped)
6. Layout: `<Layout activeMode={activeTab} onNavigate={setActiveTab} dueBadge={dueBadge}>`
7. Three `<div className="absolute inset-0">` children with `style={{ display: activeTab !== X ? 'none' : undefined }}` for Games (persistent); conditional render for Library; TrainTab always mounted

**Imports to add:** `TrainTab`, `GamesTab`, `LibraryTab`
**Imports to remove:** `GameHub`, `GameAnalysis`, `GameLab`, `PgnImportModal`, `ChessComModal`, `ReviewTab`, `ProgressDashboard`, `RepertoireTree`, `ModeSelector`, `ChessBoardPanel`, `TacticalMonitor`, `MoveLedger`, `CoachPanel` (all moved into tab components)

**Verify build:**

```bash
cd "/Users/kevin/Chess Trainer" && npm run build 2>&1 | tail -20
```
Expected: Clean build, 0 TS errors.

---

## Phase 5 — Design System Pass

### Task 12: Standardize Rounded Corners + Fix AI Coach Prompt

**Step 1: Find all mega-radius usage**

```bash
grep -rn "rounded-\[" "/Users/kevin/Chess Trainer/src/components" --include="*.tsx"
```

**Step 2: Replace mega-radius with standardized values**

- `rounded-[3.5rem]`, `rounded-[4rem]`, `rounded-[3rem]` on panel/card divs → `rounded-2xl`
- On buttons → `rounded-xl`

Files likely affected: `CoachPanel.tsx`, `TacticalMonitor.tsx`, `ChapterLibrary.tsx`, `ProgressDashboard.tsx`, `ReviewTab.tsx`

**Step 3: Fix AI coach prompt**

Read `src/services/ai_coach.ts`. Find the hardcoded "Jobava London" string in the system prompt. Change the `getCoachInsight` function to accept `repertoireName: string` as a parameter and inject it into the prompt instead of the hardcoded name.

**Step 4: Update call site in `useTraining.ts`**

Pass `useRepertoireStore.getState().repertoireName` as `repertoireName` argument wherever `getCoachInsight` / `analyzePosition` is called.

**Step 5: Final verification**

```bash
cd "/Users/kevin/Chess Trainer" && npm run build && npm run lint 2>&1 | tail -20
```
Expected: Clean.

---

## Execution Order Summary

| # | Task | Phase | Risk |
|---|------|-------|------|
| 1 | Fix games DB schema | Backend | Medium — drops old table |
| 2 | Fix Chess.com sync route | Backend | Low |
| 3 | Add `listGames` to API service | Backend | Low |
| 4 | Delete dead code | Cleanup | Low |
| 5 | Remove `useStockfish()` hook | Cleanup | Low |
| 6 | Create `UniversalBoard` | New component | Low (additive) |
| 7 | New 3-tab `Layout` | Shell | Medium |
| 8 | `TrainTab` component | Shell | Medium |
| 9 | `GamesTab` component | Shell | Low (new) |
| 10 | `LibraryTab` component | Shell | Low (new) |
| 11 | Rewrite `App.tsx` | Shell | High (replaces root) |
| 12 | Design pass + AI coach fix | Polish | Low |

**Batch 1 (Backend):** Tasks 1–3
**Batch 2 (Cleanup):** Tasks 4–5
**Batch 3 (Components):** Tasks 6, 9, 10
**Batch 4 (Shell):** Tasks 7, 8, 11
**Batch 5 (Polish):** Task 12
