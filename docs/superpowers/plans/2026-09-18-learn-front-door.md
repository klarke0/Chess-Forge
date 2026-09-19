# Learn Front Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-tap "Next lesson" — the server picks the highest-value unlearned book line (reality-ranked, quarantine-filtered), the client teaches it through a watch → guided → blind ladder, and passing blind promotes the line's decision positions into SM-2.

**Architecture:** A server-side line enumerator walks the `positions` tree root→leaf (normalizing `next_fen` on every link — fen is 4-field, next_fen is 6-field). A ranking layer scores lines by real-game frequency (game_positions + deviations placement hits), filters out lines containing engine-flagged Kevin-side moves, and orders by ladder progress. Two routes serve it: `GET /api/v2/learn/next` (the lesson card + full line payload) and `POST /api/v2/learn/complete` (ladder advancement + blind-pass promotion into `progress`). The client adds `LearnScreen` (three stages sharing one board) and a HomeScreen card.

**Tech Stack:** Bun server, chess.js, React/TS client, BOARD_THEME from src/design/tokens.ts, react-chessboard.

**Spec:** `docs/superpowers/specs/2026-09-17-learn-mode-realignment-design.md` (Pillars 2 + 3, quarantine from Pillar 1)

## Global Constraints

- **FEN discipline:** `positions.fen` is 4-field normalized; `positions.next_fen` is FULL 6-field. Every tree link resolves via `normalizeFen(next_fen)`. Client-facing FENs ship 6-field via `ensureFullFen`.
- **Quarantine:** a line is excluded when ANY of its Kevin-side (fen, san) pairs has `book_audit.verdict = 'flagged'`. Gray/ok/ok_masters/unaudited all pass (course-trusted ruling, 2026-09-17).
- **Lesson unit:** one root→leaf line. Kevin's decisions = positions where side-to-move equals `repertoires.side`.
- **Ladder:** stage 0 none → 1 watch done → 2 guided done → 3 blind passed. Blind pass = zero mistakes on Kevin's moves (retries allowed, each retry is a fresh attempt).
- **Promotion:** on blind pass, `INSERT OR IGNORE INTO progress` one row per Kevin-decision FEN (defaults: EF 2.5, interval 0, next_review NULL) — they flow into Train Now's review source organically. ≤ ~15 rows per line, well inside drill-pool freshness ratios.
- **Ranking:** frequency score (how often Kevin's games reach the line's positions) DESC, then chapter `sort_order` ASC (course order), then shorter lines first. Fully learned lines (stage 3) are excluded from "next"; if ALL lines are stage 3, return the least-recently-completed for refresh.
- **Line identity:** `line_key` = first 16 hex chars of SHA-256 over the joined SAN sequence. Stable across restarts; orphaned by book edits (acceptable — stale learn_state rows are inert).
- Server: `ok()`/`err()` envelope, `bun test server/tests/` green, `npm run typecheck:server` clean. Client: forge-* tokens, cn(), lucide-react, `npx tsc --noEmit` + eslint clean, `./dev.sh build` exit 0. No backend restarts inside implementer tasks.

---

### Task 1: Line enumerator + ranking core (server/utils/lines.ts)

**Files:**
- Create: `server/utils/lines.ts`
- Test: `server/tests/lines.test.ts`

**Interfaces:**
- Consumes: `db` (default export), `normalizeFen` (server/utils/fen.ts).
- Produces (Task 2 imports these exact names):
  ```typescript
  export interface LineMove {
    fen: string;        // 6-field, position before the move
    san: string;
    comment: string | null;
    isKevinMove: boolean;
  }
  export interface BookLine {
    lineKey: string;          // 16-hex SHA-256 prefix of SAN sequence
    chapterId: number | null; // chapter whose first_fen the line passes through, if any
    chapterName: string | null;
    moves: LineMove[];
    kevinMoveCount: number;
    quarantined: boolean;     // contains a flagged Kevin-side move
  }
  export function enumerateLines(repertoireId: number, maxLines?: number): BookLine[]
  export function frequencyScore(line: BookLine, placementCounts: Map<string, number>): number
  export function buildPlacementCounts(repertoireId: number): Map<string, number>
  ```

- [ ] **Step 1: Write the failing tests**

