# Audit & Punish Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the book quality gate (engine sweep + masters tiebreak + quarantine report) and harvest opponent mistakes from the deviations table into drillable punish data with refutation PVs.

**Architecture:** A new native-Stockfish engine service (UCI over stdin/stdout via `Bun.spawn`) powers two background sweep runners: one audits every book move in `positions` into a new `book_audit` table, one enriches opponent rows in `deviations` with loss + refutation PV. Both are resumable, chunk-based, and exposed via V2 routes (start/status/report). No UI this increment — deliverables are curl-able endpoints the Learn front door (next increment) consumes.

**Tech Stack:** Bun (server), bun:sqlite, chess.js, native Stockfish binary (`brew install stockfish`), lichess explorer REST (masters tiebreak).

**Spec:** `docs/superpowers/specs/2026-09-17-learn-mode-realignment-design.md`

## Global Constraints

- Engine = truth for moves/evals; Gemini is never involved in this increment.
- Sweeps run in the background; never block a request thread. App stays pick-up-and-play.
- All FENs normalized with `normalizeFen` from `server/utils/fen.ts` before DB reads/writes.
- New V2 routes use the `ok<T>()` / `err()` envelope from `server/utils/response.ts`.
- Verdict thresholds (from spec): loss < 75cp → `ok`; 75–149cp → gray zone, masters decide; ≥ 150cp → `flagged`. Masters "plays it": ≥ 10 master games with that move at that position, or the move is ≥ 5% of that position's master games.
- `npm run typecheck:server` must stay green; run `./dev.sh build` before any restart intended for mobile testing (CLAUDE.md).
- Tests run with `bun test server/tests/`. Engine-dependent tests must self-skip when the stockfish binary is absent.
- The running app must not be restarted mid-task without a successful build (CLAUDE.md protocol).

---

### Task 1: Native engine service

**Files:**
- Create: `server/services/engine_native.ts`
- Test: `server/tests/engine_native.test.ts`

**Interfaces:**
- Produces: `class NativeEngine { evaluate(fen: string, depth?: number): Promise<EngineEval>; dispose(): void }` and `export interface EngineEval { cp: number | null; mate: number | null; bestMoveUci: string; pvUci: string[] }`. Evals are **side-to-move POV** (UCI convention) — callers normalize. Also `export function findStockfishBinary(): string | null`.
- Consumes: nothing project-internal.

- [ ] **Step 1: Install the binary (idempotent setup)**

```bash
which stockfish || brew install stockfish
stockfish --help 2>&1 | head -2   # sanity: binary answers
```

If brew is unavailable or install fails, STOP and report — later tasks depend on it.

- [ ] **Step 2: Write the failing test**

```typescript
// server/tests/engine_native.test.ts
import { describe, expect, test } from "bun:test";
import { NativeEngine, findStockfishBinary } from "../services/engine_native";

const binary = findStockfishBinary();
const maybe = binary ? describe : describe.skip;

maybe("NativeEngine", () => {
  test("evaluates the start position near equality", async () => {
    const engine = new NativeEngine();
    const res = await engine.evaluate(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      12,
    );
    engine.dispose();
    expect(res.mate).toBeNull();
    expect(Math.abs(res.cp!)).toBeLessThan(120);
    expect(res.bestMoveUci).toMatch(/^[a-h][1-8][a-h][1-8]/);
    expect(res.pvUci.length).toBeGreaterThan(1);
  }, 30000);

  test("sees a mate in one", async () => {
    const engine = new NativeEngine();
    // White: Qh5xf7 is mate (scholar's mate pattern)
    const res = await engine.evaluate(
      "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
      10,
    );
    engine.dispose();
    expect(res.mate).toBe(1);
  }, 30000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test server/tests/engine_native.test.ts`
Expected: FAIL — cannot resolve `../services/engine_native`.

- [ ] **Step 4: Implement the service**

