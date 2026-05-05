# Insights Expansion: Time Data, Game Shape & Persistent Pattern Report — Design

**Date:** 2026-02-28
**Goal:** Add time-per-move data to game analysis, classify each game by "shape" (Smooth/Wild/Sharp/etc.), persist the Pattern Report in the database, and expand the Insights Panel with opening breakdown, time stats, and shape distribution.

---

## Problem

1. **Time data is unused.** Every Chess.com/Lichess PGN has `%clk` annotations after each move. This data is stored in the DB but never parsed or surfaced — so you can't tell whether a blunder was a time-scramble mistake or a calculation failure.

2. **Pattern Report is ephemeral.** It disappears on page reload and has to be re-run every session. It also sends only a minimal blunder list to Gemini, missing win rates, opening health, time context, and game shape.

3. **Insights Panel is shallow.** Four stat cards and a coverage bar. No opening breakdown, no time management view, no game character summary.

---

## Solution Overview

Four features, implemented as 11 independent tasks:

| Feature | What it adds |
|---|---|
| **Time data** | Parse `%clk` from PGN; show clock + time spent per move in notation panel; flag time pressure |
| **Game shape** | Algorithmic classification of each game's eval trajectory into 7 shapes |
| **Persistent Pattern Report** | Stored in SQLite; rich aggregated stats sent to Gemini; cached on page load |
| **Insights Panel expansion** | Opening breakdown table, time stats, shape distribution, persistent report UI |

---

## Feature 1: Time Data in Analysis

### Data Source

Chess.com and Lichess PGNs include clock annotations as move comments:

```
1. d4 {[%clk 0:02:59.8]} 1... d5 {[%clk 0:02:51.7]}
[TimeControl "180"]
[Termination "Klarke won on time"]
```

The `comment` field on each `ParsedMove` already captures this text — it just isn't parsed further.

### Changes

**`src/services/pgn_parser.ts`**
- Add `clockAfter?: number` (seconds) to `ParsedMove`
- In `parseRecursive`, after assigning `comment`, parse `%clk H:MM:SS.s` → seconds float
- Extract `TimeControl` header value (strip increment: `"180+2"` → `180`)

**`src/hooks/useGameReview.ts`**
- Add to `ReviewedMove`: `timeSpent?: number`, `clockRemaining?: number`
- In `analyzeGame` loop, read `parsedGame.moves[i].clockAfter`:
  - `timeSpent = prevClock - clockAfter`
  - `clockRemaining = clockAfter`
  - `prevClock` initialised from `parsedGame.headers['TimeControl']`
  - Alternate prevClock per colour (white/black have separate clocks)
- Time pressure flag: `clockAfter < Math.max(30, initialTime * 0.10)`

**`server/db.ts`**
- Add `time_control TEXT` and `termination TEXT` columns to `games` table (migration)

**`server/routes/games.ts`** (sync/upload path)
- Extract `TimeControl` and `Termination` headers when storing games

**`src/components/GameAnalysis.tsx`** — notation panel
- Per move, show: `timeSpent` (e.g. `8s`) and `clockRemaining` (e.g. `2:51`) as small secondary text
- Time pressure moves: orange clock icon (⏰) when `clockRemaining < threshold`
- Only rendered when `timeSpent` is defined (games without `%clk` show nothing)

---

## Feature 2: Game Shape Classification

### Algorithm

Computed from the `eval` array in `analysis_json` (always white-perspective centipawns). No Gemini, pure arithmetic.

```
Inputs:
  evals[]        — white-perspective eval per move (from ReviewedMove.eval)
  grades[]       — grade per move
  totalMoves     — length of game

Derived:
  leadChanges    — count of times eval crosses 0
  evalVariance   — stddev of evals
  maxSwing       — max |evals[i] - evals[i-1]| across all consecutive pairs
  totalBlunders  — count of grades === 'blunder' (both sides)
  peakAdvantage  — max(|eval|) at any point by the loser
  finalEval      — evals[last]

Classification (priority order — first match wins):
  1. Wild      — totalBlunders >= 4
  2. Giveaway  — loser held peakAdvantage > 200cp AND finalEval opposite sign
  3. Sudden    — leadChanges <= 1 AND maxSwing > 350cp
  4. Sharp     — leadChanges >= 3
  5. Smooth    — leadChanges === 0 AND evalVariance < 80
  6. Intense   — totalMoves >= 35 AND evalVariance < 120 AND totalBlunders <= 1
  7. Balanced  — (default)
```

### Storage

`server/db.ts`: add `game_shape TEXT` column to `games` table.

`server/routes/games.ts`: after saving `analysis_json`, compute shape and UPDATE `game_shape`.

The shape computation function lives in `server/utils/gameShape.ts` — a pure function, no DB or API calls.

### Display

**`src/components/GameAnalysis.tsx`** — shape badge in the game header bar (next to the player names), colour-coded:

| Shape | Colour |
|---|---|
| Smooth | emerald |
| Balanced | slate |
| Sharp | amber |
| Wild | rose |
| Sudden | orange |
| Giveaway | red |
| Intense | indigo |

---