```typescript
// server/tests/lines.test.ts
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import db from "../db";
import { enumerateLines, frequencyScore } from "../utils/lines";
import type { BookLine } from "../utils/lines";

const REP = 998; // scratch repertoire

beforeAll(() => {
  db.query("DELETE FROM positions WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM book_audit WHERE repertoire_id = ?").run(REP);
  db.query(
    "INSERT OR IGNORE INTO repertoires (id, name, side) VALUES (?, 'ScratchLines', 'white')",
  ).run(REP);
  // Tiny tree: 1.e4 (Kevin) -> 1...e5 -> 2.Nf3 (leaf)  and  1...c5 -> 2.Nc3 (leaf)
  // fen column: 4-field. next_fen column: SIX-field (mirrors production data).
  const rows = [
    // start -> e4
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "e4",
     "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", "the king's pawn"],
    // after e4: e5
    ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3", "e5",
     "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2", null],
    // after e4: c5
    ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3", "c5",
     "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2", null],
    // after e5: Nf3 (Kevin, leaf)
    ["rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6", "Nf3",
     "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2", null],
    // after c5: Nc3 (Kevin, leaf)
    ["rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6", "Nc3",
     "rnbqkbnr/pp1ppppp/8/2p5/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 2", null],
  ];
  const ins = db.prepare(
    "INSERT INTO positions (repertoire_id, fen, san, next_fen, comment) VALUES (?, ?, ?, ?, ?)",
  );
  for (const [fen, san, next, comment] of rows) ins.run(REP, fen, san, next, comment);
});

afterAll(() => {
  db.query("DELETE FROM positions WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM book_audit WHERE repertoire_id = ?").run(REP);
});

describe("enumerateLines", () => {
  test("walks 4-field fen -> 6-field next_fen links and finds both root-to-leaf lines", () => {
    const lines = enumerateLines(REP);
    expect(lines.length).toBe(2);
    const sanPaths = lines.map((l) => l.moves.map((m) => m.san).join(" ")).sort();
    expect(sanPaths).toEqual(["e4 c5 Nc3", "e4 e5 Nf3"]);
  });

  test("marks Kevin's moves (white) and counts them", () => {
    const lines = enumerateLines(REP);
    for (const l of lines) {
      expect(l.moves[0].isKevinMove).toBe(true);   // e4
      expect(l.moves[1].isKevinMove).toBe(false);  // reply
      expect(l.kevinMoveCount).toBe(2);
      expect(l.moves[0].comment).toBe("the king's pawn");
      expect(l.moves[0].fen.split(" ").length).toBe(6); // client-facing 6-field
    }
  });

  test("stable lineKey: 16 hex chars, differs between lines", () => {
    const [a, b] = enumerateLines(REP);
    expect(a.lineKey).toMatch(/^[0-9a-f]{16}$/);
    expect(a.lineKey).not.toBe(b.lineKey);
    expect(enumerateLines(REP).find((l) => l.lineKey === a.lineKey)).toBeTruthy();
  });

  test("quarantines a line containing a flagged Kevin-side move", () => {
    db.prepare(
      `INSERT INTO book_audit (repertoire_id, fen, san, depth, loss_cp, verdict)
       VALUES (?, ?, ?, 14, 300, 'flagged')`,
    ).run(REP, "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6", "Nf3");
    const lines = enumerateLines(REP);
    const bad = lines.find((l) => l.moves.some((m) => m.san === "Nf3"));
    const good = lines.find((l) => l.moves.some((m) => m.san === "Nc3"));
    expect(bad!.quarantined).toBe(true);
    expect(good!.quarantined).toBe(false);
  });
});

describe("frequencyScore", () => {
  test("sums placement hits over the line's first positions", () => {
    const lines = enumerateLines(REP);
    const line = lines.find((l) => l.moves.some((m) => m.san === "Nf3"))!;
    const counts = new Map<string, number>();
    // placement key of the position before e5 (after 1.e4)
    counts.set("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR", 5);
    expect(frequencyScore(line, counts)).toBeGreaterThanOrEqual(5);
    expect(frequencyScore(line, new Map())).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/tests/lines.test.ts` — FAIL, cannot resolve `../utils/lines`.

- [ ] **Step 3: Implement**

