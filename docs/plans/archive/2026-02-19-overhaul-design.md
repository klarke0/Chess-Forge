# Chess Trainer Overhaul — Design Document
*Approved 2026-02-19*

## Goal

Rebuild the component shell and fix backend correctness issues while keeping all working logic (hooks, stores, services, SM-2, API layer). Result: a focused 3-tab app serving three purposes — drilling openings, reviewing games, and managing repertoire libraries.

## Approach

**Option B — New shell, keep the logic.** All hooks (`useTraining`, `useSpacedRepetition`, `useGameReview`), stores (`trainingStore`, `engineStore`, `settingsStore`, `coachStore`, `repertoireStore`), services (`engine.ts`, `ai_coach.ts`, `api.ts`, `sm2.ts`), and the API layer are kept intact. The component layer is rewritten under a coherent 3-tab structure with a shared design system.

---

## Navigation — 3 Tabs

```
┌──────────────────────────────────────────────┐
│  ♟ ChessTrainer     [Train] [Games] [Library] │
└──────────────────────────────────────────────┘
```

### Train Tab
- Full-screen board + right panel (move ledger + status/coach panel)
- Badge on tab showing count of SRS positions due today
- Training modes: Full Line, Weak Spots, Quiz (existing ModeSelector)
- **Review Due** mode: drills SRS-due positions in the same board UI — no separate tab
- End-of-line overlay with 3 options: Replay / Next Chapter / Weakest Position

### Games Tab
- Segmented control: **Database** | **Analysis**
- **Database view**: scrollable game list. Each row shows:
  - W/L/D badge (color-coded)
  - Time class chip with clock icon (Bullet / Blitz / Rapid / Classical)
  - Opening name, opponent, date
  - Import buttons: "Sync Chess.com" + "Upload PGN"
  - Stats panel: win rate by opening, by time class
- **Analysis view**: the Game Lab — load a game from the database or paste PGN, step through moves, Lichess-style eval graph, Stockfish annotation per move (blunder/mistake/good)

### Library Tab
- Import a Lichess study PGN — server parses it, extracts chapters and positions
- Browse active repertoire: chapter list with real per-chapter accuracy from `progress` table
- Variation tree browser
- Switch active repertoire

---

## Universal Board Component

One `<UniversalBoard>` component used in all three tabs. Props control context (training / review / analysis).

**Layout:**
```
┌─── Eval Bar ──┬─────────────────────────┐
│               │                         │
│   (vertical)  │      Chess Board        │
│               │                         │
└───────────────┴─────────────────────────┘
                 [↻] [◈] [≡] [🧙]
                ┌─ Engine Lines ──────────┐
                │  1. Nf3  +0.3  e4 Nc3… │
                │  2. d4   +0.1  d5 c4…  │
                │  3. e4   -0.1  c5 Nf3… │
                └─────────────────────────┘
```

**Control strip** (horizontal, below board):
- `↻` Flip board
- `◈` Vision heatmap toggle
- `≡` Engine lines toggle — shows/hides the top-3 lines panel below
- `🧙` AI Coach — opens floating wizard popup

**AI Coach popup**: Floating card anchored to the Coach button. Chess wizard character with a speech bubble showing current insight/tip. Dismiss by clicking the button again. Small, unobtrusive, on-demand.

**One Stockfish worker**: Global `engineStore` singleton feeds all views. `useStockfish()` hook removed. `useGameReview` updated to use `engineStore`.

---

## UI Design System

### Colors (unchanged)
- Page backgrounds: `#050507`, `#0a0d14`, `#0d1117`
- Board dark squares: `#1e293b`, light squares: `#475569`, border: `#161b22`
- Accents: Indigo (training/correct), Rose (wrong/mistakes), Emerald (success)
- Text: `slate-200` (primary), `slate-400` (secondary), `slate-600` (muted)

### Shape Scale (standardized)
- Panels / cards: `rounded-2xl`
- Primary buttons: `rounded-xl px-6 py-3`
- Icon buttons: `rounded-xl p-2.5`
- Chips / badges: `rounded-full px-3 py-1`
- **Remove**: `rounded-[3.5rem]`, `rounded-[4rem]`, `rounded-[3rem]` mega-radius

