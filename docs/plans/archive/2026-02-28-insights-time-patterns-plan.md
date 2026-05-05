# Insights Expansion: Time Data, Game Shape & Persistent Pattern Report — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `%clk` time data to game review, classify each game by shape (Smooth/Wild/etc.), persist the Pattern Report in SQLite, and expand the Insights Panel with opening stats, time management, and shape distribution.

**Architecture:** 4 features across 11 independent tasks. Backend-first (Tasks 1–5), then frontend notation/badge (Task 6), then pattern report rework (Tasks 7–9), then Insights UI (Tasks 10–11). Each task is self-contained with TypeScript compile verification.

**Tech Stack:** Bun 1.3.9 + bun:sqlite (backend), React + TypeScript + Tailwind CSS (frontend), Vite, chess.js, Gemini 2.0 Flash REST API

**Design doc:** `docs/plans/2026-02-28-insights-time-patterns-design.md` — refer to it for algorithm details and UI descriptions.

---

## Context You Must Know

**File locations:**
- `server/db.ts` — SQLite schema + `addCol` migration helper
- `server/routes/games.ts` — `saveAnalysis`, `syncGames`, `uploadGames`
- `server/routes/patterns.ts` — current pattern analysis (GET only, ephemeral)
- `server/index.ts` — manual routing (no framework)
- `src/services/pgn_parser.ts` — `ParsedMove` interface + `PgnParser` class
- `src/hooks/useGameReview.ts` — `ReviewedMove` interface + `analyzeGame`
- `src/services/api.ts` — frontend API client + `PatternAnalysis` interface
- `src/components/GameAnalysis.tsx` — notation panel + game header bar
- `src/components/InsightsTab.tsx` — insights page with `PatternPanel` component

**Verification command (run after every task):**
```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
This must exit 0 before you commit.

**Start the backend to manually test:**
```bash
cd "/Users/kevin/Chess Trainer/server" && bun run dev
```

**Bun:sqlite import style used in this codebase:**
```ts
import db from "../db";
// db is a Database instance, use db.query("...").run() or .all() or .get()
// db.prepare("...").run(params) for repeated statements
```

---

## Task 1: DB Migrations

**Files:**
- Modify: `server/db.ts`

**What to do:**

Add three new columns to `games` via the existing `addCol` helper, and create a new `pattern_reports` table. Add both inside `runMigrations`.

**Step 1: Add the three `addCol` calls**

In `server/db.ts`, after line 130 (after the existing `addCol` calls), add:

```ts
  addCol("games", "termination", "TEXT");
  addCol("games", "game_shape", "TEXT");
```

**Step 2: Add the `pattern_reports` table**

After the `addCol` block (still inside `runMigrations`), append this statement to the `statements` array (before the `for` loop that runs them) — OR add it after the loop as a separate `db.query().run()`. Either works; use whichever is cleaner. The safest approach is to add it after the `for` loop:

```ts
  db.query(`CREATE TABLE IF NOT EXISTS pattern_reports (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    games_hash TEXT,
    report_json TEXT NOT NULL
  )`).run();
```

**Step 3: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0, no errors.

**Step 4: Smoke test (optional but fast)**

```bash
cd "/Users/kevin/Chess Trainer/server" && bun run dev
```
Server should start without errors. Check logs for any migration output.

**Step 5: Commit**

```bash
cd "/Users/kevin/Chess Trainer"
git add server/db.ts
git commit -m "feat: add termination, game_shape cols + pattern_reports table"
```

---

## Task 2: PGN Clock Extraction

**Files:**
- Modify: `src/services/pgn_parser.ts`

**What to do:**

Add `clockAfter?: number` (seconds as float) to `ParsedMove`. After each comment is assigned, parse `%clk H:MM:SS.s` out of it.

**Step 1: Extend the `ParsedMove` interface**

Replace:
```ts
export interface ParsedMove {
  san: string;
  fenBefore: string;
  fenAfter: string;
  comment?: string;
  nag?: string;
  variations: ParsedMove[][];
}
```

With:
```ts
export interface ParsedMove {
  san: string;
  fenBefore: string;
  fenAfter: string;
  comment?: string;
  nag?: string;
  variations: ParsedMove[][];
  clockAfter?: number; // seconds remaining after this move, parsed from %clk
}
```

**Step 2: Parse `%clk` from comments in `parseRecursive`**

Find the block in `parseRecursive` that handles `token.startsWith('{')`:

```ts
      if (token.startsWith('{')) {
        if (moves.length > 0) {
          moves[moves.length - 1].comment = token.slice(1, -1).trim();
        }
        i++;
        continue;
      }
```

Replace with:

```ts
      if (token.startsWith('{')) {
        if (moves.length > 0) {
          const commentText = token.slice(1, -1).trim();
          moves[moves.length - 1].comment = commentText;
          // Parse %clk H:MM:SS.s or H:MM:SS → seconds
          const clkMatch = commentText.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
          if (clkMatch) {
            const hours = parseInt(clkMatch[1], 10);
            const minutes = parseInt(clkMatch[2], 10);
            const seconds = parseFloat(clkMatch[3]);
            moves[moves.length - 1].clockAfter = hours * 3600 + minutes * 60 + seconds;
          }
        }
        i++;
        continue;
      }