```typescript
// server/utils/lines.ts
import { createHash } from "crypto";
import db from "../db";
import { normalizeFen } from "./fen";

export interface LineMove {
  fen: string;
  san: string;
  comment: string | null;
  isKevinMove: boolean;
}

export interface BookLine {
  lineKey: string;
  chapterId: number | null;
  chapterName: string | null;
  moves: LineMove[];
  kevinMoveCount: number;
  quarantined: boolean;
}

const START_FEN_4 = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

function ensureFullFen(fen: string): string {
  return fen.split(" ").length >= 6 ? fen : `${fen} 0 1`;
}

/**
 * Enumerate root->leaf lines through the positions tree.
 * CRITICAL: positions.fen is 4-field; positions.next_fen is 6-field. Links
 * resolve via normalizeFen(next_fen). Transposition-safe via a per-path
 * visited set; total output capped by maxLines.
 */
export function enumerateLines(repertoireId: number, maxLines = 500): BookLine[] {
  const side = (
    db.query("SELECT side FROM repertoires WHERE id = ?").get(repertoireId) as
      | { side: string }
      | null
  )?.side ?? "white";
  const kevinColor = side === "white" ? "w" : "b";

  const rows = db
    .query(
      "SELECT fen, san, next_fen, comment FROM positions WHERE repertoire_id = ? ORDER BY is_main_line DESC, depth ASC, san ASC",
    )
    .all(repertoireId) as { fen: string; san: string; next_fen: string; comment: string | null }[];

  const byFen = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = normalizeFen(r.fen);
    if (!byFen.has(key)) byFen.set(key, []);
    byFen.get(key)!.push(r);
  }

  const flagged = new Set(
    (
      db
        .query(
          "SELECT fen, san FROM book_audit WHERE repertoire_id = ? AND verdict = 'flagged'",
        )
        .all(repertoireId) as { fen: string; san: string }[]
    ).map((r) => `${normalizeFen(r.fen)}|${r.san}`),
  );

  const chapters = db
    .query(
      "SELECT id, name, first_fen FROM chapters WHERE repertoire_id = ? ORDER BY sort_order",
    )
    .all(repertoireId) as { id: number; name: string; first_fen: string }[];
  const chapterByFen = new Map(
    chapters.map((c) => [normalizeFen(c.first_fen), c]),
  );

  const out: BookLine[] = [];
  const walk = (
    fenKey: string,
    path: LineMove[],
    visited: Set<string>,
    chapter: { id: number; name: string } | null,
    hasFlagged: boolean,
  ) => {
    if (out.length >= maxLines) return;
    const moves = byFen.get(fenKey);
    const chapterHere = chapterByFen.get(fenKey);
    const chap = chapterHere ? { id: chapterHere.id, name: chapterHere.name } : chapter;
    if (!moves || moves.length === 0) {
      if (path.length >= 2) {
        const sans = path.map((m) => m.san).join(" ");
        out.push({
          lineKey: createHash("sha256").update(sans).digest("hex").slice(0, 16),
          chapterId: chap?.id ?? null,
          chapterName: chap?.name ?? null,
          moves: path,
          kevinMoveCount: path.filter((m) => m.isKevinMove).length,
          quarantined: hasFlagged,
        });
      }
      return;
    }
    for (const mv of moves) {
      const nextKey = normalizeFen(mv.next_fen);
      if (visited.has(nextKey)) continue; // cycle guard
      const sideToMove = fenKey.split(" ")[1];
      const isKevin = sideToMove === kevinColor;
      const move: LineMove = {
        fen: ensureFullFen(mv.fen),
        san: mv.san,
        comment: mv.comment,
        isKevinMove: isKevin,
      };
      const flaggedHere = isKevin && flagged.has(`${fenKey}|${mv.san}`);
      walk(
        nextKey,
        [...path, move],
        new Set(visited).add(nextKey),
        chap,
        hasFlagged || flaggedHere,
      );
      if (out.length >= maxLines) return;
    }
  };

  const roots = new Set<string>([normalizeFen(START_FEN_4)]);
  for (const c of chapters) roots.add(normalizeFen(c.first_fen));
  // Only walk roots that actually have moves and are not mid-tree duplicates of
  // the start walk: start position first, then chapter roots not reachable
  // from it (disconnected chapter subtrees).
  const startKey = normalizeFen(START_FEN_4);
  walk(startKey, [], new Set([startKey]), null, false);
  const coveredFens = new Set(out.flatMap((l) => l.moves.map((m) => normalizeFen(m.fen))));
  for (const c of chapters) {
    const key = normalizeFen(c.first_fen);
    if (key !== startKey && !coveredFens.has(key) && byFen.has(key)) {
      walk(key, [], new Set([key]), { id: c.id, name: c.name }, false);
    }
  }
  return out;
}

/** Placement (board-only) occurrence counts from Kevin's real games + deviations. */
export function buildPlacementCounts(repertoireId: number): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (fen: string | null) => {
    if (!fen) return;
    const placement = fen.split(" ")[0];
    counts.set(placement, (counts.get(placement) ?? 0) + 1);
  };
  const gp = db
    .query("SELECT fen_before FROM game_positions")
    .all() as { fen_before: string | null }[];
  for (const r of gp) bump(r.fen_before);
  const devs = db
    .query("SELECT fen FROM deviations WHERE repertoire_id = ?")
    .all(repertoireId) as { fen: string }[];
  for (const r of devs) bump(r.fen);
  return counts;
}

/** Sum of placement hits over the line's first 12 positions (opening-weighted). */
export function frequencyScore(
  line: BookLine,
  placementCounts: Map<string, number>,
): number {
  let score = 0;
  for (const m of line.moves.slice(0, 12)) {
    score += placementCounts.get(m.fen.split(" ")[0]) ?? 0;
  }
  return score;
}
```