```typescript
// server/services/engine_native.ts
import { existsSync } from "fs";

export interface EngineEval {
  /** Centipawns, side-to-move POV. null when mate is set. */
  cp: number | null;
  /** Moves to mate, side-to-move POV (positive = side to move mates). */
  mate: number | null;
  bestMoveUci: string;
  pvUci: string[];
}

const CANDIDATE_PATHS = [
  "/opt/homebrew/bin/stockfish",
  "/usr/local/bin/stockfish",
  "/usr/bin/stockfish",
];

export function findStockfishBinary(): string | null {
  for (const p of CANDIDATE_PATHS) if (existsSync(p)) return p;
  return null;
}

/**
 * One long-lived native Stockfish process speaking UCI over stdio.
 * Requests are serialized internally — a single instance is safe to share.
 */
export class NativeEngine {
  private proc: ReturnType<typeof Bun.spawn>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(binaryPath?: string) {
    const bin = binaryPath ?? findStockfishBinary();
    if (!bin) throw new Error("stockfish binary not found — brew install stockfish");
    this.proc = Bun.spawn([bin], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    this.reader = this.proc.stdout.getReader();
    this.send("uci");
    this.send("setoption name Threads value 4");
    this.send("setoption name Hash value 128");
  }

  private send(cmd: string) {
    this.proc.stdin.write(cmd + "\n");
    this.proc.stdin.flush();
  }

  /** Read lines until one matches `until`; return every line seen. */
  private async readUntil(until: RegExp, timeoutMs: number): Promise<string[]> {
    const lines: string[] = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const nl = this.buffer.indexOf("\n");
      if (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) lines.push(line);
        if (until.test(line)) return lines;
        continue;
      }
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("engine read timeout")), deadline - Date.now()),
        ),
      ]);
      if (chunk.done) throw new Error("engine process closed");
      this.buffer += new TextDecoder().decode(chunk.value);
    }
    throw new Error("engine read timeout");
  }

  evaluate(fen: string, depth = 14): Promise<EngineEval> {
    const job = async (): Promise<EngineEval> => {
      this.send("isready");
      await this.readUntil(/^readyok/, 10_000);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      const lines = await this.readUntil(/^bestmove/, 60_000);

      let cp: number | null = null;
      let mate: number | null = null;
      let pvUci: string[] = [];
      // Walk backwards: the last full info line before bestmove is the deepest.
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (!l.startsWith("info") || !l.includes(" pv ")) continue;
        const cpM = l.match(/score cp (-?\d+)/);
        const mateM = l.match(/score mate (-?\d+)/);
        const pvM = l.match(/ pv (.+)$/);
        if (cpM) cp = parseInt(cpM[1], 10);
        if (mateM) mate = parseInt(mateM[1], 10);
        if (pvM) pvUci = pvM[1].trim().split(/\s+/);
        break;
      }
      const bestLine = lines[lines.length - 1];
      const bestMoveUci = bestLine.split(/\s+/)[1] ?? "";
      return { cp, mate, bestMoveUci, pvUci };
    };
    const run = this.queue.then(job, job);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  dispose() {
    try {
      this.send("quit");
    } catch { /* already dead */ }
    this.proc.kill();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test server/tests/engine_native.test.ts`
Expected: 2 pass (or 2 skip if binary truly absent — but Step 1 guaranteed it).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck:server
git add server/services/engine_native.ts server/tests/engine_native.test.ts
git commit -m "feat(audit): native Stockfish engine service over UCI/stdio"
```

---

### Task 2: Loss math + verdict logic (pure functions)

**Files:**
- Create: `server/utils/audit.ts`
- Test: `server/tests/audit.test.ts`

**Interfaces:**
- Consumes: `EngineEval` from Task 1 (type import only — logic is engine-free).
- Produces:
  `export function lossCp(best: EngineEval, afterPlayed: EngineEval): number` —
  loss for the mover, in cp, mate-aware, floored at 0.
  `export type Verdict = "ok" | "gray" | "flagged"`
  `export function engineVerdict(loss: number): Verdict` — <75 ok, 75–149 gray, ≥150 flagged.
  `export function mastersVerdict(moveGames: number, totalGames: number): "ok_masters" | "flagged"` — ok when moveGames ≥ 10 or moveGames/totalGames ≥ 0.05 (guard totalGames 0 → flagged).

- [ ] **Step 1: Write the failing tests**

```typescript
// server/tests/audit.test.ts
import { describe, expect, test } from "bun:test";
import { lossCp, engineVerdict, mastersVerdict } from "../utils/audit";
import type { EngineEval } from "../services/engine_native";

const ev = (cp: number | null, mate: number | null = null): EngineEval => ({
  cp, mate, bestMoveUci: "e2e4", pvUci: ["e2e4"],
});

describe("lossCp", () => {
  test("normal loss: best +40 for mover, after played the OPPONENT is +80 → mover sits at -80 → loss 120", () => {
    expect(lossCp(ev(40), ev(80))).toBe(120);
  });
  test("played the best move → 0 loss", () => {
    expect(lossCp(ev(40), ev(-40))).toBe(0);
  });
  test("gaining move floors at 0, never negative", () => {
    expect(lossCp(ev(40), ev(-90))).toBe(0);
  });
  test("threw away a mate: best is mate-in-2, after played it's cp-equal → huge loss", () => {
    expect(lossCp(ev(null, 2), ev(0))).toBeGreaterThanOrEqual(500);
  });
  test("walked into mate: best cp 0, after played opponent has mate → huge loss", () => {
    expect(lossCp(ev(0), ev(null, 3))).toBeGreaterThanOrEqual(500);
  });
  test("mate preserved (mate-in-2 best, after played opponent is mated-in-1) → 0 loss", () => {
    expect(lossCp(ev(null, 2), ev(null, -1))).toBe(0);
  });
});

describe("engineVerdict", () => {
  test("74 → ok", () => expect(engineVerdict(74)).toBe("ok"));
  test("75 → gray", () => expect(engineVerdict(75)).toBe("gray"));
  test("149 → gray", () => expect(engineVerdict(149)).toBe("gray"));
  test("150 → flagged", () => expect(engineVerdict(150)).toBe("flagged"));
});