```

**Step 3: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0.

**Step 4: Commit**

```bash
git add src/services/pgn_parser.ts
git commit -m "feat: parse %clk annotations into ParsedMove.clockAfter"
```

---

## Task 3: Time Data in Game Review

**Files:**
- Modify: `src/hooks/useGameReview.ts`

**What to do:**

Add `timeSpent?: number` and `clockRemaining?: number` to `ReviewedMove`, then compute them in `analyzeGame` from `parsedGame.moves[i].clockAfter`.

**Key logic:**
- White and black have separate clocks, so track `prevClockWhite` and `prevClockBlack`
- Initial clock for both comes from `parsedGame.headers['TimeControl']` (strip increment: `"180+2"` → `180`)
- `timeSpent = prevClock[side] - clockAfter` (can be negative if opponent's increment bumped it — clamp to 0)
- `clockRemaining = clockAfter`
- Time pressure flag: `clockRemaining < Math.max(30, initialTime * 0.10)` — store as `underPressure?: boolean`

**Step 1: Extend the `ReviewedMove` interface**

Replace:
```ts
export interface ReviewedMove {
  san: string;
  fen: string;
  eval: number; // Always white perspective
  cpLoss: number;
  grade: 'excellent' | 'good' | 'standard' | 'inaccuracy' | 'mistake' | 'blunder';
}
```

With:
```ts
export interface ReviewedMove {
  san: string;
  fen: string;
  eval: number; // Always white perspective
  cpLoss: number;
  grade: 'excellent' | 'good' | 'standard' | 'inaccuracy' | 'mistake' | 'blunder';
  timeSpent?: number;      // seconds this side spent on this move
  clockRemaining?: number; // seconds left on clock after move
  underPressure?: boolean; // clock < 10% of initial or < 30s
}
```

**Step 2: Compute time data in `analyzeGame`**

In the `analyzeGame` function, before the `for` loop, add:

```ts
    // Parse initial time from TimeControl header (strip increment: "180+2" → 180)
    const tcRaw = parsedGame.headers['TimeControl'] ?? '';
    const initialTime = parseInt(tcRaw.split('+')[0], 10) || null;
    const pressureThreshold = initialTime ? Math.max(30, initialTime * 0.10) : 30;

    let prevClockWhite: number | null = initialTime;
    let prevClockBlack: number | null = initialTime;
```

Inside the for loop, after `const turn = game.turn();`, add:

```ts
        // Time data
        const clockAfter = moves[i].clockAfter ?? null;
        let timeSpent: number | undefined;
        let clockRemaining: number | undefined;
        let underPressure: boolean | undefined;

        if (clockAfter !== null && clockAfter !== undefined) {
          const prevClock = turn === 'w' ? prevClockWhite : prevClockBlack;
          if (prevClock !== null) {
            timeSpent = Math.max(0, prevClock - clockAfter);
          }
          clockRemaining = clockAfter;
          underPressure = clockAfter < pressureThreshold;
          if (turn === 'w') prevClockWhite = clockAfter;
          else prevClockBlack = clockAfter;
        }
```

Then, in the `results.push({...})` call, add the three new fields:

```ts
        results.push({
          san: moveSan,
          fen,
          eval: normalizedEval,
          cpLoss: cpLoss,
          grade: getGrade(cpLoss),
          timeSpent,
          clockRemaining,
          underPressure,
        });
```

**Step 3: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0.

**Step 4: Commit**

```bash
git add src/hooks/useGameReview.ts
git commit -m "feat: compute timeSpent, clockRemaining, underPressure in game review"
```

---

## Task 4: Game Shape Classification Utility

**Files:**
- Create: `server/utils/gameShape.ts`

**What to do:**

Pure function, no imports, no DB. Takes an array of eval values and grades, returns a shape string.

**Step 1: Create `server/utils/gameShape.ts`**

```ts
export type GameShape =
  | 'Wild'
  | 'Giveaway'
  | 'Sudden'
  | 'Sharp'
  | 'Smooth'
  | 'Intense'
  | 'Balanced';

/**
 * Classify a game's "shape" from its eval trajectory.
 * evals: white-perspective centipawns per move (ReviewedMove.eval array)
 * grades: grade per move (same order)
 * userColor: 'white' | 'black' | null — determines who "lost" for Giveaway check
 */