## Feature 3: Persistent Pattern Report

### Database

New table in `server/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS pattern_reports (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  games_hash TEXT,       -- SHA of game IDs analysed, for change detection
  report_json TEXT NOT NULL
)
```

Only the latest row is used. New runs INSERT a new row; old rows are deleted after insert.

### API

**`GET /api/analyze/patterns`** — returns cached report from `pattern_reports` (latest row), including `created_at`. Returns `null` if never run.

**`POST /api/analyze/patterns`** — runs full analysis, saves to `pattern_reports`, returns result.

### Comprehensive data sent to Gemini (POST)

Server collects from DB before calling Gemini:

```
1. Win rates by colour
   white_wins / white_draws / white_losses  (count + %)
   black_wins / black_draws / black_losses  (count + %)

2. Phase accuracy  (from analysis_json across all games)
   opening:    error_count, avg_cpLoss
   middlegame: error_count, avg_cpLoss
   endgame:    error_count, avg_cpLoss

3. Opening breakdown  (grouped by opening_class)
   For each opening: game_count, win_pct, draw_pct, loss_pct, avg_cpLoss

4. Time management  (from analysis_json timeSpent/clockRemaining fields)
   avg_time_per_move (white + black)
   blunders_under_pressure / blunders_with_time
   games_lost_on_time  (from termination column)

5. Game shape distribution
   count per shape, % of total
```

No individual move list — patterns only.

### Gemini output format (unchanged structure, richer content)

```
SUMMARY: [2-3 sentences on biggest weakness]
PATTERN_1: [First recurring issue]
PATTERN_2: [Second recurring issue]
PATTERN_3: [Third issue]
PATTERN_4: [Fourth issue, or N/A]
PATTERN_5: [Fifth issue, or N/A]
ACTION: [Single most impactful improvement focus]
```

### `PatternAnalysis` interface extension (`src/services/api.ts`)

```ts
export interface PatternAnalysis {
  summary: string;
  patterns: string[];
  action: string | null;
  createdAt: string | null;       // ISO timestamp from DB
  stats: {
    totalGames: number;
    gamesAnalyzed: number;        // games with analysis_json
    // Win rates
    whiteWins: number; whiteDraws: number; whiteLosses: number;
    blackWins: number; blackDraws: number; blackLosses: number;
    // Phase
    opening: number; middlegame: number; endgame: number;
    // Time
    gamesLostOnTime: number;
    blundersUnderPressure: number;
    // Shape distribution
    shapes: Record<string, number>;
  };
  openings: Array<{
    name: string;
    games: number;
    winPct: number;
    drawPct: number;
    lossPct: number;
  }>;
  isError: boolean;
}
```

---

## Feature 4: Insights Panel Expansion

### New sections added to `InsightsTab.tsx`

**Stat cards row** — add a 5th card (or replace "Weak Points" with a toggle):
- **Time Pressure** — count of blunders/mistakes made with clock < pressure threshold

**Opening Breakdown section** (new, below Repertoire Coverage):
- Table of openings with game count, W%/D%/L% bars, sorted by game count descending
- Empty state: "Analyse more games to see opening stats"

**Game Shape Distribution section** (new):
- Icon grid showing count per shape, colour-coded
- Tooltip: definition of each shape on hover

**Pattern Report** (existing, enhanced):
- Loads cached report on mount (no spinner on first open if report exists)
- Header shows "last run X ago" timestamp
- Stats row: Win rates (W/B), phase breakdown (O/M/E), shape breakdown
- AI narrative + patterns below
- Re-run button triggers POST

---

## Files Changed Summary

| File | Change |
|---|---|
| `server/db.ts` | Add `time_control`, `termination`, `game_shape` to `games`; add `pattern_reports` table |
| `server/utils/gameShape.ts` | New — pure shape classification function |
| `server/routes/games.ts` | Extract time_control/termination on save; compute + store game_shape after analysis saved |
| `server/routes/patterns.ts` | GET cached / POST run; comprehensive data collection; extended response |
| `src/services/pgn_parser.ts` | Extract `%clk` → `clockAfter` on `ParsedMove` |
| `src/hooks/useGameReview.ts` | Compute `timeSpent`, `clockRemaining` in `analyzeGame`; add to `ReviewedMove` |
| `src/services/api.ts` | Update `PatternAnalysis` interface; add `getPatternReport()` + `runPatternAnalysis()` |
| `src/components/GameAnalysis.tsx` | Time display in notation panel; game shape badge in header |
| `src/components/InsightsTab.tsx` | Opening breakdown, shape distribution, persistent pattern report UI |

---

## Edge Cases

- **No `%clk` in PGN** (older games, manual uploads): `timeSpent` / `clockRemaining` undefined; notation panel shows nothing for time; time fields excluded from pattern report
- **Shape on re-analysis**: recomputed and updated; old shape overwritten
- **Pattern report never run**: GET returns `null`; panel shows "Run Analysis" button
- **Pattern report run but no time data yet**: time section omitted from Gemini prompt; report still generated from available data
- **Games table migration**: `ALTER TABLE` adds new nullable columns; existing rows unaffected