### Typography
- Section headers: `text-lg font-black uppercase tracking-tighter italic`
- Tab labels: `text-[10px] font-black uppercase tracking-widest`
- Body: `text-sm font-medium text-slate-400`
- Eval / FEN: `font-mono text-slate-500`

---

## Backend Changes

### Fix 1 — Games Schema (Critical)
Current `games` table columns don't match what `games.ts` writes. Add migration:

```sql
-- Drop and recreate games table with correct columns
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE,
  white_username TEXT,
  black_username TEXT,
  user_color TEXT,           -- 'white' | 'black'
  result TEXT,               -- 'win' | 'loss' | 'draw'
  white_result TEXT,         -- 'win' | 'checkmated' | 'resign' | 'timeout' | etc.
  black_result TEXT,
  time_control TEXT,         -- raw PGN value e.g. "300+3"
  time_class TEXT,           -- 'bullet' | 'blitz' | 'rapid' | 'classical'
  pgn TEXT,
  opening_class TEXT,
  date TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE game_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
  fen TEXT,
  fen_before TEXT,
  san TEXT
);
CREATE INDEX idx_game_positions_fen ON game_positions(fen);
CREATE INDEX idx_game_positions_fen_before ON game_positions(fen_before);
```

Time class derived from time_control:
- `< 180s` total → Bullet
- `180–599s` → Blitz
- `600–1799s` → Rapid
- `>= 1800s` → Classical

### Fix 2 — `repertoires.side` Column (Critical)
```sql
ALTER TABLE repertoires ADD COLUMN side TEXT DEFAULT 'white';
```

### Fix 3 — SM-2 Consolidation
Remove server-side SM-2 calculation from `progress.ts`. The server always trusts client-computed values (`grade`, `easeFactor`, `intervalDays`, `nextReview`). Training loop `recordAttempt` calls in `useTraining.ts` compute SM-2 via `sm2.ts` before sending. One algorithm, one place.

### Fix 4 — Real PGN Import (Lichess Studies)
Replace the current `importPgn` stub with a real parser:
- Use `chess.js` on the server to walk PGN variation trees
- Extract all positions (FEN before each move) and moves
- Parse chapter names from `[Event "..."]` or `[White "..."]` headers
- Detect side from position FENs (whose moves are "main line" vs responses)
- Insert into `positions` table with `repertoire_id`
- Insert chapters with `start_moves` arrays

### Fix 5 — Chess.com Sync
Fix route to match corrected games schema. Add `time_control`, `time_class`, `white_result`, `black_result` fields from Chess.com API response (`g.white.result`, `g.black.result`, `g.time_control`, `g.time_class`).

---

## Cleanup Tasks

| Item | Lines | Action |
|------|-------|--------|
| `src/stores/gameStore.ts` | 76 | Delete |
| `src/components/ImportModal.tsx` | 138 | Delete |
| `src/components/ActionBar.tsx` | 36 | Delete |
| `src/components/SessionStats.tsx` | 113 | Delete |
| `src/components/SessionHistory.tsx` | 92 | Delete |
| `src/components/RepertoireSelector.tsx` | 96 | Delete |
| `src/services/engine.ts` `useStockfish()` hook | ~40 | Remove hook, keep StockfishEngine class |
| `trainingStore` duplicate actions | ~8 | Remove `incrementMistakes`, `resetTraining`, consolidate resets |
| `repertoireStore` duplicate actions | ~6 | Remove `setChapters`, merge `saveWeakPoint` into `recordMistake` |
| **Total** | **~605 lines** | |

---

## What Does NOT Change

- `useTraining.ts` — core training loop logic (only minor cleanup)
- `useSpacedRepetition.ts` — SRS state machine
- `useGameReview.ts` — move analysis (update to use engineStore instead of useStockfish)
- `src/utils/sm2.ts` — SM-2 algorithm
- `src/services/api.ts` — fetch wrappers (minor additions for new routes)
- `src/services/ai_coach.ts` — update system prompt to use repertoireName
- `src/stores/engineStore.ts` — Stockfish singleton (keep as-is)
- `src/stores/trainingStore.ts` — training state (minor cleanup only)
- `src/stores/repertoireStore.ts` — positions/chapters (minor cleanup)
- Board colors, dark theme, indigo/rose/emerald accent palette
- Lichess-style eval graph in Game Lab
- Move ledger with clickable notation
- Chapter start_moves guided line following logic