export function classifyGameShape(
  evals: number[],
  grades: string[],
  result: string | null, // 'win' | 'loss' | 'draw' | null from user's perspective
  userColor: string | null,
): GameShape {
  if (evals.length < 4) return 'Balanced';

  const totalBlunders = grades.filter(g => g === 'blunder').length;

  // 1. Wild — too many blunders
  if (totalBlunders >= 4) return 'Wild';

  // 2. Giveaway — loser held >200cp advantage then lost
  // Find final eval sign and peak advantage for the loser
  const finalEval = evals[evals.length - 1];
  const loserWasWhite = finalEval < 0; // if white is losing at end, white is loser
  const loserSign = loserWasWhite ? 1 : -1; // white perspective: loser's advantage is positive for white if loser is white
  const peakLoserAdvantage = Math.max(...evals.map(e => loserWasWhite ? e : -e));
  if (peakLoserAdvantage > 200 && Math.sign(finalEval) !== 0 && Math.abs(finalEval) > 100) {
    return 'Giveaway';
  }

  // Count lead changes (eval crossing 0)
  let leadChanges = 0;
  for (let i = 1; i < evals.length; i++) {
    if (Math.sign(evals[i]) !== Math.sign(evals[i - 1]) &&
        Math.sign(evals[i]) !== 0 &&
        Math.sign(evals[i - 1]) !== 0) {
      leadChanges++;
    }
  }

  // Max swing between consecutive moves
  let maxSwing = 0;
  for (let i = 1; i < evals.length; i++) {
    maxSwing = Math.max(maxSwing, Math.abs(evals[i] - evals[i - 1]));
  }

  // Eval variance (stddev)
  const mean = evals.reduce((s, e) => s + e, 0) / evals.length;
  const variance = evals.reduce((s, e) => s + (e - mean) ** 2, 0) / evals.length;
  const stddev = Math.sqrt(variance);

  // 3. Sudden — one-sided but dramatic single swing
  if (leadChanges <= 1 && maxSwing > 350) return 'Sudden';

  // 4. Sharp — many lead changes (back and forth)
  if (leadChanges >= 3) return 'Sharp';

  // 5. Smooth — one-sided all game, low variance
  if (leadChanges === 0 && stddev < 80) return 'Smooth';

  // 6. Intense — long strategic fight, close throughout
  if (evals.length >= 35 && stddev < 120 && totalBlunders <= 1) return 'Intense';

  // 7. Default
  return 'Balanced';
}
```

**Step 2: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0.

**Step 3: Commit**

```bash
git add server/utils/gameShape.ts
git commit -m "feat: add pure game shape classification utility"
```

---

## Task 5: Store Game Shape + Termination on Analysis Save

**Files:**
- Modify: `server/routes/games.ts`

**What to do:**

When `saveAnalysis` is called with the completed analysis array, extract shape from the eval/grade data and UPDATE `game_shape`. Also extract `termination` from the game's PGN header and store it.

**Step 1: Import the shape utility at the top of `games.ts`**

Add after the existing imports:
```ts
import { classifyGameShape } from "../utils/gameShape";
```

**Step 2: Modify `saveAnalysis`**

Replace the current `saveAnalysis` function body with:

```ts
export async function saveAnalysis(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parseInt(parts[parts.length - 2], 10); // /api/games/:id/analysis

    const { analysis } = await req.json() as { analysis: any[] };

    if (isNaN(id)) return Response.json({ error: "Invalid ID" }, { status: 400 });

    // Compute game shape from analysis
    const evals: number[] = analysis.map((m: any) => m.eval ?? 0);
    const grades: string[] = analysis.map((m: any) => m.grade ?? 'standard');
    const gameShape = classifyGameShape(evals, grades, null, null);

    // Fetch the game's PGN to extract Termination header
    const gameRow = db.query(`SELECT pgn, result, user_color FROM games WHERE id = ?`).get(id) as any;
    let termination: string | null = null;
    if (gameRow?.pgn) {
      const termMatch = gameRow.pgn.match(/\[Termination\s+"([^"]+)"\]/);
      if (termMatch) termination = termMatch[1];
    }

    const res = db.prepare(
      `UPDATE games SET analysis_json = ?, game_shape = ?, termination = ? WHERE id = ?`
    ).run(JSON.stringify(analysis), gameShape, termination, id);

    if (res.changes === 0) return Response.json({ error: "Game not found" }, { status: 404 });

    console.log(`[POST /api/games/:id/analysis] Saved analysis for game ID: ${id}, shape: ${gameShape}`);
    return Response.json({ ok: true, shape: gameShape });
  } catch (err: any) {
    console.error(`[POST /api/games/:id/analysis] Server Error:`, err);
    return Response.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
```

**Step 3: Also extract termination in `syncGames` and `uploadGames`**

In `syncGames`, within the transaction loop, after extracting `opening`:

```ts
        // Extract Termination header
        const terminationMatch = g.pgn.match(/\[Termination\s+"([^"]+)"\]/);
        const termination = terminationMatch ? terminationMatch[1] : null;
```

Then update the INSERT to include `termination`. Change the `insertGame` prepare statement to:
```ts
  const insertGame = db.prepare(`
    INSERT OR IGNORE INTO games (
      uuid, white_username, black_username, user_color, result,
      white_result, black_result, time_control, time_class,
      pgn, opening_class, opening_name, eco, date, termination
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
```

And update the `.run()` call to pass `termination` as the 15th argument:
```ts
        const res = insertGame.run(
          g.uuid, g.white.username, g.black.username, userColor, result,
          g.white.result, g.black.result, timeControl, timeClass,
          g.pgn, opening, openingName, ecoCode, new Date(g.end_time * 1000).toISOString(),
          termination
        );
```

For `uploadGames`, similarly:
```ts
        const terminationMatch = gamePgn.match(/\[Termination\s+"([^"]+)"\]/);
        const termination = terminationMatch ? terminationMatch[1] : null;
```

Change the `uploadGames` INSERT to:
```ts
  const insertGame = db.prepare(`
    INSERT OR IGNORE INTO games (
      uuid, white_username, black_username, user_color, result, pgn,
      opening_class, opening_name, eco, date, termination
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
```

And pass `termination` as the 11th argument in the `.run()` call.

**Step 4: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0.

**Step 5: Commit**

```bash
git add server/routes/games.ts
git commit -m "feat: store game_shape + termination when analysis is saved"
```

---

## Task 6: Time Display + Shape Badge in GameAnalysis.tsx

**Files:**
- Modify: `src/components/GameAnalysis.tsx`

**Context:** This file is large (~700 lines). You need to:
1. Add a **shape badge** in the game header bar (next to the player names/result chip)
2. Add **time per move** display in the notation panel (small secondary text per move)

**Step 1: Read the file first to understand its structure**

Before editing, read `src/components/GameAnalysis.tsx` to find:
- The game header section (where white/black usernames and result are shown)
- The notation move rendering section (where each `ReviewedMove` is rendered as a button/span)

**Step 2: Add the shape badge**

In the game header bar, after the result chip or player names, add:

```tsx
{/* Shape badge — only shown when analysis has been run */}
{game.game_shape && (() => {
  const SHAPE_COLORS: Record<string, string> = {
    Smooth:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    Balanced: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    Sharp:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
    Wild:     'bg-rose-500/15 text-rose-400 border-rose-500/30',
    Sudden:   'bg-orange-500/15 text-orange-400 border-orange-500/30',
    Giveaway: 'bg-red-500/15 text-red-400 border-red-500/30',
    Intense:  'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  };
  const color = SHAPE_COLORS[game.game_shape] ?? SHAPE_COLORS.Balanced;
  return (
    <span className={cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border', color)}>
      {game.game_shape}
    </span>
  );
})()}
```

Note: `game.game_shape` comes from the `GameRecord` type. You'll also need to add `game_shape?: string | null` to the `GameRecord` interface in `src/services/api.ts` — do this here as a small addition or leave it for Task 9 (both are fine).

**Step 3: Add time display in notation panel**

Find the notation move rendering. Each move renders the SAN annotation symbol and text. After (or below) the grade annotation, when `move.timeSpent` is defined, show a small time label:

```tsx
{/* Time info — only when PGN had %clk annotations */}
{move.clockRemaining !== undefined && (
  <span className={cn(
    'text-[8px] font-mono ml-1',
    move.underPressure ? 'text-orange-400' : 'text-slate-600',
  )}>
    {move.underPressure && '⏰'}
    {move.timeSpent !== undefined && `${Math.round(move.timeSpent)}s`}
    {' '}
    <span className="opacity-60">
      {formatClock(move.clockRemaining)}
    </span>
  </span>
)}
```

Add this helper function near the top of the component (outside the JSX):
```ts
function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
```

**Step 4: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0.

**Step 5: Commit**

```bash
git add src/components/GameAnalysis.tsx src/services/api.ts
git commit -m "feat: show game shape badge and clock display in analysis"
```

---

## Task 7: Rewrite Pattern Report Server Route

**Files:**
- Modify: `server/routes/patterns.ts`

**What to do:**

Replace the single `analyzePatterns` function (GET only, ephemeral) with two exports:
- `getPatternReport(req)` — reads cached report from `pattern_reports` table
- `runPatternAnalysis(req)` — collects rich stats, calls Gemini, stores result

The POST prompt includes: win rates by color, phase accuracy (error counts + avg cpLoss), opening breakdown (per `opening_class`), time management (avg time, blunders under pressure, games lost on time), and game shape distribution. **No individual move list.**

**Full replacement for `server/routes/patterns.ts`:**

```ts
import db from "../db";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// ── GET /api/analyze/patterns — return cached report ─────────────────────────
export function getPatternReport(_req: Request): Response {
  const row = db.query(
    `SELECT report_json, created_at FROM pattern_reports ORDER BY id DESC LIMIT 1`
  ).get() as { report_json: string; created_at: string } | null;

  if (!row) {
    return Response.json(null);
  }

  try {
    const report = JSON.parse(row.report_json);
    return Response.json({ ...report, createdAt: row.created_at });
  } catch {
    return Response.json(null);
  }
}

// ── POST /api/analyze/patterns — run new analysis and cache ───────────────────
export async function runPatternAnalysis(_req: Request): Promise<Response> {
  const games = db.query(
    `SELECT id, date, white_username, black_username, result, user_color,
            analysis_json, opening_class, time_control, termination, game_shape
     FROM games WHERE analysis_json IS NOT NULL ORDER BY date DESC LIMIT 100`
  ).all() as any[];

  if (games.length === 0) {
    return Response.json({
      summary: "No analyzed games found. Run analysis on your recent games first.",
      patterns: [],
      action: null,
      stats: buildEmptyStats(),
      openings: [],
      isError: false,
      createdAt: null,
    });
  }

  // ── 1. Win rates by color ──────────────────────────────────────────────────
  let whiteWins = 0, whiteDraws = 0, whiteLosses = 0;
  let blackWins = 0, blackDraws = 0, blackLosses = 0;

  for (const g of games) {
    if (g.user_color === 'white') {
      if (g.result === 'win') whiteWins++;
      else if (g.result === 'draw') whiteDraws++;
      else blackLosses++; // loss as white
    } else if (g.user_color === 'black') {
      if (g.result === 'win') blackWins++;
      else if (g.result === 'draw') blackDraws++;
      else blackLosses++;
    }
  }
  // Corrected: track losses by color
  whiteLosses = games.filter(g => g.user_color === 'white' && g.result === 'loss').length;
  blackLosses = games.filter(g => g.user_color === 'black' && g.result === 'loss').length;
  whiteWins = games.filter(g => g.user_color === 'white' && g.result === 'win').length;
  whiteDraws = games.filter(g => g.user_color === 'white' && g.result === 'draw').length;
  blackWins = games.filter(g => g.user_color === 'black' && g.result === 'win').length;
  blackDraws = games.filter(g => g.user_color === 'black' && g.result === 'draw').length;

  // ── 2. Phase accuracy + time management ───────────────────────────────────
  interface PhaseStats { errors: number; totalCpLoss: number; }
  const phases: Record<string, PhaseStats> = {
    opening: { errors: 0, totalCpLoss: 0 },
    middlegame: { errors: 0, totalCpLoss: 0 },
    endgame: { errors: 0, totalCpLoss: 0 },
  };

  let totalTimeSamplesWhite = 0, totalTimeWhite = 0;
  let totalTimeSamplesBlack = 0, totalTimeBlack = 0;
  let blundersUnderPressure = 0;
  let gamesLostOnTime = 0;

  // ── 3. Opening breakdown ───────────────────────────────────────────────────
  const openingMap: Record<string, { wins: number; draws: number; losses: number; total: number }> = {};

  // ── 4. Shape distribution ──────────────────────────────────────────────────
  const shapes: Record<string, number> = {};

  for (const g of games) {
    // Opening breakdown
    const opKey = g.opening_class || 'Other';
    if (!openingMap[opKey]) openingMap[opKey] = { wins: 0, draws: 0, losses: 0, total: 0 };
    openingMap[opKey].total++;
    if (g.result === 'win') openingMap[opKey].wins++;
    else if (g.result === 'draw') openingMap[opKey].draws++;
    else openingMap[opKey].losses++;

    // Shape distribution
    if (g.game_shape) shapes[g.game_shape] = (shapes[g.game_shape] ?? 0) + 1;

    // Games lost on time
    if (g.termination && /time/i.test(g.termination) && g.result === 'loss') {
      gamesLostOnTime++;
    }

    // Phase accuracy + time pressure
    let moves: any[];
    try { moves = JSON.parse(g.analysis_json); } catch { continue; }

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const moveNumber = Math.floor(i / 2) + 1;
      const phase = moveNumber <= 15 ? 'opening' : moveNumber <= 30 ? 'middlegame' : 'endgame';
      const isUserMove = g.user_color === 'white' ? i % 2 === 0 : i % 2 !== 0;

      if (isUserMove && (m.grade === 'blunder' || m.grade === 'mistake')) {
        phases[phase].errors++;
        phases[phase].totalCpLoss += m.cpLoss ?? 0;
        if (m.underPressure) blundersUnderPressure++;
      }

      // Time averages
      if (m.timeSpent !== undefined && m.timeSpent !== null) {
        const isWhiteMove = i % 2 === 0;
        if (isWhiteMove) { totalTimeSamplesWhite++; totalTimeWhite += m.timeSpent; }
        else { totalTimeSamplesBlack++; totalTimeBlack += m.timeSpent; }
      }
    }
  }

  const avgTimeWhite = totalTimeSamplesWhite > 0
    ? Math.round(totalTimeWhite / totalTimeSamplesWhite)
    : null;
  const avgTimeBlack = totalTimeSamplesBlack > 0
    ? Math.round(totalTimeBlack / totalTimeSamplesBlack)
    : null;

  const avgCpLoss = (phase: PhaseStats) =>
    phase.errors > 0 ? Math.round(phase.totalCpLoss / phase.errors) : 0;

  // ── Build stats object ─────────────────────────────────────────────────────
  const whiteTotal = whiteWins + whiteDraws + whiteLosses;
  const blackTotal = blackWins + blackDraws + blackLosses;

  const stats = {
    totalGames: games.length,
    gamesAnalyzed: games.length,
    whiteWins, whiteDraws, whiteLosses,
    blackWins, blackDraws, blackLosses,
    opening: phases.opening.errors,
    middlegame: phases.middlegame.errors,
    endgame: phases.endgame.errors,
    gamesLostOnTime,
    blundersUnderPressure,
    shapes,
    avgTimeWhite,
    avgTimeBlack,
  };

  // ── Opening table ──────────────────────────────────────────────────────────
  const openings = Object.entries(openingMap)
    .map(([name, d]) => ({
      name,
      games: d.total,
      winPct: d.total > 0 ? Math.round((d.wins / d.total) * 100) : 0,
      drawPct: d.total > 0 ? Math.round((d.draws / d.total) * 100) : 0,
      lossPct: d.total > 0 ? Math.round((d.losses / d.total) * 100) : 0,
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 10);

  // ── Call Gemini if API key available ───────────────────────────────────────
  if (!GEMINI_API_KEY) {
    const result = {
      summary: "Pattern analysis unavailable — set GEMINI_API_KEY in the server environment.",
      patterns: [],
      action: null,
      stats,
      openings,
      isError: true,
    };
    saveReport(result);
    return Response.json({ ...result, createdAt: new Date().toISOString() });
  }

  const winRateStr = [
    whiteTotal > 0
      ? `As White: ${whiteWins}W/${whiteDraws}D/${whiteLosses}L (${Math.round(whiteWins / whiteTotal * 100)}% win rate)`
      : null,
    blackTotal > 0
      ? `As Black: ${blackWins}W/${blackDraws}D/${blackLosses}L (${Math.round(blackWins / blackTotal * 100)}% win rate)`
      : null,
  ].filter(Boolean).join('\n');

  const phaseStr = [
    `Opening (moves 1-15): ${phases.opening.errors} errors, avg ${avgCpLoss(phases.opening)}cp lost`,
    `Middlegame (moves 16-30): ${phases.middlegame.errors} errors, avg ${avgCpLoss(phases.middlegame)}cp lost`,
    `Endgame (moves 31+): ${phases.endgame.errors} errors, avg ${avgCpLoss(phases.endgame)}cp lost`,
  ].join('\n');

  const topOpenings = openings.slice(0, 5)
    .map(o => `  ${o.name}: ${o.games} games, ${o.winPct}% win, ${o.lossPct}% loss`)
    .join('\n');

  const timeStr = avgTimeWhite !== null || avgTimeBlack !== null
    ? [
        avgTimeWhite !== null ? `Avg time/move as White: ${avgTimeWhite}s` : null,
        avgTimeBlack !== null ? `Avg time/move as Black: ${avgTimeBlack}s` : null,
        `Blunders made under time pressure: ${blundersUnderPressure}`,
        `Games lost on time: ${gamesLostOnTime}`,
      ].filter(Boolean).join('\n')
    : 'No clock data available.';

  const shapeStr = Object.entries(shapes)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `  ${s}: ${n}`)
    .join('\n') || 'No shape data yet.';

  const prompt = `You are a chess improvement coach analyzing ${games.length} games.

WIN RATES:
${winRateStr}

PHASE ACCURACY:
${phaseStr}

TOP OPENINGS:
${topOpenings}

TIME MANAGEMENT:
${timeStr}

GAME SHAPE DISTRIBUTION:
${shapeStr}

Based on this data, give a focused improvement report. Be specific and direct — no generic advice.

REQUIRED FORMAT (use these exact headings):
SUMMARY: [2-3 sentences on biggest weakness]
PATTERN_1: [First recurring issue]
PATTERN_2: [Second recurring issue]
PATTERN_3: [Third issue]
PATTERN_4: [Fourth issue, or N/A]
PATTERN_5: [Fifth issue, or N/A]
ACTION: [Single most impactful improvement focus]`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 700, temperature: 0.4 },
      }),
    });

    if (!res.ok) {
      const errResult = { summary: "Gemini API error.", patterns: [], action: null, stats, openings, isError: true };
      saveReport(errResult);
      return Response.json({ ...errResult, createdAt: new Date().toISOString() });
    }

    const data = (await res.json()) as any;
    const fullText: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const extract = (label: string, next?: string) => {
      const pattern = next
        ? new RegExp(`${label}:\\s*(.+?)(?=${next}:|$)`, "is")
        : new RegExp(`${label}:\\s*(.+?)$`, "is");
      return fullText.match(pattern)?.[1]?.trim() ?? null;
    };

    const summary = extract("SUMMARY", "PATTERN_1") ?? fullText.substring(0, 300);
    const patterns = [
      extract("PATTERN_1", "PATTERN_2"),
      extract("PATTERN_2", "PATTERN_3"),
      extract("PATTERN_3", "PATTERN_4"),
      extract("PATTERN_4", "PATTERN_5"),
      extract("PATTERN_5", "ACTION"),
    ]
      .filter((p): p is string => !!p && p.trim().toLowerCase() !== "n/a")
      .map((p) => p.replace(/^\[|\]$/g, "").trim());
    const action = extract("ACTION");

    const result = { summary, patterns, action, stats, openings, isError: false };
    saveReport(result);
    return Response.json({ ...result, createdAt: new Date().toISOString() });
  } catch {
    const errResult = { summary: "Pattern analysis unavailable — check your connection.", patterns: [], action: null, stats, openings, isError: true };
    saveReport(errResult);
    return Response.json({ ...errResult, createdAt: new Date().toISOString() });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEmptyStats() {
  return {
    totalGames: 0, gamesAnalyzed: 0,
    whiteWins: 0, whiteDraws: 0, whiteLosses: 0,
    blackWins: 0, blackDraws: 0, blackLosses: 0,
    opening: 0, middlegame: 0, endgame: 0,
    gamesLostOnTime: 0, blundersUnderPressure: 0,
    shapes: {} as Record<string, number>,
    avgTimeWhite: null as number | null,
    avgTimeBlack: null as number | null,
  };
}

function saveReport(report: object) {
  try {
    db.prepare(`INSERT INTO pattern_reports (report_json) VALUES (?)`).run(JSON.stringify(report));
    // Keep only the latest 5 rows
    db.query(`DELETE FROM pattern_reports WHERE id NOT IN (SELECT id FROM pattern_reports ORDER BY id DESC LIMIT 5)`).run();
  } catch (e) {
    console.warn("Failed to save pattern report:", e);
  }
}
```

**Step 2: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0.

**Step 3: Commit**

```bash
git add server/routes/patterns.ts
git commit -m "feat: persistent pattern report with GET cached / POST run analysis"
```

---

## Task 8: Update `server/index.ts` Routing

**Files:**
- Modify: `server/index.ts`

**What to do:**

The current import and routing only knows about `analyzePatterns`. Split it into GET (cached) and POST (run new).

**Step 1: Replace import**

Find:
```ts
import { analyzePatterns } from "./routes/patterns";
```

Replace with:
```ts
import { getPatternReport, runPatternAnalysis } from "./routes/patterns";
```

**Step 2: Replace routing block**

Find:
```ts
  // GET /api/analyze/patterns
  if (method === "GET" && segments[1] === "analyze" && segments[2] === "patterns") {
    return analyzePatterns(req);
  }
```

Replace with:
```ts
  // GET /api/analyze/patterns — return cached report
  if (method === "GET" && segments[1] === "analyze" && segments[2] === "patterns") {
    return getPatternReport(req);
  }

  // POST /api/analyze/patterns — run new analysis
  if (method === "POST" && segments[1] === "analyze" && segments[2] === "patterns") {
    return runPatternAnalysis(req);
  }
```

**Step 3: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0.

**Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: add POST /api/analyze/patterns route for running new analysis"
```

---

## Task 9: Frontend API Updates

**Files:**
- Modify: `src/services/api.ts`

**What to do:**

1. Extend `GameRecord` with `game_shape` and `termination`
2. Replace `PatternAnalysis` interface with the full expanded version
3. Replace `analyzePatterns()` with `getPatternReport()` and `runPatternAnalysis()`

**Step 1: Extend `GameRecord`**

Find the `GameRecord` interface and add two fields after `eco`:
```ts
  game_shape: string | null;
  termination: string | null;
```

**Step 2: Replace `PatternAnalysis` interface**

Find:
```ts
export interface PatternAnalysis {
  summary: string;
  patterns: string[];
  action: string | null;
  stats: {
    totalMistakes: number;
    gamesAnalyzed: number;
    opening: number;
    middlegame: number;
    endgame: number;
  };
  isError: boolean;
}
```

Replace with:
```ts
export interface PatternAnalysis {
  summary: string;
  patterns: string[];
  action: string | null;
  createdAt: string | null;
  stats: {
    totalGames: number;
    gamesAnalyzed: number;
    whiteWins: number;
    whiteDraws: number;
    whiteLosses: number;
    blackWins: number;
    blackDraws: number;
    blackLosses: number;
    opening: number;
    middlegame: number;
    endgame: number;
    gamesLostOnTime: number;
    blundersUnderPressure: number;
    shapes: Record<string, number>;
    avgTimeWhite: number | null;
    avgTimeBlack: number | null;
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

**Step 3: Replace the pattern API functions**

Find:
```ts
export async function analyzePatterns(): Promise<PatternAnalysis> {
  const res = await fetch('/api/analyze/patterns');
  if (!res.ok) throw new Error('Failed to analyze patterns');
  return res.json();
}
```

Replace with:
```ts
export async function getPatternReport(): Promise<PatternAnalysis | null> {
  const res = await fetch('/api/analyze/patterns');
  if (!res.ok) throw new Error('Failed to fetch pattern report');
  return res.json(); // null if never run
}

export async function runPatternAnalysis(): Promise<PatternAnalysis> {
  const res = await fetch('/api/analyze/patterns', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to run pattern analysis');
  return res.json();
}
```

**Step 4: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0. If `InsightsTab.tsx` still calls `analyzePatterns`, the compile will catch it — fix those references now (Task 11 will fully rewrite the panel, but remove the broken call to prevent compile errors).

**Step 5: Commit**

```bash
git add src/services/api.ts
git commit -m "feat: update PatternAnalysis interface + split GET/POST pattern API functions"
```

---

## Task 10: Opening Breakdown + Time Pressure Stat Card in InsightsTab

**Files:**
- Modify: `src/components/InsightsTab.tsx`

**What to do:**

Add two new sections to `InsightsTab` (below the existing Repertoire Coverage bar):
1. A **5th stat card** — "Time Pressure" showing `blundersUnderPressure` count
2. An **Opening Breakdown** table section

These sections read from the cached pattern report. Load it on mount via `getPatternReport()`.

**Step 1: Add state for the pattern report in `InsightsTab`**

After the existing `stats` state, add:
```ts
  const [patternReport, setPatternReport] = useState<api.PatternAnalysis | null>(null);

  useEffect(() => {
    api.getPatternReport()
      .then(r => setPatternReport(r))
      .catch(() => {});
  }, []);
```

**Step 2: Add Time Pressure stat card**

Change the stats grid from `md:grid-cols-4` to `md:grid-cols-5` (or keep 4 on small screens), and add a 5th card:

```tsx
<StatCard
  label="Time Pressure"
  value={patternReport?.stats.blundersUnderPressure ?? '—'}
  icon={<Clock size={16} />}
  color="text-orange-400"
  bg="bg-orange-500/10"
  hint="Mistakes under pressure"
/>
```

Add `Clock` to the lucide-react import at the top.

**Step 3: Add Opening Breakdown section**

Below the Repertoire Coverage section, add:

```tsx
{/* Opening Breakdown */}
{patternReport?.openings && patternReport.openings.length > 0 && (
  <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-5">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <BookOpen size={14} className="text-emerald-400" />
        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Opening Breakdown</span>
      </div>
      <span className="text-[10px] text-slate-600 font-bold">last {patternReport.stats.gamesAnalyzed} games</span>
    </div>
    <div className="space-y-2.5">
      {patternReport.openings.map(op => (
        <div key={op.name}>
          <div className="flex justify-between mb-1">
            <span className="text-xs text-slate-400 truncate pr-4">{op.name}</span>
            <div className="flex items-center gap-2 shrink-0 text-[10px] font-bold">
              <span className="text-emerald-400">{op.winPct}%W</span>
              <span className="text-slate-500">{op.drawPct}%D</span>
              <span className="text-rose-400">{op.lossPct}%L</span>
              <span className="text-slate-600">({op.games}g)</span>
            </div>
          </div>
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden flex">
            <div className="h-full bg-emerald-600" style={{ width: `${op.winPct}%` }} />
            <div className="h-full bg-slate-600" style={{ width: `${op.drawPct}%` }} />
            <div className="h-full bg-rose-600" style={{ width: `${op.lossPct}%` }} />
          </div>
        </div>
      ))}
    </div>
    {patternReport.openings.length === 0 && (
      <p className="text-xs text-slate-600 text-center py-4">Analyse more games to see opening stats</p>
    )}
  </div>
)}
```

Add `BookOpen` to the lucide-react import.

**Step 4: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0.

**Step 5: Commit**

```bash
git add src/components/InsightsTab.tsx
git commit -m "feat: add time pressure stat card and opening breakdown to InsightsTab"
```

---

## Task 11: Persistent Pattern Report UI + Shape Distribution

**Files:**
- Modify: `src/components/InsightsTab.tsx`

**What to do:**

Replace the current ephemeral `PatternPanel` component with a persistent version that:
- Loads the cached report on mount (no spinner on first open if report exists)
- Shows "last run X ago" in the header
- Has a compact stats row (white/black win rates + phase breakdown)
- Keeps the AI narrative + patterns + action sections
- Has a Re-run button that calls `runPatternAnalysis()`

Also add a **Game Shape Distribution** section above the Pattern Report.

**Step 1: Add shape distribution section**

Below the Opening Breakdown section, add:

```tsx
{/* Game Shape Distribution */}
{patternReport?.stats.shapes && Object.keys(patternReport.stats.shapes).length > 0 && (
  <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-5">
    <div className="flex items-center gap-2 mb-4">
      <Activity size={14} className="text-amber-400" />
      <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">Game Shape Distribution</span>
    </div>
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2">
      {(['Smooth', 'Balanced', 'Sharp', 'Wild', 'Sudden', 'Giveaway', 'Intense'] as const).map(shape => {
        const count = patternReport.stats.shapes[shape] ?? 0;
        const COLORS: Record<string, string> = {
          Smooth: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
          Balanced: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
          Sharp: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
          Wild: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
          Sudden: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
          Giveaway: 'text-red-400 bg-red-500/10 border-red-500/20',
          Intense: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
        };
        return (
          <div
            key={shape}
            className={cn(
              'border rounded-xl py-2 px-1 text-center',
              count > 0 ? COLORS[shape] : 'text-slate-700 bg-white/[0.02] border-white/5',
            )}
            title={shape}
          >
            <p className="text-lg font-black">{count}</p>
            <p className="text-[8px] uppercase tracking-wide font-bold opacity-70 truncate px-0.5">{shape}</p>
          </div>
        );
      })}
    </div>
  </div>
)}
```

Add `Activity` to the lucide-react import.

**Step 2: Rewrite `PatternPanel` as a persistent component**

The `PatternPanel` component needs access to `patternReport` state and a `runAnalysis` callback. The cleanest approach: move it to a self-contained local component that receives props.

Replace the entire `PatternPanel` component definition with:

```tsx
const PatternPanel: React.FC<{
  cached: api.PatternAnalysis | null;
  onRerun: (result: api.PatternAnalysis) => void;
}> = ({ cached, onRerun }) => {
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const data = await api.runPatternAnalysis();
      onRerun(data);
    } catch {
      onRerun({
        summary: 'Analysis unavailable — make sure the backend is running.',
        patterns: [],
        action: null,
        createdAt: null,
        stats: {
          totalGames: 0, gamesAnalyzed: 0,
          whiteWins: 0, whiteDraws: 0, whiteLosses: 0,
          blackWins: 0, blackDraws: 0, blackLosses: 0,
          opening: 0, middlegame: 0, endgame: 0,
          gamesLostOnTime: 0, blundersUnderPressure: 0,
          shapes: {}, avgTimeWhite: null, avgTimeBlack: null,
        },
        openings: [],
        isError: true,
      });
    } finally {
      setRunning(false);
    }
  };

  // No cached report — show run prompt
  if (!cached && !running) {
    return (
      <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-6 flex flex-col items-center gap-4 text-center">
        <div className="w-12 h-12 bg-violet-500/10 rounded-full flex items-center justify-center">
          <Brain size={24} className="text-violet-400" />
        </div>
        <div>
          <p className="font-bold text-slate-200 text-sm">Pattern Recognition</p>
          <p className="text-slate-500 text-xs mt-1 max-w-xs">
            AI analysis of recurring weaknesses across all your analyzed games. Results are saved until you re-run.
          </p>
        </div>
        <button
          onClick={run}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
        >
          <Sparkles size={14} /> Run Analysis
        </button>
      </div>
    );
  }

  if (running) {
    return (
      <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-8 flex flex-col items-center gap-3">
        <Loader2 size={28} className="text-violet-400 animate-spin" />
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest animate-pulse">
          Analysing patterns…
        </p>
      </div>
    );
  }

  if (!cached) return null;

  // Format "last run X ago"
  const timeAgo = cached.createdAt ? formatTimeAgo(cached.createdAt) : null;

  return (
    <div className="bg-[#0d1117] border border-white/5 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/5 bg-[#080a0f] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-violet-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-violet-400">Pattern Report</span>
        </div>
        <div className="flex items-center gap-3">
          {timeAgo && <span className="text-[10px] text-slate-600">last run {timeAgo}</span>}
          <button
            onClick={run}
            disabled={running}
            className="text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
            title="Re-run analysis"
          >
            <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Win rate + phase row */}
        {cached.stats && (
          <div className="grid grid-cols-2 gap-3">
            {/* Win rates */}
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Win Rates</p>
              {cached.stats.whiteWins + cached.stats.whiteDraws + cached.stats.whiteLosses > 0 && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">As White</span>
                  <div className="flex gap-1.5">
                    <span className="text-emerald-400 font-bold">{cached.stats.whiteWins}W</span>
                    <span className="text-slate-500">{cached.stats.whiteDraws}D</span>
                    <span className="text-rose-400 font-bold">{cached.stats.whiteLosses}L</span>
                  </div>
                </div>
              )}
              {cached.stats.blackWins + cached.stats.blackDraws + cached.stats.blackLosses > 0 && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">As Black</span>
                  <div className="flex gap-1.5">
                    <span className="text-emerald-400 font-bold">{cached.stats.blackWins}W</span>
                    <span className="text-slate-500">{cached.stats.blackDraws}D</span>
                    <span className="text-rose-400 font-bold">{cached.stats.blackLosses}L</span>
                  </div>
                </div>
              )}
            </div>
            {/* Phase breakdown */}
            <div className="grid grid-rows-3 gap-1">
              {[
                { label: 'Opening', value: cached.stats.opening, color: 'text-amber-400' },
                { label: 'Middlegame', value: cached.stats.middlegame, color: 'text-orange-400' },
                { label: 'Endgame', value: cached.stats.endgame, color: 'text-rose-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white/[0.02] border border-white/5 rounded-lg px-3 flex items-center justify-between">
                  <p className="text-[9px] text-slate-600 uppercase tracking-wide font-bold">{label}</p>
                  <p className={cn('text-sm font-black', color)}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <p className={cn('text-sm leading-relaxed', cached.isError ? 'text-rose-400' : 'text-slate-300')}>
          {cached.summary}
        </p>

        {/* Patterns */}
        {cached.patterns.length > 0 && (
          <div className="space-y-2">
            {cached.patterns.map((p, i) => (
              <div key={i} className="flex items-start gap-2.5 bg-violet-500/5 border border-violet-500/15 rounded-xl px-3 py-2.5">
                <AlertTriangle size={13} className="text-violet-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-300 leading-relaxed">{p}</p>
              </div>
            ))}
          </div>
        )}

        {/* Action */}
        {cached.action && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <Target size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500 mb-1">Recommended Focus</p>
              <p className="text-xs text-slate-300 leading-relaxed">{cached.action}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
```

Add this helper above the `PatternPanel` component:
```ts
function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
```

**Step 3: Update `PatternPanel` usage in `InsightsTab`**

Find:
```tsx
{/* Pattern Recognition */}
<PatternPanel />
```

Replace with:
```tsx
{/* Pattern Recognition */}
<PatternPanel
  cached={patternReport}
  onRerun={(result) => setPatternReport(result)}
/>
```

**Step 4: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```
Expected: exits 0.

**Step 5: Commit**

```bash
git add src/components/InsightsTab.tsx
git commit -m "feat: persistent pattern report UI with shape distribution in InsightsTab"
```

---

## Final Verification

After all 11 tasks are complete:

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```

Then do a full test:
1. Start backend: `cd server && bun run dev`
2. Start frontend: `npm run dev`
3. Go to a game with analysis → notation shows clock times (if PGN has `%clk`)
4. Go to Insights → Opening Breakdown and shape grid visible (if pattern report was run)
5. Pattern Report: click Re-run → shows spinner → report appears → persists on reload
6. Rescan a game → check DB: `game_shape` column populated

```bash
# Quick DB check
sqlite3 "/Users/kevin/Chess Trainer/server/chess_trainer.db" \
  "SELECT id, game_shape, termination FROM games WHERE analysis_json IS NOT NULL LIMIT 5;"
```