describe("mastersVerdict", () => {
  test("10 games → ok regardless of share", () =>
    expect(mastersVerdict(10, 10000)).toBe("ok_masters"));
  test("6% share with few games → ok", () =>
    expect(mastersVerdict(3, 50)).toBe("ok_masters"));
  test("rare and thin → flagged", () =>
    expect(mastersVerdict(2, 500)).toBe("flagged"));
  test("no master games at all → flagged", () =>
    expect(mastersVerdict(0, 0)).toBe("flagged"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server/tests/audit.test.ts`
Expected: FAIL — cannot resolve `../utils/audit`.

- [ ] **Step 3: Implement**

```typescript
// server/utils/audit.ts
import type { EngineEval } from "../services/engine_native";

/** Clamp mate scores onto a large cp scale so mate-vs-cp losses compare sanely. */
const MATE_CP = 1000;

function toCp(e: EngineEval): number {
  if (e.mate !== null) return e.mate > 0 ? MATE_CP : -MATE_CP;
  return e.cp ?? 0;
}

/**
 * Loss for the mover: eval of best play minus the eval actually obtained.
 * `afterPlayed` was evaluated from the OPPONENT's side, so negate it.
 */
export function lossCp(best: EngineEval, afterPlayed: EngineEval): number {
  const obtained = -toCp(afterPlayed);
  return Math.max(0, toCp(best) - obtained);
}

export type Verdict = "ok" | "gray" | "flagged";

export function engineVerdict(loss: number): Verdict {
  if (loss < 75) return "ok";
  if (loss < 150) return "gray";
  return "flagged";
}

export function mastersVerdict(
  moveGames: number,
  totalGames: number,
): "ok_masters" | "flagged" {
  if (moveGames >= 10) return "ok_masters";
  if (totalGames > 0 && moveGames / totalGames >= 0.05) return "ok_masters";
  return "flagged";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server/tests/audit.test.ts`
Expected: all pass.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck:server
git add server/utils/audit.ts server/tests/audit.test.ts
git commit -m "feat(audit): mate-aware loss math and verdict thresholds"
```

---

### Task 3: book_audit table + sweep runner

**Files:**
- Modify: `server/db.ts` (add table in `runMigrations`, next to the `drill_corrections` block)
- Create: `server/services/audit_sweep.ts`
- Test: `server/tests/audit_sweep.test.ts`

**Interfaces:**
- Consumes: `NativeEngine`/`findStockfishBinary` (Task 1), `lossCp`/`engineVerdict` (Task 2), `normalizeFen` from `server/utils/fen.ts`, default export `db` from `server/db.ts`.
- Produces:
  `export function startBookSweep(repertoireId: number, depth?: number): { started: boolean; reason?: string }` — kicks a background sweep, refuses if one is running.
  `export function sweepStatus(): { running: boolean; repertoireId: number | null; done: number; total: number; flagged: number; gray: number; errors: number }`
  Table `book_audit(repertoire_id, fen, san, depth, best_cp, played_cp, loss_cp, best_uci, pv_uci, verdict, swept_at, PRIMARY KEY(repertoire_id, fen, san))` — `verdict` ∈ ok | gray | flagged | ok_masters (Task 4 writes ok_masters).

- [ ] **Step 1: Add the migration**

In `server/db.ts`, immediately before the `drill_corrections` block, add:

```typescript
  // Book quality audit: one row per (repertoire, fen, san) book move, written
  // by the engine sweep. Derived data — safe to wipe and re-sweep.
  db.query(
    `CREATE TABLE IF NOT EXISTS book_audit (
    repertoire_id INTEGER NOT NULL,
    fen TEXT NOT NULL,
    san TEXT NOT NULL,
    depth INTEGER NOT NULL,
    best_cp INTEGER,
    played_cp INTEGER,
    loss_cp INTEGER NOT NULL,
    best_uci TEXT NOT NULL DEFAULT '',
    pv_uci TEXT NOT NULL DEFAULT '',
    verdict TEXT NOT NULL,
    masters_move_games INTEGER,
    masters_total_games INTEGER,
    swept_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (repertoire_id, fen, san)
  )`,
  ).run();
```

- [ ] **Step 2: Write the failing test**

The runner's core is `sweepOne` — exported for testability, engine injected:

```typescript
// server/tests/audit_sweep.test.ts
import { describe, expect, test } from "bun:test";
import { sweepOne } from "../services/audit_sweep";
import type { EngineEval } from "../services/engine_native";

// Fake engine: position-keyed canned evals (side-to-move POV).
function fakeEngine(map: Record<string, EngineEval>) {
  return {
    evaluate: async (fen: string): Promise<EngineEval> => {
      const hit = Object.entries(map).find(([k]) => fen.startsWith(k));
      if (!hit) throw new Error("unexpected fen " + fen);
      return hit[1];
    },
  };
}

describe("sweepOne", () => {
  test("computes loss and verdict for a book move", async () => {
    // Start position, book move e4. Best for White: +30. After e4, Black at -25 → White obtained +25 → loss 5 → ok.
    const engine = fakeEngine({
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w": {
        cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4", "e7e5"],
      },
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b": {
        cp: -25, mate: null, bestMoveUci: "e7e5", pvUci: ["e7e5"],
      },
    });
    const row = await sweepOne(
      engine as never,
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "e4",
      12,
    );
    expect(row.loss_cp).toBe(5);
    expect(row.verdict).toBe("ok");
    expect(row.best_uci).toBe("e2e4");
    expect(row.pv_uci).toBe("e2e4 e7e5");
  });

  test("illegal SAN throws with a useful message", async () => {
    const engine = fakeEngine({});
    await expect(
      sweepOne(engine as never, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "Qxf7", 12),
    ).rejects.toThrow(/illegal/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test server/tests/audit_sweep.test.ts`
Expected: FAIL — cannot resolve `../services/audit_sweep`.

- [ ] **Step 4: Implement the runner**

```typescript
// server/services/audit_sweep.ts
import { Chess } from "chess.js";
import db from "../db";
import { NativeEngine, findStockfishBinary } from "./engine_native";
import type { EngineEval } from "./engine_native";
import { lossCp, engineVerdict } from "../utils/audit";
import { normalizeFen } from "../utils/fen";

export interface AuditRow {
  loss_cp: number;
  verdict: string;
  best_cp: number | null;
  played_cp: number | null;
  best_uci: string;
  pv_uci: string;
}

interface EvalSource {
  evaluate(fen: string, depth?: number): Promise<EngineEval>;
}

/** Audit a single (fen, san) book move. Exported for tests; engine injected. */
export async function sweepOne(
  engine: EvalSource,
  fullFen: string,
  san: string,
  depth: number,
): Promise<AuditRow> {
  const chess = new Chess(fullFen);
  const best = await engine.evaluate(fullFen, depth);
  let move;
  try {
    move = chess.move(san);
  } catch {
    move = null;
  }
  if (!move) throw new Error(`illegal SAN ${san} at ${fullFen}`);
  const after = await engine.evaluate(chess.fen(), depth);
  const loss = lossCp(best, after);
  return {
    loss_cp: loss,
    verdict: engineVerdict(loss),
    best_cp: best.cp,
    played_cp: after.cp,
    best_uci: best.bestMoveUci,
    pv_uci: best.pvUci.join(" "),
  };
}

// ---------- background sweep over the positions table ----------

const state = {
  running: false,
  repertoireId: null as number | null,
  done: 0,
  total: 0,
  flagged: 0,
  gray: 0,
  errors: 0,
};

export function sweepStatus() {
  return { ...state };
}

/**
 * The positions table stores 4-field FENs; chess.js needs 6. Book positions
 * are early-game so halfmove/fullmove counters barely affect eval at these
 * depths — appending "0 1" is fine.
 */
function ensureFullFen(fen: string): string {
  return fen.split(" ").length >= 6 ? fen : `${fen} 0 1`;
}

export function startBookSweep(
  repertoireId: number,
  depth = 14,
): { started: boolean; reason?: string } {
  if (state.running) return { started: false, reason: "sweep already running" };
  if (!findStockfishBinary())
    return { started: false, reason: "stockfish binary not found" };

  // Resumable: only rows not yet audited at ≥ this depth.
  const rows = db
    .query(
      `SELECT p.fen, p.san FROM positions p
       LEFT JOIN book_audit a
         ON a.repertoire_id = p.repertoire_id AND a.fen = p.fen AND a.san = p.san
        AND a.depth >= ?
       WHERE p.repertoire_id = ? AND a.fen IS NULL`,
    )
    .all(depth, repertoireId) as { fen: string; san: string }[];

  state.running = true;
  state.repertoireId = repertoireId;
  state.done = 0;
  state.total = rows.length;
  state.flagged = 0;
  state.gray = 0;
  state.errors = 0;

  // Fire-and-forget; status is polled.
  (async () => {
    const engine = new NativeEngine();
    const upsert = db.prepare(
      `INSERT INTO book_audit
         (repertoire_id, fen, san, depth, best_cp, played_cp, loss_cp, best_uci, pv_uci, verdict, swept_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(repertoire_id, fen, san) DO UPDATE SET
         depth = excluded.depth, best_cp = excluded.best_cp,
         played_cp = excluded.played_cp, loss_cp = excluded.loss_cp,
         best_uci = excluded.best_uci, pv_uci = excluded.pv_uci,
         verdict = excluded.verdict, swept_at = excluded.swept_at`,
    );
    try {
      for (const r of rows) {
        try {
          const row = await sweepOne(engine, ensureFullFen(r.fen), r.san, depth);
          upsert.run(
            repertoireId, normalizeFen(r.fen), r.san, depth,
            row.best_cp, row.played_cp, row.loss_cp,
            row.best_uci, row.pv_uci, row.verdict,
          );
          if (row.verdict === "flagged") state.flagged++;
          if (row.verdict === "gray") state.gray++;
        } catch (e) {
          state.errors++;
          console.error("[audit] sweep error at", r.fen, r.san, e);
        }
        state.done++;
      }
    } finally {
      engine.dispose();
      state.running = false;
    }
  })();

  return { started: true };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test server/tests/audit_sweep.test.ts`
Expected: 2 pass.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck:server
git add server/db.ts server/services/audit_sweep.ts server/tests/audit_sweep.test.ts
git commit -m "feat(audit): book_audit table and resumable engine sweep runner"
```

---

### Task 4: Masters tiebreak + audit routes + report

**Files:**
- Create: `server/routes/v2_audit.ts`
- Modify: `server/index.ts` (wire three routes where the other `/api/v2/` routes are registered)
- Test: `server/tests/masters_tiebreak.test.ts`

**Interfaces:**
- Consumes: `startBookSweep`/`sweepStatus` (Task 3), `mastersVerdict` (Task 2), `ok`/`err` from `server/utils/response.ts`, `db`.
- Produces routes:
  `POST /api/v2/audit/sweep` body `{repertoireId: number, depth?: number}` → `ok({started})` or `err(reason, 409)`
  `GET /api/v2/audit/status` → `ok(sweepStatus() merged with per-verdict counts from book_audit)`
  `POST /api/v2/audit/tiebreak` body `{repertoireId}` → resolves every `gray` row via lichess masters → `ok({resolved, okMasters, flagged})`
  `GET /api/v2/audit/report?repertoireId=N` → `ok({flagged: [...], gray: [...]})` rows joined with `positions.comment`, ordered by `loss_cp DESC`
  Exported for tests: `export async function tiebreakGrayRows(repertoireId: number, fetchMasters?: (fen: string) => Promise<{moveGames: number; totalGames: number} | null>, sanToCheck?: string): Promise<{resolved: number; okMasters: number; flagged: number}>` — production default fetcher hits `https://explorer.lichess.ovh/masters?fen=...&moves=12&topGames=0`, 1 request/sec throttle, and matches the row's SAN against the response's `moves[].san`.

- [ ] **Step 1: Write the failing test (tiebreak logic with injected fetcher)**

```typescript
// server/tests/masters_tiebreak.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import db from "../db";
import { tiebreakGrayRows } from "../routes/v2_audit";

const REP = 999; // scratch repertoire id — cleaned each run

beforeEach(() => {
  db.query("DELETE FROM book_audit WHERE repertoire_id = ?").run(REP);
  db.prepare(
    `INSERT INTO book_audit (repertoire_id, fen, san, depth, loss_cp, verdict)
     VALUES (?, ?, ?, 14, 100, 'gray')`,
  ).run(REP, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "e4");
});

describe("tiebreakGrayRows", () => {
  test("masters play it → ok_masters", async () => {
    const res = await tiebreakGrayRows(REP, async () => ({ moveGames: 4000, totalGames: 9000 }));
    expect(res).toEqual({ resolved: 1, okMasters: 1, flagged: 0 });
    const row = db
      .query("SELECT verdict, masters_move_games FROM book_audit WHERE repertoire_id = ?")
      .get(REP) as { verdict: string; masters_move_games: number };
    expect(row.verdict).toBe("ok_masters");
    expect(row.masters_move_games).toBe(4000);
  });

  test("masters never touch it → flagged", async () => {
    const res = await tiebreakGrayRows(REP, async () => ({ moveGames: 1, totalGames: 5000 }));
    expect(res).toEqual({ resolved: 1, okMasters: 0, flagged: 1 });
  });

  test("explorer unreachable → row left gray for a later pass", async () => {
    const res = await tiebreakGrayRows(REP, async () => null);
    expect(res).toEqual({ resolved: 0, okMasters: 0, flagged: 0 });
    const row = db
      .query("SELECT verdict FROM book_audit WHERE repertoire_id = ?")
      .get(REP) as { verdict: string };
    expect(row.verdict).toBe("gray");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/tests/masters_tiebreak.test.ts`
Expected: FAIL — cannot resolve `../routes/v2_audit`.

- [ ] **Step 3: Implement the route module**

```typescript
// server/routes/v2_audit.ts
import db from "../db";
import { ok, err } from "../utils/response";
import { startBookSweep, sweepStatus } from "../services/audit_sweep";
import { mastersVerdict } from "../utils/audit";

type MastersCounts = { moveGames: number; totalGames: number } | null;

/** 4-field FEN → the 6-field form lichess expects. */
function ensureFullFen(fen: string): string {
  return fen.split(" ").length >= 6 ? fen : `${fen} 0 1`;
}

async function fetchMastersDefault(
  fen: string,
  san: string,
): Promise<MastersCounts> {
  try {
    const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(ensureFullFen(fen))}&moves=12&topGames=0`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      white: number; draws: number; black: number;
      moves: { san: string; white: number; draws: number; black: number }[];
    };
    const totalGames = data.white + data.draws + data.black;
    const mv = data.moves.find((m) => m.san === san);
    const moveGames = mv ? mv.white + mv.draws + mv.black : 0;
    return { moveGames, totalGames };
  } catch {
    return null;
  }
}

export async function tiebreakGrayRows(
  repertoireId: number,
  fetchMasters?: (fen: string) => Promise<MastersCounts>,
): Promise<{ resolved: number; okMasters: number; flagged: number }> {
  const rows = db
    .query(
      "SELECT fen, san FROM book_audit WHERE repertoire_id = ? AND verdict = 'gray'",
    )
    .all(repertoireId) as { fen: string; san: string }[];

  const out = { resolved: 0, okMasters: 0, flagged: 0 };
  for (const r of rows) {
    const counts = fetchMasters
      ? await fetchMasters(r.fen)
      : await fetchMastersDefault(r.fen, r.san);
    if (!fetchMasters)
      await new Promise((res) => setTimeout(res, 1100)); // explorer rate courtesy
    if (!counts) continue; // unreachable — stay gray, retry later
    const v = mastersVerdict(counts.moveGames, counts.totalGames);
    db.query(
      `UPDATE book_audit SET verdict = ?, masters_move_games = ?, masters_total_games = ?
       WHERE repertoire_id = ? AND fen = ? AND san = ?`,
    ).run(v, counts.moveGames, counts.totalGames, repertoireId, r.fen, r.san);
    out.resolved++;
    if (v === "ok_masters") out.okMasters++;
    else out.flagged++;
  }
  return out;
}

export async function auditSweepRoute(req: Request): Promise<Response> {
  const body = (await req.json()) as { repertoireId?: number; depth?: number };
  if (!body.repertoireId) return err("repertoireId required", 400);
  const r = startBookSweep(body.repertoireId, body.depth ?? 14);
  return r.started ? ok(r) : err(r.reason ?? "could not start", 409);
}

export function auditStatusRoute(): Response {
  const counts = db
    .query(
      `SELECT verdict, COUNT(*) as c FROM book_audit GROUP BY verdict`,
    )
    .all() as { verdict: string; c: number }[];
  return ok({ sweep: sweepStatus(), verdicts: counts });
}

export async function auditTiebreakRoute(req: Request): Promise<Response> {
  const body = (await req.json()) as { repertoireId?: number };
  if (!body.repertoireId) return err("repertoireId required", 400);
  return ok(await tiebreakGrayRows(body.repertoireId));
}

export function auditReportRoute(url: URL): Response {
  const repertoireId = parseInt(url.searchParams.get("repertoireId") ?? "", 10);
  if (!repertoireId) return err("repertoireId required", 400);
  const pull = (verdict: string) =>
    db
      .query(
        `SELECT a.fen, a.san, a.loss_cp, a.best_uci, a.pv_uci, a.verdict,
                a.masters_move_games, p.comment
         FROM book_audit a
         LEFT JOIN positions p
           ON p.repertoire_id = a.repertoire_id AND p.fen = a.fen AND p.san = a.san
         WHERE a.repertoire_id = ? AND a.verdict = ?
         ORDER BY a.loss_cp DESC`,
      )
      .all(repertoireId, verdict);
  return ok({ flagged: pull("flagged"), gray: pull("gray") });
}
```

- [ ] **Step 4: Wire routes in `server/index.ts`**

Find where other `/api/v2/` POST routes are matched and add, following the file's existing dispatch style:

```typescript
import {
  auditSweepRoute, auditStatusRoute, auditTiebreakRoute, auditReportRoute,
} from "./routes/v2_audit";
// ...in the request dispatcher:
// POST /api/v2/audit/sweep
// GET  /api/v2/audit/status
// POST /api/v2/audit/tiebreak
// GET  /api/v2/audit/report?repertoireId=N
```

- [ ] **Step 5: Run tests, typecheck, commit**

```bash
bun test server/tests/masters_tiebreak.test.ts   # 3 pass
npm run typecheck:server
git add server/routes/v2_audit.ts server/index.ts server/tests/masters_tiebreak.test.ts
git commit -m "feat(audit): masters tiebreak, sweep/status/report routes"
```

---

### Task 5: Run the real sweep (both books) and record findings

**Files:**
- Create: `docs/audit-report-2026-09.md` (findings summary — human-readable)

No code. This task validates the whole gate against reality.

- [ ] **Step 1: Build + restart per CLAUDE.md protocol**

```bash
./dev.sh build    # must exit 0
./dev.sh restart
```

- [ ] **Step 2: Sweep Jobava (rep 3, ~6,600 positions — expect roughly 1–2 h at depth 14)**

```bash
curl -s -X POST localhost:3001/api/v2/audit/sweep -H 'Content-Type: application/json' -d '{"repertoireId":3}'
# poll:
curl -s localhost:3001/api/v2/audit/status
```

- [ ] **Step 3: Sweep Caro-Kann (rep 2, ~600 positions) once rep 3 finishes**

```bash
curl -s -X POST localhost:3001/api/v2/audit/sweep -H 'Content-Type: application/json' -d '{"repertoireId":2}'
```

- [ ] **Step 4: Tiebreak gray rows for both**

```bash
curl -s -X POST localhost:3001/api/v2/audit/tiebreak -H 'Content-Type: application/json' -d '{"repertoireId":3}'
curl -s -X POST localhost:3001/api/v2/audit/tiebreak -H 'Content-Type: application/json' -d '{"repertoireId":2}'
```

- [ ] **Step 5: Pull reports, verify the known bishop-hang line is flagged, write findings**

```bash
curl -s "localhost:3001/api/v2/audit/report?repertoireId=3" | head -c 3000
curl -s "localhost:3001/api/v2/audit/report?repertoireId=2" | head -c 3000
```

Acceptance: the known Jobava move-16 bishop-hang line appears in `flagged`. Write
`docs/audit-report-2026-09.md`: counts per verdict per repertoire, top-10 flagged
moves with loss_cp, and any surprises. Commit:

```bash
git add docs/audit-report-2026-09.md
git commit -m "docs: first full book audit findings for both repertoires"
```

---

### Task 6: Opponent-mistake harvesting

**Files:**
- Modify: `server/db.ts` (four `addCol` lines for `deviations`)
- Create: `server/services/punish_harvest.ts`
- Create: `server/routes/v2_punish.ts`
- Modify: `server/index.ts` (wire routes)
- Test: `server/tests/punish_harvest.test.ts`

**Interfaces:**
- Consumes: `NativeEngine`/`findStockfishBinary` (Task 1), `lossCp` (Task 2), `db`, `ok`/`err`.
- Produces:
  `deviations` gains `eval_best_cp INTEGER`, `eval_played_cp INTEGER`, `loss_cp INTEGER`, `refutation_pv TEXT` (UCI, space-separated, from the position AFTER the opponent's mistake — i.e. Kevin to move: the punish line).
  `export async function harvestOne(engine, fullFenBefore: string, playedSan: string, depth: number): Promise<{loss_cp: number; eval_best_cp: number | null; eval_played_cp: number | null; refutation_pv: string}>`
  `export function startHarvest(depth?: number): {started: boolean; reason?: string}` + `export function harvestStatus()` — same background pattern as Task 3, over `deviations WHERE notes='opponent' AND loss_cp IS NULL` (669 rows currently).
  Routes: `POST /api/v2/punish/harvest`, `GET /api/v2/punish/status`, `GET /api/v2/punish/list?minLoss=150` → deviations rows with loss ≥ minLoss, joined with `games.date`, ordered by loss DESC.

- [ ] **Step 1: Add the migration columns**

In `server/db.ts` after the existing `addCol` block:

```typescript
  // Punish training: engine judgment of opponent deviations (harvest runner).
  addCol("deviations", "eval_best_cp", "INTEGER");
  addCol("deviations", "eval_played_cp", "INTEGER");
  addCol("deviations", "loss_cp", "INTEGER");
  addCol("deviations", "refutation_pv", "TEXT");
```

- [ ] **Step 2: Write the failing test**

```typescript
// server/tests/punish_harvest.test.ts
import { describe, expect, test } from "bun:test";
import { harvestOne } from "../services/punish_harvest";
import type { EngineEval } from "../services/engine_native";

function fakeEngine(map: Record<string, EngineEval>) {
  return {
    evaluate: async (fen: string): Promise<EngineEval> => {
      const hit = Object.entries(map).find(([k]) => fen.startsWith(k));
      if (!hit) throw new Error("unexpected fen " + fen);
      return hit[1];
    },
  };
}

describe("harvestOne", () => {
  test("scores the opponent's mistake and captures Kevin's refutation PV", async () => {
    // Position: White (opponent) to move, best keeps ~0. They blunder with g4??;
    // after g4 Black (Kevin) is +250 with a concrete PV.
    const before = "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w";
    const after = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b";
    const engine = fakeEngine({
      [before]: { cp: -20, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] },
      [after]: { cp: 250, mate: null, bestMoveUci: "d8h4", pvUci: ["d8h4", "g2g3", "h4g3"] },
    });
    const res = await harvestOne(
      engine as never,
      "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2",
      "g4",
      14,
    );
    // Opponent best was -20; after g4 they sit at -250 → loss 230.
    expect(res.loss_cp).toBe(230);
    // Refutation PV is from AFTER the mistake — Kevin's punish line.
    expect(res.refutation_pv).toBe("d8h4 g2g3 h4g3");
    expect(res.eval_played_cp).toBe(250);
  });

  test("illegal recorded SAN throws", async () => {
    const engine = fakeEngine({});
    await expect(
      harvestOne(engine as never, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "Qxf7", 14),
    ).rejects.toThrow(/illegal/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test server/tests/punish_harvest.test.ts`
Expected: FAIL — cannot resolve `../services/punish_harvest`.

- [ ] **Step 4: Implement harvester + routes**

```typescript
// server/services/punish_harvest.ts
import { Chess } from "chess.js";
import db from "../db";
import { NativeEngine, findStockfishBinary } from "./engine_native";
import type { EngineEval } from "./engine_native";
import { lossCp } from "../utils/audit";

interface EvalSource {
  evaluate(fen: string, depth?: number): Promise<EngineEval>;
}

export async function harvestOne(
  engine: EvalSource,
  fullFenBefore: string,
  playedSan: string,
  depth: number,
): Promise<{
  loss_cp: number;
  eval_best_cp: number | null;
  eval_played_cp: number | null;
  refutation_pv: string;
}> {
  const chess = new Chess(fullFenBefore);
  const best = await engine.evaluate(fullFenBefore, depth);
  let move;
  try {
    move = chess.move(playedSan);
  } catch {
    move = null;
  }
  if (!move) throw new Error(`illegal SAN ${playedSan} at ${fullFenBefore}`);
  // Eval AFTER the mistake: side to move is now Kevin. Its PV IS the punish line.
  const after = await engine.evaluate(chess.fen(), depth);
  return {
    loss_cp: lossCp(best, after),
    eval_best_cp: best.cp,
    eval_played_cp: after.cp,
    refutation_pv: after.pvUci.join(" "),
  };
}

const state = { running: false, done: 0, total: 0, errors: 0 };
export function harvestStatus() {
  return { ...state };
}

function ensureFullFen(fen: string): string {
  return fen.split(" ").length >= 6 ? fen : `${fen} 0 1`;
}

export function startHarvest(depth = 14): { started: boolean; reason?: string } {
  if (state.running) return { started: false, reason: "harvest already running" };
  if (!findStockfishBinary())
    return { started: false, reason: "stockfish binary not found" };

  const rows = db
    .query(
      `SELECT id, fen, played_san FROM deviations
       WHERE notes = 'opponent' AND loss_cp IS NULL`,
    )
    .all() as { id: number; fen: string; played_san: string }[];

  state.running = true;
  state.done = 0;
  state.total = rows.length;
  state.errors = 0;

  (async () => {
    const engine = new NativeEngine();
    const update = db.prepare(
      `UPDATE deviations SET eval_best_cp = ?, eval_played_cp = ?, loss_cp = ?, refutation_pv = ?
       WHERE id = ?`,
    );
    try {
      for (const r of rows) {
        try {
          const h = await harvestOne(engine, ensureFullFen(r.fen), r.played_san, depth);
          update.run(h.eval_best_cp, h.eval_played_cp, h.loss_cp, h.refutation_pv, r.id);
        } catch (e) {
          state.errors++;
          // Mark judged-but-unusable so the resumable query skips it next run.
          update.run(null, null, -1, null, r.id);
          console.error("[punish] harvest error id", r.id, e);
        }
        state.done++;
      }
    } finally {
      engine.dispose();
      state.running = false;
    }
  })();

  return { started: true };
}
```

```typescript
// server/routes/v2_punish.ts
import db from "../db";
import { ok, err } from "../utils/response";
import { startHarvest, harvestStatus } from "../services/punish_harvest";

export function punishHarvestRoute(): Response {
  const r = startHarvest();
  return r.started ? ok(r) : err(r.reason ?? "could not start", 409);
}

export function punishStatusRoute(): Response {
  return ok(harvestStatus());
}

export function punishListRoute(url: URL): Response {
  const minLoss = parseInt(url.searchParams.get("minLoss") ?? "150", 10);
  const rows = db
    .query(
      `SELECT d.id, d.repertoire_id, d.fen, d.expected_san, d.played_san,
              d.move_number, d.loss_cp, d.refutation_pv, g.date
       FROM deviations d
       JOIN games g ON g.id = d.game_id
       WHERE d.notes = 'opponent' AND d.loss_cp >= ?
       ORDER BY d.loss_cp DESC
       LIMIT 100`,
    )
    .all(minLoss);
  return ok({ count: rows.length, rows });
}
```

Wire in `server/index.ts`: `POST /api/v2/punish/harvest`, `GET /api/v2/punish/status`, `GET /api/v2/punish/list`.

- [ ] **Step 5: Run tests, typecheck, commit**

```bash
bun test server/tests/punish_harvest.test.ts   # 2 pass
npm run typecheck:server
git add server/db.ts server/services/punish_harvest.ts server/routes/v2_punish.ts server/index.ts server/tests/punish_harvest.test.ts
git commit -m "feat(punish): harvest opponent deviations into loss + refutation PV"
```

- [ ] **Step 6: Run the real harvest and sanity-check**

```bash
./dev.sh build && ./dev.sh restart
curl -s -X POST localhost:3001/api/v2/punish/harvest
# poll until done (669 rows ≈ 20–40 min at depth 14):
curl -s localhost:3001/api/v2/punish/status
# then:
curl -s "localhost:3001/api/v2/punish/list?minLoss=150" | head -c 2000
sqlite3 server/chess_trainer.db "SELECT COUNT(*), SUM(loss_cp >= 150) FROM deviations WHERE notes='opponent' AND loss_cp IS NOT NULL AND loss_cp >= 0;"
```

Acceptance: list returns real positions with plausible refutation PVs (spot-check
2–3 on a board); punishable count (≥150cp) is nonzero. Commit nothing further —
data lives in the DB.

---

## Self-Review Notes

- **Spec coverage:** Pillar 1 (quality gate) → Tasks 1–5. Pillar 5 source 1
  (faced mistakes) → Task 6. Pillars 2–4 and explorer-sourced mistakes are
  explicitly later increments per the spec's build sequence. Quarantine
  *enforcement* (excluding flagged lines from the Learn queue) lands with the
  Learn front door — the queue doesn't exist yet; the report + verdicts built
  here are what it will consume.
- **Type consistency:** `EngineEval` (Task 1) consumed by Tasks 2/3/6;
  `lossCp/engineVerdict/mastersVerdict` names match across Tasks 2–6;
  `book_audit` columns in Task 3's migration match Task 4's queries.
- **Placeholders:** none — every step carries runnable code or exact commands.