- [ ] **Step 4: Run tests** — `bun test server/tests/lines.test.ts` all pass; then `bun test server/tests/` (no regressions) and `npm run typecheck:server`.

- [ ] **Step 5: Sanity-run against real data** (read-only): `bun -e 'import {enumerateLines} from "./server/utils/lines"; for (const rep of [2,3]) { const t0=Date.now(); const l=enumerateLines(rep); console.log("rep",rep,":",l.length,"lines,",l.filter(x=>x.quarantined).length,"quarantined,",Date.now()-t0,"ms"); }'` — record the numbers in your report. If rep 3 hits the 500 cap or takes >5s, note it (Task 2 caches).

- [ ] **Step 6: Commit**

```bash
git add server/utils/lines.ts server/tests/lines.test.ts
git commit -m "feat(learn): book line enumerator with quarantine and frequency scoring"
```

---

### Task 2: learn_state migration + learn routes (next / complete / promotion)

**Files:**
- Modify: `server/db.ts` (learn_state table)
- Create: `server/routes/v2_learn.ts`
- Modify: `server/index.ts` (wire GET /api/v2/learn/next, POST /api/v2/learn/complete)
- Test: `server/tests/learn_routes.test.ts`

**Interfaces:**
- Consumes: `enumerateLines`, `buildPlacementCounts`, `frequencyScore` (Task 1), `db`, `ok`/`err`, `normalizeFen`.
- Produces (client consumes): 
  `GET /api/v2/learn/next?repertoireId=N` → `ok({ lesson: { lineKey, chapterName, stage, moves: LineMove[], kevinMoveCount, frequency, estMinutes } | null, totals: { lines, learned, quarantined } })` — stage = current ladder stage (0-3) of THIS line; `estMinutes = Math.max(2, Math.round(kevinMoveCount / 3))`.
  `POST /api/v2/learn/complete` body `{repertoireId, lineKey, stage: 1|2|3, passed: boolean}` → advances learn_state to `stage` when passed && stage > stored; on stage 3 pass, promotes Kevin-decision FENs into progress; → `ok({ newStage, promoted })`.
  Exported for tests: `pickNextLesson(repertoireId): ...` and `completeLesson(repertoireId, lineKey, stage, passed)` pure-ish helpers; module-level 60s cache of enumerateLines keyed by repertoireId (invalidated by completeLesson).

- [ ] **Step 1: Migration** — in `server/db.ts` next to the other CREATE TABLEs:

```typescript
  // Learn-mode ladder state, one row per (repertoire, line). line_key is a
  // hash of the SAN path — book edits orphan rows harmlessly.
  db.query(
    `CREATE TABLE IF NOT EXISTS learn_state (
    repertoire_id INTEGER NOT NULL,
    line_key TEXT NOT NULL,
    stage INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (repertoire_id, line_key)
  )`,
  ).run();
```

- [ ] **Step 2: Failing tests** — reuse the Task 1 scratch-tree pattern (REP 998, same beforeAll/afterAll inserts; also clean `learn_state` and `progress` for REP). Tests:

```typescript
// server/tests/learn_routes.test.ts  (setup mirrors lines.test.ts — same tree)
import { pickNextLesson, completeLesson } from "../routes/v2_learn";

test("pickNextLesson returns an unlearned line with stage 0", () => {
  const r = pickNextLesson(REP);
  expect(r.lesson).not.toBeNull();
  expect(r.lesson!.stage).toBe(0);
  expect(r.totals.lines).toBe(2);
});

test("completeLesson advances stages monotonically and only on pass", () => {
  const key = pickNextLesson(REP).lesson!.lineKey;
  expect(completeLesson(REP, key, 1, true).newStage).toBe(1);
  expect(completeLesson(REP, key, 1, true).newStage).toBe(1); // repeat no-op
  expect(completeLesson(REP, key, 3, false).newStage).toBe(1); // fail: no advance
  expect(completeLesson(REP, key, 2, true).newStage).toBe(2);
});

test("blind pass (stage 3) promotes Kevin-decision FENs into progress", () => {
  const key = pickNextLesson(REP).lesson!.lineKey;
  const res = completeLesson(REP, key, 3, true);
  expect(res.newStage).toBe(3);
  expect(res.promoted).toBe(2); // two Kevin moves in the scratch line
  const rows = db.query("SELECT COUNT(*) c FROM progress WHERE repertoire_id = ?").get(REP) as {c:number};
  expect(rows.c).toBe(2);
  // idempotent: re-pass doesn't duplicate
  expect(completeLesson(REP, key, 3, true).promoted).toBe(0);
});

test("learned lines drop out of pickNextLesson; quarantined never appear", () => {
  // mark line A learned, flag line B's Kevin move -> next returns refresh pick (least-recent stage-3) not the flagged one
  // (insert flag as in lines.test.ts, then:)
  const r = pickNextLesson(REP);
  expect(r.lesson === null || r.lesson.moves.every((m) => m.san !== "Nf3")).toBe(true);
});
```

(Write these as real runnable tests with the full setup; keep assertions as above.)

- [ ] **Step 3: Implement `server/routes/v2_learn.ts`** — pickNextLesson: enumerate (cached 60s), drop quarantined, join learn_state, filter stage < 3; rank by `frequencyScore` DESC then chapter sort order (chapterId ASC nulls-last) then `moves.length` ASC; if none unlearned, return least-recently-`completed_at` stage-3 line (refresh). completeLesson: monotonic stage upsert; on stage 3 && passed, `INSERT OR IGNORE INTO progress (repertoire_id, fen, total_attempts, correct_attempts, streak) VALUES (?, normalizeFen(kevin fen), 0, 0, 0)` per Kevin move, count `changes()` sum as promoted; bust the cache. Route handlers wrap these with ok()/err() + input validation (400 on missing repertoireId/lineKey/bad stage). Wire both routes in server/index.ts following the /api/v2/audit/* dispatch pattern.

- [ ] **Step 4: Run** `bun test server/tests/` (all suites) + `npm run typecheck:server` — green.

- [ ] **Step 5: Commit** — `git add server/db.ts server/routes/v2_learn.ts server/index.ts server/tests/learn_routes.test.ts && git commit -m "feat(learn): learn_state ladder, next-lesson picker, blind-pass promotion"`

---

### Task 3: LearnScreen (watch → guided → blind)

**Files:**
- Create: `src/v2/LearnScreen.tsx`
- Modify: `src/services/api.ts` (typed `getNextLesson(repertoireId)`, `completeLesson(...)` through `request<T>`)

**Interfaces:**
- Consumes: the Task 2 payload exactly (`lesson.moves: {fen, san, comment, isKevinMove}[]`, `lesson.stage`, `lineKey`). `BOARD_THEME` from `src/design/tokens.ts` spread onto `<Chessboard>`; `cn()`; lucide-react icons; chess.js for move application.
- Produces: `export const LearnScreen: React.FC<{ onBack: () => void }>` (repertoire comes from the same store HomeScreen uses — grep how RepertoireRunScreen gets `repertoireSide`/active repertoire and mirror it).

- [ ] **Step 1: Screen skeleton + data load** — on mount call `getNextLesson`; render states: loading / no-lesson (all learned + none to refresh: celebratory empty state) / lesson. Lesson header: chapter name, SAN preview of first 3 moves, stage stepper (Watch ▸ Guided ▸ Blind with the current stage highlighted), frequency note ("seen in your games N times" when frequency > 0), estMinutes.
- [ ] **Step 2: Stage WATCH** — auto-play the line on the board: apply moves sequentially with ~1.2s cadence (chess.js from moves[0].fen), pausing 2.5s on moves that carry a `comment` and showing the comment in a coach-style caption card; Kevin's moves get a green square highlight, opponent moves neutral. Controls: pause/resume, restart, skip-to-guided. On reaching the end → POST complete(stage 1, passed true) → advance UI to guided.
- [ ] **Step 3: Stage GUIDED** — Kevin plays his side (drag on board), opponent auto-replies from the line after 500ms. A persistent "Hint" button shows an arrow for the correct move (BOARD_THEME-consistent color); wrong drops shake + show the correct move after the 2nd miss and auto-play it. Mistakes don't block progression. Line end → POST complete(stage 2, true) → blind.
- [ ] **Step 4: Stage BLIND** — same loop, no hints; ANY wrong Kevin move = fail: show "line broken — again?" retry state (restart the blind stage). Zero-mistake completion → POST complete(stage 3, true) → success state showing "N positions promoted to your drill rotation" from the response, with "Next lesson" (re-fetch) and "Done" (onBack) buttons.
- [ ] **Step 5: Shared board mechanics** — one `<Chessboard>` instance, `{...BOARD_THEME}`, boardOrientation from repertoire side, `arePiecesDraggable` only in guided/blind on Kevin's turn. Reuse RepertoireRunScreen's onDrop/shake patterns (read that file; keep its revealMode-style freezes if you add timed reveals). No timer in Learn mode.
- [ ] **Step 6: Verify** — `npx tsc --noEmit` clean; `npx eslint src/v2/LearnScreen.tsx src/services/api.ts` no errors; `./dev.sh build` exit 0. NO restart.
- [ ] **Step 7: Commit** — `git add src/v2/LearnScreen.tsx src/services/api.ts && git commit -m "feat(learn): LearnScreen watch/guided/blind ladder"`

---

### Task 4: HomeScreen card + AppV2 wiring

**Files:**
- Modify: `src/v2/HomeScreen.tsx`, `src/v2/AppV2.tsx`

**Interfaces:**
- Consumes: `getNextLesson` (Task 3's api method) for the card summary; `LearnScreen` (Task 3).

- [ ] **Step 1: AppV2 route** — mirror the existing `repertoireRun` boolean-state pattern (AppV2.tsx:17,37,47,64): add `learnMode` state, render `<LearnScreen onBack={...} />` when set.
- [ ] **Step 2: HomeScreen card** — a "Learn" card above/beside the existing session start affordances: fetches next-lesson summary on mount (non-blocking, hide card while loading or on null lesson with all-learned state showing a checkmark variant); shows chapter name, stage chip (NEW / WATCHED / GUIDED badge per stage), "seen in your games N×" when frequency>0, estMinutes, and a start button that triggers the AppV2 learn route. Style: forge-card + rounded-forge-xl like sibling cards; indigo accent for the start button; keep it compact on mobile.
- [ ] **Step 3: Verify + commit** — tsc/eslint/build as Task 3; `git add src/v2/HomeScreen.tsx src/v2/AppV2.tsx && git commit -m "feat(learn): Home learn card and AppV2 routing"`

---

### Task 5: Rollout + live verification (controller-run)

- [ ] `./dev.sh build` exit 0 → `./dev.sh restart`.
- [ ] `curl -s "localhost:3001/api/v2/learn/next?repertoireId=2"` and `=3` — lesson non-null, moves array well-formed (6-field fens, alternating isKevinMove pattern consistent with each side), quarantined lines absent (spot-check: no lesson containing a flagged Kevin (fen,san)).
- [ ] POST a full ladder for one rep-2 line via curl (complete 1,2,3) — verify learn_state row hits stage 3 and progress gained exactly kevinMoveCount rows; then delete those progress rows and the learn_state row (cleanup) OR leave them if Kevin wants the head start — controller judgment.
- [ ] Session composition guard: `sqlite3 ... "SELECT COUNT(*) FROM progress"` — confirm total pool growth stays reasonable; note count in ledger.
- [ ] Mobile smoke deferred to Kevin.

## Self-Review Notes

- Spec coverage: Pillar 2 (front door, hybrid ranking, card copy) → T2/T4; Pillar 3 (ladder + promotion) → T2/T3; Pillar 1 quarantine consumption → T1. Refutation demos in Learn and punish injection remain later increments per spec build order.
- Type consistency: `LineMove`/`BookLine`/`lineKey`/stage semantics identical across T1→T2→T3; `completeLesson(REP, key, stage, passed)` shape matches route body.
- Known risk, ledgered for the executor: rep-3 line count/perf unknown until T1 step 5's sanity run; the 60s cache in T2 is the mitigation; if enumeration exceeds ~5s, T2 should persist the cache per-process only (already the design) and log the timing.
- Placeholders: T2 step 3 and T3 steps are directive prose with exact payload/behavior contracts rather than full code — deliberate for client code whose exact surrounding interfaces the implementer must read (`grep` targets provided); all names, thresholds, and shapes are pinned here.
