# Coach: engine-grounded explanations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `POST /api/analyze/blunder` narrate Stockfish + chess.js facts instead of guessing, so coach explanations stop containing false claims.

**Architecture:** A new `server/services/coach_*` module set builds verified facts (Stockfish evals + chess.js), makes one schema-constrained Gemini call that only writes captions, verifies the text against the facts (retry once, then a deterministic template), assembles walkthrough steps on the server, and caches results. `explainBlunder` in `analyze.ts` becomes a thin adapter. Core logic takes injected dependencies (engine, Gemini, masters, cache) so it is unit-testable with no network.

**Tech Stack:** Bun + TypeScript (strict), `chess.js@^1.4` (`attackers()`), native Stockfish via `server/services/engine_native.ts`, `bun:sqlite`, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-24-coach-engine-facts-design.md` (audit evidence: `docs/audit-2026-09/coach-eval.md`). Read both before starting.

## Global Constraints

- Response shape from `/api/analyze/blunder` stays `{ concept: string, analysis: string, steps: CoachStep[] | null }` (extra `source` field allowed). `src/v2/BlunderExplanation.tsx` / `InteractiveCoach` must keep working unchanged apart from Task 5's stale-response guard.
- Engine depth 14 (`COACH_ENGINE_DEPTH`). Measured on this machine: warm-up ≈ 1.1s; depth 14 ≈ 0.2–0.8s per position.
- Client `request()` timeout stays 10s (`src/services/api.ts`). Server total budget is **9000 ms**; a Gemini call gets at most 6000 ms; do not start a call with < 2500 ms left.
- Severity bands (pawns of loss): `equal` < 0.3 · `inaccuracy` < 0.7 · `mistake` < 1.5 · `blunder` ≥ 1.5 · `decisive` = allows forced mate / flips a ≥ +1.5 position to ≤ −1.5 / stalemates a ≥ +1.5 position.
- Gemini/engine failures are **non-2xx** (502 Gemini, 503 engine/key). Never HTTP 200 with a "Coach unavailable" string. Bad input is **400**.
- Cache key = `(normalizeFen(fen), wrongMove ?? "", correctMove, COACH_PROMPT_VERSION)`. Bump `COACH_PROMPT_VERSION` on any change to prompt, model, thresholds or verifier.
- Gemini spend cap for the Task 6 fixture run: hard-stop at 80 calls, counted at the call site.
- Do not touch `analyzePosition` (streaming path) or `v2_challenge.ts`.
- Follow CLAUDE.md: `npm run typecheck:server` clean, `./dev.sh build` exit 0 (run in foreground), no edits to V1 files, new V2 routes use `ok/err` only when new (this route keeps its existing shape).
- Commits: end each message with
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Xk3JUpMWX8PvvhVP5wAUno`.

## Review Focus

Input classes the spec implies but the happy-path tests would miss (each has a pinning test in the owning task):

1. **Stalemate trap** (`Qc7` stalemates where `Qc8#` mates): coach must not say "the game continues". → Task 2 (`buildFacts` flags), Task 3 (template wording), Task 4.
2. **Both moves mate / equal moves** (S23): must not label the played move a blunder. → Task 2 severity test.
3. **`wrongMove === correctMove`, illegal `wrongMove`, garbage FEN, missing fields**: same-move card; 400 not 500. → Task 4.
4. **Terminal child positions** (the move mates or stalemates): no engine call on a finished game; `bestmove (none)` from Stockfish must not crash. → Task 2.
5. **Gemini down / slow / malformed JSON / claims that fail verification twice**: 502 vs template vs time-budget skip, and never cache an error or a time-budget template. → Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/services/coach_engine.ts` (create) | Lazy shared `NativeEngine`, self-healing wrapper, boot warm-up |
| `server/services/coach_cache.ts` (create) | `coach_cache` table + get/put + `COACH_PROMPT_VERSION` |
| `server/services/coach_facts.ts` (create) | Types, scoring, severity, `describeMove`, `buildFacts`, `stepsFromFacts` |
| `server/services/coach_verify.ts` (create) | `verifyClaims`, `templateFromFacts` |
| `server/services/coach_prompt.ts` (create) | Prompt text, response schema, `parseCoachJson` |
| `server/services/coach.ts` (create) | `explainBlunderCore` orchestration with injected deps |
| `server/routes/analyze.ts` (modify) | `explainBlunder` becomes an adapter; delete now-dead helpers |
| `server/index.ts` (modify) | Call `warmCoachEngine()` after `Bun.serve` |
| `src/v2/BlunderExplanation.tsx` (modify) | Ignore stale responses |
| `server/tests/coach_*.test.ts` (create) | Unit tests per module |
| `server/tests/fixtures/coach_samples.json` (create) | 32 audit positions |
| `scripts/coach_fixture_eval.ts` (create) | Fixture rerun with spend cap |

Tests run with `cd "/Users/kevin/Desktop/Work Spaces/Chess Forge" && bun test server/tests/<file>`.

---

### Task 1: Engine singleton and cache table

**Files:**
- Create: `server/services/coach_engine.ts`
- Create: `server/services/coach_cache.ts`
- Test: `server/tests/coach_cache.test.ts`

**Interfaces:**
- Produces:
  - `getCoachEngine(): EvalEngine` and `warmCoachEngine(): void` (`EvalEngine` is defined in Task 2's `coach_facts.ts`; Task 1 declares it locally as a structural type to avoid a dependency order problem — see code).
  - `COACH_PROMPT_VERSION: number`
  - `interface CoachCacheKey { fen: string; wrongMove: string | null; correctMove: string }`
  - `interface CoachCachePayload { concept: string; analysis: string; steps: unknown[] | null; source: "model" | "template" }`
  - `getCachedCoach(key: CoachCacheKey, database?: Database): CoachCachePayload | null`
  - `putCachedCoach(key: CoachCacheKey, value: CoachCachePayload, database?: Database): void`

- [ ] **Step 1: Write the failing test** — `server/tests/coach_cache.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  COACH_PROMPT_VERSION,
  getCachedCoach,
  putCachedCoach,
  type CoachCachePayload,
} from "../services/coach_cache";

const payload: CoachCachePayload = {
  concept: "Fork",
  analysis: "Nd5 forks the queen and rook.",
  steps: null,
  source: "model",
};
const key = {
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  wrongMove: "d4",
  correctMove: "e4",
};

describe("coach cache", () => {
  test("miss, then hit after put", () => {
    const db = new Database(":memory:");
    expect(getCachedCoach(key, db)).toBeNull();
    putCachedCoach(key, payload, db);
    expect(getCachedCoach(key, db)).toEqual(payload);
  });

  test("move counters in the FEN do not fragment the key", () => {
    const db = new Database(":memory:");
    putCachedCoach(key, payload, db);
    const otherCounters = { ...key, fen: key.fen.replace("0 1", "7 42") };
    expect(getCachedCoach(otherCounters, db)).toEqual(payload);
  });

  test("null wrongMove is a distinct key from a real wrong move", () => {
    const db = new Database(":memory:");
    putCachedCoach(key, payload, db);
    expect(getCachedCoach({ ...key, wrongMove: null }, db)).toBeNull();
  });

  test("rows written under another prompt version are ignored", () => {
    const db = new Database(":memory:");
    putCachedCoach(key, payload, db);
    db.query("UPDATE coach_cache SET prompt_version = ?").run(COACH_PROMPT_VERSION + 1);
    expect(getCachedCoach(key, db)).toBeNull();
  });

  test("put twice overwrites instead of throwing", () => {
    const db = new Database(":memory:");
    putCachedCoach(key, payload, db);
    putCachedCoach(key, { ...payload, concept: "Pin" }, db);
    expect(getCachedCoach(key, db)?.concept).toBe("Pin");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test server/tests/coach_cache.test.ts`
Expected: FAIL — cannot find module `../services/coach_cache`.

- [ ] **Step 3: Implement** — `server/services/coach_cache.ts`

```ts
import type { Database } from "bun:sqlite";
import database from "../db";
import { normalizeFen } from "../utils/fen";

/**
 * Bump on ANY change to the coach prompt, model, severity thresholds or claim
 * verifier. Rows written under an older version stop matching, which is how
 * stale explanations are "cleared" (see CLAUDE.md: analysis & coach updates).
 */
export const COACH_PROMPT_VERSION = 1;

export interface CoachCacheKey {
  fen: string;
  wrongMove: string | null;
  correctMove: string;
}

export interface CoachCachePayload {
  concept: string;
  analysis: string;
  steps: unknown[] | null;
  source: "model" | "template";
}

const ready = new WeakSet<Database>();

function ensureTable(db: Database): void {
  if (ready.has(db)) return;
  db.query(
    `CREATE TABLE IF NOT EXISTS coach_cache (
       fen_norm TEXT NOT NULL,
       wrong_move TEXT NOT NULL,
       correct_move TEXT NOT NULL,
       prompt_version INTEGER NOT NULL,
       response_json TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       PRIMARY KEY (fen_norm, wrong_move, correct_move, prompt_version)
     )`,
  ).run();
  ready.add(db);
}

function params(key: CoachCacheKey): [string, string, string, number] {
  return [normalizeFen(key.fen), key.wrongMove ?? "", key.correctMove, COACH_PROMPT_VERSION];
}

export function getCachedCoach(
  key: CoachCacheKey,
  db: Database = database,
): CoachCachePayload | null {
  ensureTable(db);
  const row = db
    .query(
      `SELECT response_json FROM coach_cache
       WHERE fen_norm = ? AND wrong_move = ? AND correct_move = ? AND prompt_version = ?`,
    )
    .get(...params(key)) as { response_json: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.response_json) as CoachCachePayload;
  } catch {
    return null;
  }
}

export function putCachedCoach(
  key: CoachCacheKey,
  value: CoachCachePayload,
  db: Database = database,
): void {
  ensureTable(db);
  db.query(
    `INSERT OR REPLACE INTO coach_cache
       (fen_norm, wrong_move, correct_move, prompt_version, response_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(...params(key), JSON.stringify(value));
}
```

- [ ] **Step 4: Implement** — `server/services/coach_engine.ts`

```ts
import { NativeEngine, findStockfishBinary, type EngineEval } from "./engine_native";

/** The slice of NativeEngine the coach needs. Tests pass stubs. */
export interface EvalEngine {
  evaluate(fen: string, depth?: number): Promise<EngineEval>;
}

let shared: NativeEngine | null = null;

function ensure(): NativeEngine {
  if (!shared) {
    if (!findStockfishBinary()) throw new Error("stockfish binary not found");
    shared = new NativeEngine();
  }
  return shared;
}

/**
 * One long-lived Stockfish shared by all coach requests (NativeEngine
 * serializes internally). If the process dies, the next call respawns it.
 */
export function getCoachEngine(): EvalEngine {
  return {
    async evaluate(fen, depth) {
      const engine = ensure();
      try {
        return await engine.evaluate(fen, depth);
      } catch (err) {
        try {
          shared?.dispose();
        } catch {
          /* already dead */
        }
        shared = null;
        throw err;
      }
    },
  };
}

/** Fire-and-forget at server start so the first coach call skips engine start-up. */
export function warmCoachEngine(): void {
  try {
    void getCoachEngine()
      .evaluate("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 1)
      .catch(() => {});
  } catch {
    /* no Stockfish installed — coach requests answer 503 */
  }
}
```

Note: Task 2 will import `EvalEngine` from here (`import type { EvalEngine } from "./coach_engine"`), so do not redefine it there.

- [ ] **Step 5: Run tests and typecheck**

Run: `bun test server/tests/coach_cache.test.ts && npm run typecheck:server`
Expected: 5 pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/services/coach_engine.ts server/services/coach_cache.ts server/tests/coach_cache.test.ts
git commit -m "feat(coach): shared engine wrapper and versioned coach cache"
```

---

### Task 2: Facts — scoring, severity, `buildFacts`, `stepsFromFacts`

**Files:**
- Create: `server/services/coach_facts.ts`
- Test: `server/tests/coach_facts.test.ts`

**Interfaces:**
- Consumes: `EvalEngine` from `./coach_engine`; `EngineEval` from `./engine_native`.
- Produces (exact names used by Tasks 3–5):
  - `COACH_ENGINE_DEPTH = 14`
  - `class CoachInputError extends Error`
  - `type Severity = "equal" | "inaccuracy" | "mistake" | "blunder" | "decisive"`
  - `interface Score { cp: number | null; mate: number | null }` (mover's point of view)
  - `interface PieceRef { color: Color; type: PieceSymbol; square: Square }`
  - `interface MoveFacts { san; from; to; piece; captured: PieceSymbol | null; givesCheck; givesMate; givesStalemate; landingAttackers: PieceRef[]; landingDefenders: PieceRef[]; attacks: PieceRef[] }`
  - `interface CoachFacts { fen; mover: Color; moverName: "White" | "Black"; wrong: MoveFacts | null; best: MoveFacts; reply: MoveFacts | null; evalBefore: Score; evalAfterWrong: Score | null; evalAfterBest: Score; lossPawns: number; severity: Severity; bestPvSan: string[]; refutationPvSan: string[]; wrongEqualsBest: boolean; pieces: PieceRef[]; positions: string[]; engineDepth: number }`
  - `interface CoachInput { fen: string; wrongMove: string | null; correctMove: string; cpLoss: number | null; phase?: string; framing?: string }`
  - `interface CoachCaptions { wrong: string; reply: string; best: string; why: string }`
  - `pieceName(t: PieceSymbol): string`, `scoreToPawns(s: Score): number`
  - `severityFor(lossPawns: number, opts: { allowsMate: boolean; flippedToLost: boolean; stalemateThrow: boolean }): Severity`
  - `uciToSan(fen: string, uci: string): string | null`, `pvToSan(fen: string, pv: string[], maxPlies?: number): string[]`
  - `describeMove(fen: string, san: string): { facts: MoveFacts; fenAfter: string }` (throws on illegal)
  - `buildFacts(input: CoachInput, engine: EvalEngine, depth?: number): Promise<CoachFacts>`
  - `stepsFromFacts(facts: CoachFacts, captions: CoachCaptions): CoachStepOut[]` where `CoachStepOut = { text: string; action: { type: "playMove"; san: string; highlight?: "red" | "green" | "amber" } | { type: "highlight"; squares: string[]; color?: "red" | "green" | "amber" | "blue" } }`

- [ ] **Step 1: Write the failing tests** — `server/tests/coach_facts.test.ts`

The stub engine answers by call order (documented per test) so tests need no real Stockfish. `EngineEval` scores are side-to-move POV, exactly like the real engine.

```ts
import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import type { EngineEval } from "../services/engine_native";
import type { EvalEngine } from "../services/coach_engine";
import {
  buildFacts,
  CoachInputError,
  pvToSan,
  scoreToPawns,
  severityFor,
  stepsFromFacts,
  uciToSan,
} from "../services/coach_facts";

/** Returns the queued evals in call order and records how many calls were made. */
function queueEngine(evals: EngineEval[]) {
  let calls = 0;
  const engine: EvalEngine = {
    async evaluate() {
      const ev = evals[calls++];
      if (!ev) throw new Error("engine called more times than expected");
      return ev;
    },
  };
  return { engine, calls: () => calls };
}

const SCHOLAR = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const STALEMATE_FEN = "k7/8/1K6/8/8/8/8/2Q5 w - - 0 1";

describe("scoring helpers", () => {
  test("scoreToPawns handles cp and mate", () => {
    expect(scoreToPawns({ cp: 150, mate: null })).toBe(1.5);
    expect(scoreToPawns({ cp: null, mate: 3 })).toBe(97);
    expect(scoreToPawns({ cp: null, mate: -3 })).toBe(-97);
  });

  test("severityFor uses the spec bands", () => {
    const none = { allowsMate: false, flippedToLost: false, stalemateThrow: false };
    expect(severityFor(0.29, none)).toBe("equal");
    expect(severityFor(0.3, none)).toBe("inaccuracy");
    expect(severityFor(0.69, none)).toBe("inaccuracy");
    expect(severityFor(0.7, none)).toBe("mistake");
    expect(severityFor(1.49, none)).toBe("mistake");
    expect(severityFor(1.5, none)).toBe("blunder");
    expect(severityFor(0.1, { ...none, allowsMate: true })).toBe("decisive");
    expect(severityFor(0.1, { ...none, stalemateThrow: true })).toBe("decisive");
  });
});

describe("uci helpers", () => {
  test("uciToSan converts and rejects garbage", () => {
    expect(uciToSan(START, "e2e4")).toBe("e4");
    expect(uciToSan(START, "(none)")).toBeNull();
    expect(uciToSan(START, "e2e5")).toBeNull();
  });

  test("pvToSan stops at the first illegal move and honours maxPlies", () => {
    expect(pvToSan(START, ["e2e4", "e7e5", "g1f3", "b8c6"], 3)).toEqual(["e4", "e5", "Nf3"]);
    expect(pvToSan(START, ["e2e4", "e2e4"])).toEqual(["e4"]);
  });
});

describe("buildFacts", () => {
  test("blunder: best move is the engine's top move => only 2 engine calls", async () => {
    // call 1: before (white to move, mate in 1). call 2: after Nf3 (black to move, black POV +30cp).
    const { engine, calls } = queueEngine([
      { cp: null, mate: 1, bestMoveUci: "h5f7", pvUci: ["h5f7"] },
      { cp: 30, mate: null, bestMoveUci: "g8f6", pvUci: ["g8f6", "d2d4"] },
    ]);
    const f = await buildFacts(
      { fen: SCHOLAR, wrongMove: "Nf3", correctMove: "Qxf7#", cpLoss: null },
      engine,
    );
    expect(calls()).toBe(2);
    expect(f.mover).toBe("w");
    expect(f.best.san).toBe("Qxf7#");
    expect(f.best.givesMate).toBe(true);
    expect(f.best.captured).toBe("p");
    expect(f.wrong?.san).toBe("Nf3");
    expect(f.reply?.san).toBe("Nf6");
    expect(f.evalAfterWrong).toEqual({ cp: -30, mate: null }); // flipped to mover POV
    expect(f.severity).toBe("blunder");
    expect(f.lossPawns).toBeGreaterThan(90);
    expect(f.bestPvSan[0]).toBe("Qxf7#");
    expect(f.positions.length).toBe(4); // before, after wrong, after reply, after best
  });

  test("best move differs from engine top => evaluates the best child (3 calls)", async () => {
    // buildFacts evaluates in this order: before, after the BEST move, after the WRONG move.
    const { engine, calls } = queueEngine([
      { cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] }, // before
      { cp: -28, mate: null, bestMoveUci: "d7d5", pvUci: ["d7d5", "c2c4"] }, // after Nf3 (best), black POV
      { cp: -20, mate: null, bestMoveUci: "e7e5", pvUci: ["e7e5"] }, // after d4 (wrong), black POV
    ]);
    const f = await buildFacts(
      { fen: START, wrongMove: "d4", correctMove: "Nf3", cpLoss: null },
      engine,
    );
    expect(calls()).toBe(3);
    expect(f.evalAfterBest).toEqual({ cp: 28, mate: null });
    expect(f.bestPvSan.slice(0, 2)).toEqual(["Nf3", "d5"]);
  });

  test("near-equal moves are severity 'equal' (S19/S30 style)", async () => {
    const { engine } = queueEngine([
      { cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] },
      { cp: -25, mate: null, bestMoveUci: "d7d5", pvUci: ["d7d5"] },
    ]);
    const f = await buildFacts({ fen: START, wrongMove: "d4", correctMove: "e4", cpLoss: 2 }, engine);
    expect(f.lossPawns).toBeCloseTo(0.05, 2);
    expect(f.severity).toBe("equal");
  });

  test("both moves mate in 4 => equal, not a blunder (S23)", async () => {
    // Same position; stub: best (Qxf7#) is top => before = mate 1 for mover. Wrong Qh5xe5+ also keeps a mate.
    const { engine } = queueEngine([
      { cp: null, mate: 1, bestMoveUci: "h5f7", pvUci: ["h5f7"] },
      { cp: null, mate: -1, bestMoveUci: "c6e5", pvUci: ["c6e5"] }, // black POV: black gets mated in 1 => mover mate 1
    ]);
    const f = await buildFacts(
      { fen: SCHOLAR, wrongMove: "Qxe5+", correctMove: "Qxf7#", cpLoss: 20 },
      engine,
    );
    expect(f.evalAfterWrong).toEqual({ cp: null, mate: 1 });
    expect(f.severity).toBe("equal");
  });

  test("stalemate trap: wrong move stalemates a won position (T1)", async () => {
    // Qc8# is top => before = mate 1. Qc7 is stalemate => terminal child, so NO second engine call.
    const { engine, calls } = queueEngine([
      { cp: null, mate: 1, bestMoveUci: "c1c8", pvUci: ["c1c8"] },
    ]);
    const f = await buildFacts(
      { fen: STALEMATE_FEN, wrongMove: "Qc7", correctMove: "Qc8#", cpLoss: null },
      engine,
    );
    expect(calls()).toBe(1);
    expect(f.wrong?.givesStalemate).toBe(true);
    expect(f.reply).toBeNull();
    expect(f.evalAfterWrong).toEqual({ cp: 0, mate: null });
    expect(f.severity).toBe("decisive");
  });

  test("engine answering 'bestmove (none)' yields no reply instead of crashing", async () => {
    const { engine } = queueEngine([
      { cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] },
      { cp: -25, mate: null, bestMoveUci: "(none)", pvUci: [] },
    ]);
    const f = await buildFacts({ fen: START, wrongMove: "d4", correctMove: "e4", cpLoss: null }, engine);
    expect(f.reply).toBeNull();
    expect(f.refutationPvSan).toEqual([]);
  });

  test("wrongMove === correctMove is flagged and needs no wrong-move eval", async () => {
    const { engine, calls } = queueEngine([
      { cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] },
    ]);
    const f = await buildFacts({ fen: START, wrongMove: "e4", correctMove: "e4", cpLoss: null }, engine);
    expect(f.wrongEqualsBest).toBe(true);
    expect(calls()).toBe(1);
  });

  test("missed move (wrongMove null) still builds facts and uses cpLoss for severity", async () => {
    const { engine } = queueEngine([{ cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] }]);
    const f = await buildFacts({ fen: START, wrongMove: null, correctMove: "e4", cpLoss: 2.1 }, engine);
    expect(f.wrong).toBeNull();
    expect(f.severity).toBe("blunder");
  });

  test("invalid input raises CoachInputError", async () => {
    const { engine } = queueEngine([]);
    await expect(buildFacts({ fen: "not a fen", wrongMove: null, correctMove: "e4", cpLoss: null }, engine)).rejects.toBeInstanceOf(CoachInputError);
    await expect(buildFacts({ fen: START, wrongMove: null, correctMove: "Qh5", cpLoss: null }, engine)).rejects.toBeInstanceOf(CoachInputError);
    await expect(buildFacts({ fen: START, wrongMove: "Ke3", correctMove: "e4", cpLoss: null }, engine)).rejects.toBeInstanceOf(CoachInputError);
  });
});

describe("stepsFromFacts", () => {
  const captions = { wrong: "w", reply: "r", best: "b", why: "y" };

  test("blunder yields wrong, reply, best, highlight — all legal in the client's reset order", async () => {
    const { engine } = queueEngine([
      { cp: null, mate: 1, bestMoveUci: "h5f7", pvUci: ["h5f7"] },
      { cp: 30, mate: null, bestMoveUci: "g8f6", pvUci: ["g8f6"] },
    ]);
    const f = await buildFacts({ fen: SCHOLAR, wrongMove: "Nf3", correctMove: "Qxf7#", cpLoss: null }, engine);
    const steps = stepsFromFacts(f, captions);
    expect(steps.map((s) => s.action.type)).toEqual(["playMove", "playMove", "playMove", "highlight"]);
    // Client replays wrong -> reply cumulatively, then resets to the start FEN before the best move.
    const c = new Chess(SCHOLAR);
    for (const s of steps.slice(0, 2)) {
      expect(s.action.type === "playMove" && c.move(s.action.san)).toBeTruthy();
    }
    const fresh = new Chess(SCHOLAR);
    const bestStep = steps[2].action;
    expect(bestStep.type === "playMove" && fresh.move(bestStep.san)).toBeTruthy();
    const hl = steps[3].action;
    expect(hl.type === "highlight" && hl.squares.every((s) => /^[a-h][1-8]$/.test(s))).toBe(true);
  });

  test("equal severity drops the reply beat; missed move drops the wrong beat", async () => {
    const eq = await buildFacts(
      { fen: START, wrongMove: "d4", correctMove: "e4", cpLoss: null },
      queueEngine([
        { cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] },
        { cp: -25, mate: null, bestMoveUci: "d7d5", pvUci: ["d7d5"] },
      ]).engine,
    );
    expect(stepsFromFacts(eq, captions).length).toBe(3);

    const missed = await buildFacts(
      { fen: START, wrongMove: null, correctMove: "e4", cpLoss: 1 },
      queueEngine([{ cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] }]).engine,
    );
    expect(stepsFromFacts(missed, captions).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test server/tests/coach_facts.test.ts`
Expected: FAIL — cannot find module `../services/coach_facts`.

- [ ] **Step 3: Implement** — `server/services/coach_facts.ts`

```ts
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import type { EngineEval } from "./engine_native";
import type { EvalEngine } from "./coach_engine";

export const COACH_ENGINE_DEPTH = 14;

export class CoachInputError extends Error {}

export type Severity = "equal" | "inaccuracy" | "mistake" | "blunder" | "decisive";

/** cp in centipawns or mate-in-N, always from the MOVER's point of view. */
export interface Score {
  cp: number | null;
  mate: number | null;
}

export interface PieceRef {
  color: Color;
  type: PieceSymbol;
  square: Square;
}

export interface MoveFacts {
  san: string;
  from: Square;
  to: Square;
  piece: PieceSymbol;
  captured: PieceSymbol | null;
  givesCheck: boolean;
  givesMate: boolean;
  givesStalemate: boolean;
  /** Enemy pieces that attack the landing square right after the move. */
  landingAttackers: PieceRef[];
  /** Friendly pieces that guard the landing square. */
  landingDefenders: PieceRef[];
  /** Enemy pieces the moved piece attacks from its landing square. */
  attacks: PieceRef[];
}

export interface CoachFacts {
  fen: string;
  mover: Color;
  moverName: "White" | "Black";
  wrong: MoveFacts | null;
  best: MoveFacts;
  reply: MoveFacts | null;
  evalBefore: Score;
  evalAfterWrong: Score | null;
  evalAfterBest: Score;
  lossPawns: number;
  severity: Severity;
  bestPvSan: string[];
  refutationPvSan: string[];
  wrongEqualsBest: boolean;
  pieces: PieceRef[];
  /** Every position the coach text may legitimately describe. */
  positions: string[];
  engineDepth: number;
}

export interface CoachInput {
  fen: string;
  wrongMove: string | null;
  correctMove: string;
  /** Pawns, from the client. Only used when wrongMove is null. */
  cpLoss: number | null;
  phase?: string;
  framing?: string;
}

export interface CoachCaptions {
  wrong: string;
  reply: string;
  best: string;
  why: string;
}

export type CoachStepOut = {
  text: string;
  action:
    | { type: "playMove"; san: string; highlight?: "red" | "green" | "amber" }
    | { type: "highlight"; squares: string[]; color?: "red" | "green" | "amber" | "blue" };
};

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
export const pieceName = (t: PieceSymbol): string => PIECE_NAMES[t];

export function scoreToPawns(s: Score): number {
  if (s.mate !== null) {
    const n = Math.min(Math.abs(s.mate), 50);
    return s.mate > 0 ? 100 - n : -(100 - n);
  }
  return (s.cp ?? 0) / 100;
}

const flip = (s: Score): Score => ({
  cp: s.cp === null ? null : -s.cp,
  mate: s.mate === null ? null : -s.mate,
});

export function severityFor(
  lossPawns: number,
  opts: { allowsMate: boolean; flippedToLost: boolean; stalemateThrow: boolean },
): Severity {
  if (opts.allowsMate || opts.flippedToLost || opts.stalemateThrow) return "decisive";
  if (lossPawns < 0.3) return "equal";
  if (lossPawns < 0.7) return "inaccuracy";
  if (lossPawns < 1.5) return "mistake";
  return "blunder";
}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function uciToSan(fen: string, uci: string): string | null {
  if (!UCI_RE.test(uci)) return null;
  try {
    const m = new Chess(fen).move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    return m ? m.san : null;
  } catch {
    return null;
  }
}

export function pvToSan(fen: string, pv: string[], maxPlies = 4): string[] {
  const out: string[] = [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return out;
  }
  for (const uci of pv.slice(0, maxPlies)) {
    if (!UCI_RE.test(uci)) break;
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!m) break;
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

function piecesOf(chess: Chess): PieceRef[] {
  const out: PieceRef[] = [];
  for (const row of chess.board()) {
    for (const p of row) if (p) out.push({ color: p.color, type: p.type, square: p.square });
  }
  return out;
}

export function describeMove(fen: string, san: string): { facts: MoveFacts; fenAfter: string } {
  const chess = new Chess(fen);
  const mv = chess.move(san); // throws on an illegal move
  const me = mv.color;
  const them: Color = me === "w" ? "b" : "w";
  const ref = (sq: Square): PieceRef | null => {
    const p = chess.get(sq);
    return p ? { color: p.color, type: p.type, square: sq } : null;
  };
  const refs = (sqs: Square[]): PieceRef[] =>
    sqs.map(ref).filter((r): r is PieceRef => r !== null);

  const facts: MoveFacts = {
    san: mv.san,
    from: mv.from,
    to: mv.to,
    piece: mv.piece,
    captured: mv.captured ?? null,
    givesCheck: chess.inCheck(),
    givesMate: chess.isCheckmate(),
    givesStalemate: chess.isStalemate(),
    landingAttackers: refs(chess.attackers(mv.to, them)),
    landingDefenders: refs(chess.attackers(mv.to, me)),
    attacks: piecesOf(chess).filter(
      (p) => p.color === them && chess.attackers(p.square, me).includes(mv.to),
    ),
  };
  return { facts, fenAfter: chess.fen() };
}

/** Score of the position after the mover's move, from the mover's POV. */
async function scoreAfter(
  fenAfter: string,
  engine: EvalEngine,
  depth: number,
): Promise<{ score: Score; ev: EngineEval | null }> {
  const c = new Chess(fenAfter);
  if (c.isCheckmate()) return { score: { cp: null, mate: 1 }, ev: null };
  if (c.isStalemate() || c.isDraw()) return { score: { cp: 0, mate: null }, ev: null };
  const ev = await engine.evaluate(fenAfter, depth);
  return { score: flip({ cp: ev.cp, mate: ev.mate }), ev };
}

const stripDecor = (san: string): string => san.replace(/[+#]/g, "");

export async function buildFacts(
  input: CoachInput,
  engine: EvalEngine,
  depth: number = COACH_ENGINE_DEPTH,
): Promise<CoachFacts> {
  let base: Chess;
  try {
    base = new Chess(input.fen);
  } catch {
    throw new CoachInputError("fen is not a valid position");
  }
  const mover = base.turn();

  let best: ReturnType<typeof describeMove>;
  try {
    best = describeMove(input.fen, input.correctMove);
  } catch {
    throw new CoachInputError(`correctMove ${input.correctMove} is not legal in this position`);
  }
  let wrong: ReturnType<typeof describeMove> | null = null;
  if (input.wrongMove) {
    try {
      wrong = describeMove(input.fen, input.wrongMove);
    } catch {
      throw new CoachInputError(`wrongMove ${input.wrongMove} is not legal in this position`);
    }
  }
  const wrongEqualsBest = wrong !== null && stripDecor(wrong.facts.san) === stripDecor(best.facts.san);

  // Evaluation of the position itself (mover to move => already the mover's POV).
  const before = await engine.evaluate(input.fen, depth);
  const evalBefore: Score = { cp: before.cp, mate: before.mate };
  const topSan = uciToSan(input.fen, before.bestMoveUci);

  // The best move's value: if it is the engine's own top move it equals evalBefore.
  let evalAfterBest: Score = evalBefore;
  let bestPvSan = pvToSan(input.fen, before.pvUci);
  if (topSan === null || stripDecor(topSan) !== stripDecor(best.facts.san)) {
    const r = await scoreAfter(best.fenAfter, engine, depth);
    evalAfterBest = r.score;
    bestPvSan = [best.facts.san, ...(r.ev ? pvToSan(best.fenAfter, r.ev.pvUci, 3) : [])];
  }

  let evalAfterWrong: Score | null = null;
  let reply: ReturnType<typeof describeMove> | null = null;
  let refutationPvSan: string[] = [];
  if (wrong && !wrongEqualsBest) {
    const r = await scoreAfter(wrong.fenAfter, engine, depth);
    evalAfterWrong = r.score;
    if (r.ev) {
      const replySan = uciToSan(wrong.fenAfter, r.ev.bestMoveUci);
      if (replySan) reply = describeMove(wrong.fenAfter, replySan);
      refutationPvSan = pvToSan(wrong.fenAfter, r.ev.pvUci, 4);
    }
  }

  let lossPawns: number;
  if (evalAfterWrong) {
    lossPawns = Math.max(0, scoreToPawns(evalAfterBest) - scoreToPawns(evalAfterWrong));
  } else if (wrongEqualsBest) {
    lossPawns = 0;
  } else {
    lossPawns = input.cpLoss !== null && input.cpLoss > 0 ? input.cpLoss : 1.0;
  }

  const beforePawns = scoreToPawns(evalBefore);
  const afterWrongPawns = evalAfterWrong ? scoreToPawns(evalAfterWrong) : null;
  const severity: Severity = wrongEqualsBest
    ? "equal"
    : severityFor(lossPawns, {
        allowsMate: evalAfterWrong?.mate != null && evalAfterWrong.mate < 0,
        flippedToLost: afterWrongPawns !== null && beforePawns >= 1.5 && afterWrongPawns <= -1.5,
        stalemateThrow: !!wrong?.facts.givesStalemate && beforePawns >= 1.5,
      });

  const positions = [input.fen];
  if (wrong) positions.push(wrong.fenAfter);
  if (reply) positions.push(reply.fenAfter);
  positions.push(best.fenAfter);

  return {
    fen: input.fen,
    mover,
    moverName: mover === "w" ? "White" : "Black",
    wrong: wrong?.facts ?? null,
    best: best.facts,
    reply: reply?.facts ?? null,
    evalBefore,
    evalAfterWrong,
    evalAfterBest,
    lossPawns,
    severity,
    bestPvSan,
    refutationPvSan,
    wrongEqualsBest,
    pieces: piecesOf(base),
    positions,
    engineDepth: depth,
  };
}

export function stepsFromFacts(facts: CoachFacts, captions: CoachCaptions): CoachStepOut[] {
  const steps: CoachStepOut[] = [];
  if (facts.wrong && !facts.wrongEqualsBest) {
    steps.push({
      text: captions.wrong,
      action: { type: "playMove", san: facts.wrong.san, highlight: "red" },
    });
    if (facts.reply && facts.severity !== "equal") {
      steps.push({
        text: captions.reply,
        action: { type: "playMove", san: facts.reply.san, highlight: "red" },
      });
    }
  }
  steps.push({
    text: captions.best,
    action: { type: "playMove", san: facts.best.san, highlight: "green" },
  });
  const squares: string[] = [facts.best.to, ...facts.best.attacks.map((a) => a.square)].slice(0, 4);
  steps.push({ text: captions.why, action: { type: "highlight", squares, color: "blue" } });
  return steps;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test server/tests/coach_facts.test.ts && npm run typecheck:server`
Expected: all pass; typecheck clean. If a "both moves mate" or stalemate test disagrees with chess.js/Stockfish conventions, fix the *test fixture* only after confirming with `new Chess(fen)` in a scratch script — do not weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add server/services/coach_facts.ts server/tests/coach_facts.test.ts
git commit -m "feat(coach): engine-grounded facts, severity bands, and server-built steps"
```

---

### Task 3: Claim verifier and template fallback

**Files:**
- Create: `server/services/coach_verify.ts`
- Test: `server/tests/coach_verify.test.ts`

**Interfaces:**
- Consumes: `CoachFacts`, `CoachCaptions`, `pieceName` from `./coach_facts`.
- Produces:
  - `interface Verdict { ok: boolean; violations: string[] }`
  - `verifyClaims(text: string, facts: CoachFacts): Verdict`
  - `templateFromFacts(facts: CoachFacts): { concept: string; analysis: string; captions: CoachCaptions }`

- [ ] **Step 1: Write the failing tests** — `server/tests/coach_verify.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import type { EvalEngine } from "../services/coach_engine";
import type { EngineEval } from "../services/engine_native";
import { buildFacts, type CoachFacts } from "../services/coach_facts";
import { templateFromFacts, verifyClaims } from "../services/coach_verify";

const stub = (evals: EngineEval[]): EvalEngine => {
  let i = 0;
  return { evaluate: async () => evals[i++] };
};

const SCHOLAR = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const STALEMATE_FEN = "k7/8/1K6/8/8/8/8/2Q5 w - - 0 1";

async function scholarFacts(): Promise<CoachFacts> {
  return buildFacts(
    { fen: SCHOLAR, wrongMove: "Nf3", correctMove: "Qxf7#", cpLoss: null },
    stub([
      { cp: null, mate: 1, bestMoveUci: "h5f7", pvUci: ["h5f7"] },
      { cp: 30, mate: null, bestMoveUci: "g8f6", pvUci: ["g8f6"] },
    ]),
  );
}

describe("verifyClaims", () => {
  test("accepts true statements built from supplied moves and real pieces", async () => {
    const f = await scholarFacts();
    const v = verifyClaims(
      "Qxf7# is checkmate: the bishop on c4 attacks the pawn on f7. Nf3 lets Black defend with Nf6.",
      f,
    );
    expect(v).toEqual({ ok: true, violations: [] });
  });

  test("rejects a move the server did not supply", async () => {
    const f = await scholarFacts();
    const v = verifyClaims("Bxf7+ also wins material.", f);
    expect(v.ok).toBe(false);
    expect(v.violations.join(" ")).toContain("Bxf7");
  });

  test("rejects a piece that is not on the named square", async () => {
    const f = await scholarFacts();
    const v = verifyClaims("The knight on d7 guards the pawn.", f);
    expect(v.ok).toBe(false);
  });

  test("rejects a false attack claim (S09 'Ne4 attacks your queen' style)", async () => {
    const f = await scholarFacts();
    const v = verifyClaims("The knight on c6 attacks the queen on h5.", f);
    expect(v.ok).toBe(false);
    expect(v.violations.join(" ")).toMatch(/attack/i);
  });

  test("rejects a false 'undefended/hanging' claim (S02/S28 style)", async () => {
    const f = await scholarFacts();
    // The pawn on e5 is defended by the knight on c6.
    const v = verifyClaims("The pawn on e5 is undefended.", f);
    expect(v.ok).toBe(false);
  });

  test("rejects mate/check words when the facts contain neither (S14 style)", async () => {
    const f = await buildFacts(
      { fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", wrongMove: "d4", correctMove: "e4", cpLoss: null },
      stub([
        { cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] },
        { cp: -25, mate: null, bestMoveUci: "d7d5", pvUci: ["d7d5"] },
      ]),
    );
    expect(verifyClaims("e4 threatens checkmate on f7.", f).ok).toBe(false);
    expect(verifyClaims("e4 gives check.", f).ok).toBe(false);
    expect(verifyClaims("e4 controls the center.", f).ok).toBe(true);
  });
});

describe("templateFromFacts", () => {
  test("is built only from facts and passes its own verifier", async () => {
    const f = await scholarFacts();
    const t = templateFromFacts(f);
    const all = [t.analysis, t.concept, ...Object.values(t.captions)].join(" ");
    expect(verifyClaims(all, f)).toEqual({ ok: true, violations: [] });
    expect(t.analysis).toContain("Qxf7#");
    expect(t.analysis).toContain("checkmate");
  });

  test("stalemate case names the stalemate (T1)", async () => {
    const f = await buildFacts(
      { fen: STALEMATE_FEN, wrongMove: "Qc7", correctMove: "Qc8#", cpLoss: null },
      stub([{ cp: null, mate: 1, bestMoveUci: "c1c8", pvUci: ["c1c8"] }]),
    );
    const t = templateFromFacts(f);
    expect(t.analysis.toLowerCase()).toContain("stalemate");
    const all = [t.analysis, t.concept, ...Object.values(t.captions)].join(" ");
    expect(verifyClaims(all, f).ok).toBe(true);
  });

  test("equal severity does not invent a refutation", async () => {
    const f = await buildFacts(
      { fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", wrongMove: "d4", correctMove: "e4", cpLoss: null },
      stub([
        { cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] },
        { cp: -25, mate: null, bestMoveUci: "d7d5", pvUci: ["d7d5"] },
      ]),
    );
    const t = templateFromFacts(f);
    expect(t.analysis).toContain("close");
    expect(t.analysis).not.toContain("allows");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test server/tests/coach_verify.test.ts`
Expected: FAIL — cannot find module `../services/coach_verify`.

- [ ] **Step 3: Implement** — `server/services/coach_verify.ts`

```ts
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { pieceName, type CoachCaptions, type CoachFacts } from "./coach_facts";

export interface Verdict {
  ok: boolean;
  violations: string[];
}

const TYPE_BY_NAME: Record<string, PieceSymbol> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};
const PIECE = "(pawn|knight|bishop|rook|queen|king)";
const SQ = "([a-h][1-8])";

const SAN_TOKEN =
  /\b(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?)[+#]?/g;

const strip = (san: string): string => san.replace(/[+#]/g, "");

export function verifyClaims(text: string, facts: CoachFacts): Verdict {
  const violations: string[] = [];
  const boards = facts.positions.map((f) => new Chess(f));
  const typeOf = (name: string): PieceSymbol => TYPE_BY_NAME[name.toLowerCase()];

  // 1. Every move token must be one the server supplied.
  const allowed = new Set<string>(
    [
      facts.best.san,
      facts.wrong?.san,
      facts.reply?.san,
      ...facts.bestPvSan,
      ...facts.refutationPvSan,
    ]
      .filter((s): s is string => !!s)
      .map(strip),
  );
  for (const m of text.matchAll(SAN_TOKEN)) {
    if (!allowed.has(strip(m[0]))) violations.push(`unsupplied move ${m[0]}`);
  }

  // 2. "<piece> on <square>" must exist in some position the text may describe.
  for (const m of text.matchAll(new RegExp(`${PIECE} (?:on|at) ${SQ}`, "gi"))) {
    const t = typeOf(m[1]);
    const sq = m[2] as Square;
    if (!boards.some((b) => b.get(sq)?.type === t)) {
      violations.push(`no ${m[1].toLowerCase()} on ${sq}`);
    }
  }

  // 3. "<piece> on <sq> attacks/defends <piece> [on <sq>]" must hold on some board.
  const relation = new RegExp(
    `${PIECE} on ${SQ} (attacks|attacking|hits|threatens|threatening|defends|defending) (?:the |your |their |a )?${PIECE}(?: on ${SQ})?`,
    "gi",
  );
  for (const m of text.matchAll(relation)) {
    const srcType = typeOf(m[1]);
    const srcSq = m[2] as Square;
    const defending = /^defend/i.test(m[3]);
    const dstType = typeOf(m[4]);
    const dstSq = m[5] as Square | undefined;
    const holds = boards.some((b) => {
      const src = b.get(srcSq);
      if (!src || src.type !== srcType) return false;
      return b.board().flat().some((t) => {
        if (!t || t.type !== dstType) return false;
        if (dstSq && t.square !== dstSq) return false;
        if (defending ? t.color !== src.color : t.color === src.color) return false;
        return b.attackers(t.square, src.color).includes(srcSq);
      });
    });
    if (!holds) violations.push(`false claim: ${m[0]}`);
  }

  // 4. "<piece> on <sq> is hanging/undefended" must hold on some board.
  const hanging = new RegExp(
    `${PIECE} on ${SQ} (?:is |are )?(hanging|undefended|unprotected|loose|en prise)`,
    "gi",
  );
  for (const m of text.matchAll(hanging)) {
    const t = typeOf(m[1]);
    const sq = m[2] as Square;
    const needsAttacker = /hanging|en prise/i.test(m[3]);
    const holds = boards.some((b) => {
      const p = b.get(sq);
      if (!p || p.type !== t) return false;
      const enemy: Color = p.color === "w" ? "b" : "w";
      const defended = b.attackers(sq, p.color).length > 0;
      const attacked = b.attackers(sq, enemy).length > 0;
      return !defended && (!needsAttacker || attacked);
    });
    if (!holds) violations.push(`false claim: ${m[0]}`);
  }

  // 5. Mate / stalemate / check words need a supporting fact.
  const moves = [facts.best, facts.wrong, facts.reply].filter((x): x is NonNullable<typeof x> => !!x);
  const mateInvolved =
    moves.some((mv) => mv.givesMate) ||
    facts.evalBefore.mate !== null ||
    facts.evalAfterBest.mate !== null ||
    facts.evalAfterWrong?.mate != null;
  if (/\b(checkmate|checkmates|mate|mating)\b/i.test(text) && !mateInvolved) {
    violations.push("mentions mate but the engine facts show none");
  }
  if (/\bstalemate\b/i.test(text) && !moves.some((mv) => mv.givesStalemate)) {
    violations.push("mentions stalemate but no move stalemates");
  }
  if (/\bcheck(?:s|ed|ing)?\b/i.test(text) && !mateInvolved && !moves.some((mv) => mv.givesCheck)) {
    violations.push("mentions check but no move gives check");
  }

  return { ok: violations.length === 0, violations };
}

export function templateFromFacts(f: CoachFacts): {
  concept: string;
  analysis: string;
  captions: CoachCaptions;
} {
  const loss = f.lossPawns >= 50 ? "a decisive amount of material" : `${f.lossPawns.toFixed(1)} pawns`;
  const bestBits = [
    f.best.captured ? `wins the ${pieceName(f.best.captured)}` : null,
    f.best.givesMate ? "delivers checkmate" : f.best.givesCheck ? "gives check" : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const bestLine = `${f.best.san} is the engine's move${bestBits ? `: it ${bestBits}` : ""}.`;

  let wrongLine = "";
  if (f.wrong && !f.wrongEqualsBest) {
    if (f.wrong.givesStalemate) {
      wrongLine = `${f.wrong.san} is stalemate, a draw instead of a win.`;
    } else if (f.severity === "equal") {
      wrongLine = `${f.wrong.san} is close in the engine's eyes (${f.lossPawns.toFixed(1)} pawns), so this is a small point.`;
    } else {
      const replyBit = f.reply
        ? ` ${f.reply.san}${f.reply.captured ? `, which captures your ${pieceName(f.reply.captured)}` : ""}`
        : " a strong reply";
      wrongLine = `${f.wrong.san} allows${replyBit}; the engine puts the cost at ${loss}.`;
    }
  }

  const mateInvolved = f.best.givesMate || f.evalBefore.mate !== null;
  const concept = mateInvolved
    ? "Checkmate pattern"
    : f.reply?.captured
      ? "Loose piece"
      : f.best.captured
        ? "Winning material"
        : f.best.givesCheck
          ? "Forcing moves"
          : "Piece activity";

  return {
    concept,
    analysis: [bestLine, wrongLine].filter(Boolean).join(" "),
    captions: {
      wrong: f.wrong ? `${f.wrong.san} was played.` : "",
      reply: f.reply ? `${f.reply.san} is the engine's best answer.` : "",
      best: `${f.best.san} is the move.`,
      why: `Engine depth ${f.engineDepth}: about ${loss} at stake.`,
    },
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test server/tests/coach_verify.test.ts && npm run typecheck:server`
Expected: all pass. If the "true statements" test fails on the bishop/pawn claim, confirm with chess.js that `attackers("f7","w")` includes `c4` in the SCHOLAR position (it does, via d5/e6) before touching the verifier.

- [ ] **Step 5: Commit**

```bash
git add server/services/coach_verify.ts server/tests/coach_verify.test.ts
git commit -m "feat(coach): claim verifier and deterministic template fallback"
```

---

### Task 4: Prompt, response schema, and `explainBlunderCore`

**Files:**
- Create: `server/services/coach_prompt.ts`
- Create: `server/services/coach.ts`
- Test: `server/tests/coach_core.test.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 1–3.
- Produces:
  - `interface MastersSummary { white: number; draws: number; black: number; moves: Array<{ san: string; white: number; draws: number; black: number }> }` (matches what `fetchMastersData` in `analyze.ts` returns)
  - `COACH_RESPONSE_SCHEMA` (Gemini `responseSchema` object), `buildCoachPrompt(facts, ctx)`, `parseCoachJson(raw)`
  - `interface CoachDeps { engine: EvalEngine; gemini(prompt: string, timeoutMs: number): Promise<string | null>; masters(fen: string): Promise<MastersSummary | null>; cache: { get(k: CoachCacheKey): CoachCachePayload | null; put(k: CoachCacheKey, v: CoachCachePayload): void }; now?: () => number; budgetMs?: number }`
  - `interface CoachResult { status: number; body: Record<string, unknown> }`
  - `explainBlunderCore(raw: unknown, deps: CoachDeps): Promise<CoachResult>`

- [ ] **Step 1: Write the failing tests** — `server/tests/coach_core.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import type { EngineEval } from "../services/engine_native";
import type { EvalEngine } from "../services/coach_engine";
import type { CoachCacheKey, CoachCachePayload } from "../services/coach_cache";
import { explainBlunderCore, type CoachDeps } from "../services/coach";

const SCHOLAR = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeEngine(evals: EngineEval[]) {
  let calls = 0;
  const engine: EvalEngine = {
    async evaluate() {
      const ev = evals[calls++];
      if (!ev) throw new Error("unexpected engine call");
      return ev;
    },
  };
  return { engine, calls: () => calls };
}

const scholarEvals = (): EngineEval[] => [
  { cp: null, mate: 1, bestMoveUci: "h5f7", pvUci: ["h5f7"] },
  { cp: 30, mate: null, bestMoveUci: "g8f6", pvUci: ["g8f6"] },
];

const goodModelJson = JSON.stringify({
  concept: "Checkmate pattern",
  analysis:
    "Qxf7# is checkmate because the bishop on c4 supports the queen. Nf3 lets Black defend with Nf6.",
  captions: {
    wrong: "Nf3 develops but misses the mate.",
    reply: "Nf6 defends against the threat.",
    best: "Qxf7# ends the game.",
    why: "The f7 pawn is only guarded by the king.",
  },
});
const lyingModelJson = JSON.stringify({
  concept: "Fork",
  analysis: "Bxf7+ wins because the knight on d7 attacks the queen.",
  captions: { wrong: "x", reply: "y", best: "z", why: "w" },
});

function harness(over: Partial<CoachDeps> & { evals?: EngineEval[]; geminiReplies?: Array<string | null> }) {
  const store = new Map<string, CoachCachePayload>();
  const k = (key: CoachCacheKey) => JSON.stringify(key);
  const replies = [...(over.geminiReplies ?? [goodModelJson])];
  let geminiCalls = 0;
  const { engine, calls } = makeEngine(over.evals ?? scholarEvals());
  const deps: CoachDeps = {
    engine: over.engine ?? engine,
    gemini: over.gemini ?? (async () => (geminiCalls++, replies.shift() ?? null)),
    masters: over.masters ?? (async () => null),
    cache: { get: (key) => store.get(k(key)) ?? null, put: (key, v) => void store.set(k(key), v) },
    now: over.now,
    budgetMs: over.budgetMs,
  };
  return { deps, store, engineCalls: calls, geminiCalls: () => geminiCalls };
}

const body = { fen: SCHOLAR, wrongMove: "Nf3", correctMove: "Qxf7#", cpLoss: null };

describe("explainBlunderCore", () => {
  test("happy path: model text verified, steps built by the server, result cached", async () => {
    const h = harness({});
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("model");
    expect((r.body.steps as unknown[]).length).toBe(4);
    expect(h.store.size).toBe(1);
    // Second call is a pure cache hit: no engine, no Gemini.
    const before = { e: h.engineCalls(), g: h.geminiCalls() };
    const again = await explainBlunderCore(body, h.deps);
    expect(again.status).toBe(200);
    expect({ e: h.engineCalls(), g: h.geminiCalls() }).toEqual(before);
  });

  test("a lying answer is retried once; a second lie falls back to the template and is cached", async () => {
    const h = harness({ geminiReplies: [lyingModelJson, lyingModelJson] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("template");
    expect(h.geminiCalls()).toBe(2);
    expect(h.store.size).toBe(1);
  });

  test("a lying answer followed by a good one succeeds on the retry", async () => {
    const h = harness({ geminiReplies: [lyingModelJson, goodModelJson] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.body.source).toBe("model");
    expect(h.geminiCalls()).toBe(2);
  });

  test("malformed JSON counts as a rejected attempt", async () => {
    const h = harness({ geminiReplies: ["not json at all", goodModelJson] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.body.source).toBe("model");
  });

  test("Gemini failing every time is a 502 and nothing is cached", async () => {
    const h = harness({ geminiReplies: [null, null] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(502);
    expect(r.body.error).toBeTruthy();
    expect(h.store.size).toBe(0);
  });

  test("engine failure is a 503", async () => {
    const h = harness({
      engine: { evaluate: async () => { throw new Error("stockfish binary not found"); } },
    });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(503);
    expect(h.store.size).toBe(0);
  });

  test("bad input is a 400, never a 500", async () => {
    const h = harness({});
    for (const bad of [
      null,
      "str",
      {},
      { fen: START },
      { fen: "not a fen", correctMove: "e4" },
      { fen: START, correctMove: "Qh5" },
      { fen: START, correctMove: "e4", wrongMove: "Ke3" },
      { fen: START, correctMove: "e4", wrongMove: 5 },
    ]) {
      const r = await explainBlunderCore(bad, h.deps);
      expect(r.status).toBe(400);
    }
    expect(h.engineCalls()).toBe(0);
  });

  test("wrongMove === correctMove returns a card with no engine or Gemini call", async () => {
    const h = harness({});
    const r = await explainBlunderCore({ fen: START, wrongMove: "e4", correctMove: "e4" }, h.deps);
    expect(r.status).toBe(200);
    expect(String(r.body.analysis)).toContain("e4");
    expect(r.body.steps).toBeNull();
    expect(h.engineCalls()).toBe(0);
    expect(h.geminiCalls()).toBe(0);
  });

  test("stalemate trap yields a truthful template card when the model lies", async () => {
    const h = harness({
      evals: [{ cp: null, mate: 1, bestMoveUci: "c1c8", pvUci: ["c1c8"] }],
      geminiReplies: [lyingModelJson, lyingModelJson],
    });
    const r = await explainBlunderCore(
      { fen: "k7/8/1K6/8/8/8/8/2Q5 w - - 0 1", wrongMove: "Qc7", correctMove: "Qc8#" },
      h.deps,
    );
    expect(r.status).toBe(200);
    expect(String(r.body.analysis).toLowerCase()).toContain("stalemate");
  });

  test("time budget: skips Gemini when too little time is left, returns an uncached template", async () => {
    let t = 0;
    const evals = scholarEvals();
    let i = 0;
    const h = harness({
      now: () => t,
      budgetMs: 9000,
      // Each engine call "takes" 5s on the fake clock; two calls leave < 2500ms of the 9s budget.
      engine: { evaluate: async () => { t += 5000; return evals[i++]; } },
    });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("template");
    expect(h.geminiCalls()).toBe(0);
    expect(h.store.size).toBe(0); // a time-budget template must not be cached
  });

  test("masters lookup failure never breaks the request", async () => {
    const h = harness({ masters: async () => { throw new Error("lichess down"); } });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test server/tests/coach_core.test.ts`
Expected: FAIL — cannot find module `../services/coach`.

- [ ] **Step 3: Implement** — `server/services/coach_prompt.ts`

```ts
import { pieceName, scoreToPawns, type CoachCaptions, type CoachFacts, type MoveFacts, type PieceRef, type Score } from "./coach_facts";

export interface MastersSummary {
  white: number;
  draws: number;
  black: number;
  moves: Array<{ san: string; white: number; draws: number; black: number }>;
}

/** Gemini `responseSchema` (OpenAPI subset). */
export const COACH_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    concept: { type: "STRING" },
    analysis: { type: "STRING" },
    captions: {
      type: "OBJECT",
      properties: {
        wrong: { type: "STRING" },
        reply: { type: "STRING" },
        best: { type: "STRING" },
        why: { type: "STRING" },
      },
      required: ["wrong", "reply", "best", "why"],
    },
  },
  required: ["concept", "analysis", "captions"],
} as const;

const colorName = (c: "w" | "b") => (c === "w" ? "White" : "Black");
const refText = (p: PieceRef) => `${colorName(p.color)} ${pieceName(p.type)} on ${p.square}`;

function evalText(s: Score): string {
  if (s.mate !== null) {
    return `mate in ${Math.abs(s.mate)} for ${s.mate > 0 ? "you" : "your opponent"}`;
  }
  return `${(scoreToPawns(s) >= 0 ? "+" : "") + scoreToPawns(s).toFixed(2)} pawns (positive = good for you)`;
}

function moveText(label: string, m: MoveFacts): string {
  const parts = [
    `${label} ${m.san}: ${pieceName(m.piece)} from ${m.from} to ${m.to}`,
    m.captured ? `captures a ${pieceName(m.captured)}` : "captures nothing",
    m.givesMate ? "gives CHECKMATE" : m.givesCheck ? "gives check" : "gives no check",
    m.givesStalemate ? "STALEMATES the opponent (a draw)" : null,
    `attacked on ${m.to} by: ${m.landingAttackers.map(refText).join(", ") || "nobody"}`,
    `defended on ${m.to} by: ${m.landingDefenders.map(refText).join(", ") || "nobody"}`,
    `attacks: ${m.attacks.map(refText).join(", ") || "no enemy piece"}`,
  ].filter(Boolean);
  return `- ${parts.join("; ")}`;
}

export function buildCoachPrompt(
  f: CoachFacts,
  ctx: { phase?: string; framing?: string; masters?: MastersSummary | null; violations?: string[] },
): string {
  const student = f.moverName;
  const lines: string[] = [
    `You are a chess coach for a 1400-1800 club player. Explain ONE move. You narrate engine facts; you do not analyze. Every claim about an attack, defense, capture, check or material MUST come from the FACTS block. If FACTS does not support a claim, do not make it.`,
    ``,
    `The student plays ${student}. "You"/"your" always means ${student}.`,
    `POSITION (FEN): ${f.fen}`,
    `PIECES: ${f.pieces.map(refText).join(", ")}`,
    ctx.phase ? `Game phase: ${ctx.phase}` : ``,
    ``,
    `FACTS (Stockfish depth ${f.engineDepth} + rules engine; treat as ground truth):`,
    `- Eval before the move: ${evalText(f.evalBefore)}`,
  ];
  if (f.wrong && f.evalAfterWrong) {
    lines.push(
      `- Eval after the played move ${f.wrong.san}: ${evalText(f.evalAfterWrong)} (loss ${f.lossPawns >= 50 ? "decisive" : f.lossPawns.toFixed(2) + " pawns"}; severity: ${f.severity})`,
    );
  }
  lines.push(`- Eval after the best move ${f.best.san}: ${evalText(f.evalAfterBest)}`);
  lines.push(`- Best line: ${f.bestPvSan.join(" ") || f.best.san}`);
  if (f.wrong) lines.push(moveText("Played move", f.wrong));
  lines.push(moveText("Best move", f.best));
  if (f.reply) {
    lines.push(moveText("Engine's best reply to the played move", f.reply));
    lines.push(`- Refutation line: ${f.refutationPvSan.join(" ")}`);
  }
  if (ctx.masters && ctx.masters.moves.length > 0) {
    const total = ctx.masters.white + ctx.masters.draws + ctx.masters.black;
    const top = ctx.masters.moves
      .slice(0, 3)
      .map((m) => `${m.san} ${Math.round(((m.white + m.draws + m.black) / total) * 100)}%`)
      .join(", ");
    lines.push(`- Masters play from here: ${top}`);
  }
  lines.push(
    ``,
    `RULES`,
    `1. Name only pieces and squares from PIECES or FACTS. Never invent a piece or square.`,
    `2. Never write attacks, defends, hangs, wins, forks, pins, or threatens mate unless FACTS states it. Never write check, checkmate or stalemate unless FACTS says so.`,
    `3. Mention only these moves: ${[f.wrong?.san, f.reply?.san, f.best.san].filter(Boolean).join(", ")}${f.bestPvSan.length ? " and the lines above" : ""}. Do not suggest any other move.`,
    f.severity === "equal"
      ? `4. The moves are nearly equal. Say both are fine and give ONE practical reason to prefer ${f.best.san}. Do NOT invent a tactic or refutation.`
      : `4. Explain what ${f.best.san} DOES, and what the played move ALLOWS (use the engine's reply). Do not merely restate the move.`,
    `5. Speak to the student as "you". "analysis" is at most 55 words; each caption at most 14 words.`,
    ctx.framing ? `CONTEXT: ${ctx.framing}` : ``,
  );
  if (ctx.violations && ctx.violations.length > 0) {
    lines.push(
      ``,
      `YOUR PREVIOUS ANSWER WAS REJECTED for these unsupported claims: ${ctx.violations.join("; ")}. Rewrite it using only the FACTS.`,
    );
  }
  lines.push(
    ``,
    `OUTPUT JSON: { "concept": <one specific concept, not "tactics">, "analysis": <what the best move does + what the played move allows + one principle>, "captions": { "wrong": <caption for the played move>, "reply": <caption for the engine reply, or "" if none>, "best": <caption for the best move>, "why": <the key idea in one line> } }`,
  );
  return lines.filter((l) => l !== undefined).join("\n");
}

const clip = (s: unknown, max: number): string | null =>
  typeof s === "string" && s.trim().length > 0 ? s.trim().slice(0, max) : null;

export function parseCoachJson(
  raw: string,
): { concept: string; analysis: string; captions: CoachCaptions } | null {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  let obj: any;
  try {
    obj = JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
  const concept = clip(obj?.concept, 80);
  const analysis = clip(obj?.analysis, 700);
  const cap = obj?.captions;
  const best = clip(cap?.best, 160);
  const why = clip(cap?.why, 160);
  if (!concept || !analysis || !best || !why) return null;
  return {
    concept,
    analysis,
    captions: {
      wrong: clip(cap?.wrong, 160) ?? "",
      reply: clip(cap?.reply, 160) ?? "",
      best,
      why,
    },
  };
}
```

- [ ] **Step 4: Implement** — `server/services/coach.ts`

```ts
import { Chess } from "chess.js";
import type { CoachCacheKey, CoachCachePayload } from "./coach_cache";
import type { EvalEngine } from "./coach_engine";
import {
  buildFacts,
  CoachInputError,
  stepsFromFacts,
  type CoachCaptions,
  type CoachFacts,
  type CoachInput,
} from "./coach_facts";
import {
  buildCoachPrompt,
  parseCoachJson,
  type MastersSummary,
} from "./coach_prompt";
import { templateFromFacts, verifyClaims } from "./coach_verify";

export interface CoachDeps {
  engine: EvalEngine;
  gemini(prompt: string, timeoutMs: number): Promise<string | null>;
  masters(fen: string): Promise<MastersSummary | null>;
  cache: {
    get(k: CoachCacheKey): CoachCachePayload | null;
    put(k: CoachCacheKey, v: CoachCachePayload): void;
  };
  now?: () => number;
  /** Total server budget; must stay under the client's 10s request timeout. */
  budgetMs?: number;
}

export interface CoachResult {
  status: number;
  body: Record<string, unknown>;
}

const GEMINI_MAX_MS = 6000;
const GEMINI_MIN_LEFT_MS = 2500;
const stripDecor = (s: string) => s.replace(/[+#]/g, "");

function parseInput(raw: unknown): CoachInput | string {
  if (typeof raw !== "object" || raw === null) return "Request body must be a JSON object";
  const b = raw as Record<string, unknown>;
  if (typeof b.fen !== "string" || b.fen.length === 0 || b.fen.length > 100) {
    return "fen (string) is required";
  }
  if (typeof b.correctMove !== "string" || b.correctMove.length === 0 || b.correctMove.length > 12) {
    return "correctMove (string) is required";
  }
  if (b.wrongMove != null && (typeof b.wrongMove !== "string" || b.wrongMove.length > 12)) {
    return "wrongMove must be a string or null";
  }
  return {
    fen: b.fen,
    wrongMove: (b.wrongMove as string | null | undefined) || null,
    correctMove: b.correctMove,
    cpLoss: typeof b.cpLoss === "number" && Number.isFinite(b.cpLoss) ? b.cpLoss : null,
    phase: typeof b.phase === "string" ? b.phase.slice(0, 40) : undefined,
    framing: typeof b.framing === "string" ? b.framing.slice(0, 500) : undefined,
  };
}

function payload(
  facts: CoachFacts,
  t: { concept: string; analysis: string; captions: CoachCaptions },
  source: "model" | "template",
): CoachCachePayload {
  return {
    concept: t.concept,
    analysis: t.analysis,
    steps: stepsFromFacts(facts, t.captions),
    source,
  };
}

const ok = (p: CoachCachePayload): CoachResult => ({ status: 200, body: { ...p } });

export async function explainBlunderCore(raw: unknown, deps: CoachDeps): Promise<CoachResult> {
  const input = parseInput(raw);
  if (typeof input === "string") return { status: 400, body: { error: input } };

  // Same move as the best move: nothing to explain, and no engine needed.
  try {
    new Chess(input.fen).move(input.correctMove);
    if (input.wrongMove) new Chess(input.fen).move(input.wrongMove);
  } catch {
    return { status: 400, body: { error: "fen, correctMove and wrongMove must be legal in the position" } };
  }
  if (input.wrongMove && stripDecor(input.wrongMove) === stripDecor(input.correctMove)) {
    return {
      status: 200,
      body: {
        concept: "Correct move",
        analysis: `${input.correctMove} is the engine's move — you played it.`,
        steps: null,
        source: "template",
      },
    };
  }

  const key: CoachCacheKey = {
    fen: input.fen,
    wrongMove: input.wrongMove,
    correctMove: input.correctMove,
  };
  const cached = deps.cache.get(key);
  if (cached) return ok(cached);

  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? 9000;

  let facts: CoachFacts;
  let masters: MastersSummary | null;
  try {
    [facts, masters] = await Promise.all([
      buildFacts(input, deps.engine),
      deps.masters(input.fen).catch(() => null),
    ]);
  } catch (e) {
    if (e instanceof CoachInputError) return { status: 400, body: { error: e.message } };
    console.error("[coach] engine failure:", e);
    return { status: 503, body: { error: "Engine unavailable" } };
  }

  let violations: string[] = [];
  let geminiErrors = 0;
  let sawModelText = false;
  let skippedForTime = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const left = budget - (now() - started);
    if (left < GEMINI_MIN_LEFT_MS) {
      skippedForTime = true;
      break;
    }
    const text = await deps.gemini(
      buildCoachPrompt(facts, { phase: input.phase, framing: input.framing, masters, violations }),
      Math.min(GEMINI_MAX_MS, left),
    );
    if (text === null) {
      geminiErrors++;
      continue;
    }
    sawModelText = true;
    const parsed = parseCoachJson(text);
    if (!parsed) {
      violations = ["the answer was not valid JSON in the requested shape"];
      continue;
    }
    const all = [parsed.analysis, parsed.concept, ...Object.values(parsed.captions)].join(" ");
    const verdict = verifyClaims(all, facts);
    if (verdict.ok) {
      const p = payload(facts, parsed, "model");
      deps.cache.put(key, p);
      return ok(p);
    }
    violations = verdict.violations;
  }

  if (geminiErrors > 0 && !sawModelText) {
    return { status: 502, body: { error: "Coach unavailable (Gemini error)" } };
  }

  const p = payload(facts, templateFromFacts(facts), "template");
  // A template caused by rejected claims is deterministic and safe to cache;
  // one caused by running out of time is not — the next call should try Gemini.
  if (!skippedForTime) deps.cache.put(key, p);
  return ok(p);
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `bun test server/tests/coach_core.test.ts && npm run typecheck:server`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/coach_prompt.ts server/services/coach.ts server/tests/coach_core.test.ts
git commit -m "feat(coach): grounded prompt and explainBlunderCore with verifier, retry and budget"
```

---

### Task 5: Wire the route, warm the engine, guard the UI, remove dead code

**Files:**
- Modify: `server/routes/analyze.ts` (replace `explainBlunder` body; add `callGeminiJson`; delete dead helpers)
- Modify: `server/index.ts` (warm-up)
- Modify: `src/v2/BlunderExplanation.tsx:~161-175` (stale-response guard)
- Test: `server/tests/coach_route.test.ts`

**Interfaces:**
- Consumes: `explainBlunderCore`, `CoachDeps` (Task 4); `getCoachEngine`, `warmCoachEngine` (Task 1); `getCachedCoach`, `putCachedCoach` (Task 1); existing `fetchMastersData` in `analyze.ts`.
- Produces: `explainBlunder(req: Request): Promise<Response>` (same export name and route registration), `callGeminiJson(apiKey, prompt, timeoutMs): Promise<string | null>` (module-private).

- [ ] **Step 1: Write the failing route test** — `server/tests/coach_route.test.ts`

This covers only what the adapter adds (missing key, bad JSON, status passthrough); `explainBlunderCore` is already covered.

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { explainBlunder } from "../routes/analyze";

const post = (body: string) =>
  new Request("http://x/api/analyze/blunder", { method: "POST", body });

describe("explainBlunder adapter", () => {
  const saved = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  });

  test("missing GEMINI_API_KEY is a 503 JSON error, not a 200 'Coach unavailable' card", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await explainBlunder(post("{}"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/GEMINI_API_KEY/);
  });

  test("invalid JSON body is a 400", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const res = await explainBlunder(post("{not json"));
    expect(res.status).toBe(400);
  });

  test("valid JSON with missing fields is a 400 from the core", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const res = await explainBlunder(post(JSON.stringify({ fen: "" })));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test server/tests/coach_route.test.ts`
Expected: FAIL — the current handler returns HTTP 200 for the missing-key case.

- [ ] **Step 3: Replace `explainBlunder` in `server/routes/analyze.ts`**

Keep `fetchMastersData` (it precedes `explainBlunder`) and everything above it that `analyzePosition` uses. Replace the whole `export async function explainBlunder(...) { ... }` (from its signature to its closing brace at the end of the file) with:

```ts
import { explainBlunderCore } from "../services/coach";
import { getCoachEngine } from "../services/coach_engine";
import { getCachedCoach, putCachedCoach } from "../services/coach_cache";
import { COACH_RESPONSE_SCHEMA } from "../services/coach_prompt";

/** One schema-constrained Gemini call; null on any HTTP/network/timeout failure. */
async function callGeminiJson(
  apiKey: string,
  prompt: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 900,
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: COACH_RESPONSE_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      console.error("Gemini API error (coach):", await res.text());
      return null;
    }
    const data = (await res.json()) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (e) {
    console.error("Gemini fetch error (coach):", e);
    return null;
  }
}

/**
 * v2: Explain a specific blunder. Facts come from Stockfish + chess.js; Gemini
 * only writes the captions (see docs/superpowers/specs/2026-09-24-coach-engine-facts-design.md).
 * POST /api/analyze/blunder
 */
export async function explainBlunder(req: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Coach unavailable: GEMINI_API_KEY is not set on the server" },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = await explainBlunderCore(body, {
    engine: getCoachEngine(),
    gemini: (prompt, timeoutMs) => callGeminiJson(apiKey, prompt, timeoutMs),
    masters: fetchMastersData,
    cache: { get: (k) => getCachedCoach(k), put: (k, v) => putCachedCoach(k, v) },
  });
  return Response.json(result.body, { status: result.status });
}
```

Move the four new `import` lines to the top of the file with the existing `import { Chess } from "chess.js";`.

- [ ] **Step 4: Delete only the now-unreferenced helpers**

Run each check; delete a function only if its count is 1 (its own definition):

```bash
for f in computeMoveFacts describeRostersFromFen buildStepsPrompt validateAndNormalizeSteps callGeminiForSteps tryParseJson pieceFullName; do
  echo "$f: $(grep -rn "\b$f\b" server --include='*.ts' -r | grep -v node_modules | wc -l)"
done
```

Expected: `computeMoveFacts`, `describeRostersFromFen`, `buildStepsPrompt`, `validateAndNormalizeSteps`, `callGeminiForSteps`, `tryParseJson` now appear only at their own definitions (count 1) → delete them and the `CoachStepAction`/`CoachStep` types if nothing else references them (`grep -rn "CoachStep" server`). Keep `pieceFullName`, `describeBoardFromFen`, `describePositionContext`, `parseDemoLine`, `parseAnalysisText` if `analyzePosition` uses them (count > 1). Do not delete anything with count > 1.

- [ ] **Step 5: Warm the engine at boot** — `server/index.ts`

Add near the other imports:

```ts
import { warmCoachEngine } from "./services/coach_engine";
```

and directly after the `Bun.serve({ ... });` call (before the final `console.log(...API running...)`):

```ts
warmCoachEngine();
```

- [ ] **Step 6: Guard against stale responses** — `src/v2/BlunderExplanation.tsx`

Replace the effect at ~lines 161-175:

```tsx
  useEffect(() => {
    if (!needsExplanation) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setAnalysis(null);

    request<BlunderAnalysis>("/analyze/blunder", {
      method: "POST",
      body: JSON.stringify({ fen, wrongMove, correctMove, cpLoss, phase, framing }),
    })
      .then((a) => {
        if (!cancelled) setAnalysis(a);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // A slow response for a previous position must not overwrite the current card.
    return () => {
      cancelled = true;
    };
  }, [fen, wrongMove, correctMove, cpLoss, phase, needsExplanation, framing]);
```

Non-2xx responses already reject in `request()`, so the existing `error` fallback ("Engine recommends X") now handles Gemini/engine failures.

- [ ] **Step 7: Run tests, typecheck, lint, build**

Run:
```bash
bun test server/tests/coach_route.test.ts server/tests/coach_core.test.ts server/tests/coach_facts.test.ts server/tests/coach_verify.test.ts server/tests/coach_cache.test.ts && npm run typecheck:server && npx eslint src/v2/BlunderExplanation.tsx && ./dev.sh build; echo "EXIT=$?"
```
Expected: all tests pass; typecheck clean; no new lint errors; build `EXIT=0`. Then run the whole server suite once: `bun test server/tests` — Expected: no new failures versus before this task.

- [ ] **Step 8: Smoke-test the live endpoint against the DB copy**

Start a throwaway backend against the scratchpad DB copy (never :3001):

```bash
cd "/Users/kevin/Desktop/Work Spaces/Chess Forge"
set -a; source server/.env; set +a
CHESS_DB_PATH=/private/tmp/claude-501/-Users-kevin-Desktop-Work-Spaces-Chess-Forge/8d7ef58d-e437-45d4-9dbf-6243729a717a/scratchpad/test.db PORT=3004 bun run server/index.ts > /tmp/coach-smoke.log 2>&1 &
sleep 3
# Stalemate trap (audit T1): expect a truthful card that mentions stalemate
curl -s -m 15 -w "\nHTTP %{http_code} in %{time_total}s\n" -X POST localhost:3004/api/analyze/blunder \
  -H 'content-type: application/json' \
  -d '{"fen":"k7/8/1K6/8/8/8/8/2Q5 w - - 0 1","wrongMove":"Qc7","correctMove":"Qc8#","cpLoss":null}'
# Bad input: expect HTTP 400
curl -s -w "\nHTTP %{http_code}\n" -X POST localhost:3004/api/analyze/blunder -d '{"fen":"nope"}'
kill %1
```
Expected: first call 200, `analysis` mentions stalemate, `steps` legal; second call 400. Note the cold latency printed. (Replace the port/log path if scratch conventions differ; leave :3001/:3002 alone.)

- [ ] **Step 9: Commit**

```bash
git add server/routes/analyze.ts server/index.ts src/v2/BlunderExplanation.tsx server/tests/coach_route.test.ts
git commit -m "feat(coach): route uses grounded core; real errors; stale-response guard"
```

---

### Task 6: Fixture rerun, measurement, and docs

**Files:**
- Create: `server/tests/fixtures/coach_samples.json` (copy of the audit's 32 positions)
- Create: `scripts/coach_fixture_eval.ts`
- Modify: `docs/audit-2026-09/coach-eval.md` (append a "Rerun after fix" section)
- Modify: `CLAUDE.md` (coach notes)
- Modify: `docs/superpowers/specs/2026-09-24-coach-engine-facts-design.md` (record measured latency and the 9s budget)

**Interfaces:**
- Consumes: `explainBlunderCore`, `getCoachEngine`, `verifyClaims`, `buildFacts` (Tasks 1–4).
- Produces: a printed summary table and JSON (`pass` counts for the success criteria); no runtime interfaces.

- [ ] **Step 1: Copy the fixtures**

```bash
cd "/Users/kevin/Desktop/Work Spaces/Chess Forge"
mkdir -p server/tests/fixtures scripts
cp /private/tmp/claude-501/-Users-kevin-Desktop-Work-Spaces-Chess-Forge/8d7ef58d-e437-45d4-9dbf-6243729a717a/scratchpad/samples.json server/tests/fixtures/coach_samples.json
python3 -c "import json;d=json.load(open('server/tests/fixtures/coach_samples.json'));print(len(d), sorted(d[0].keys()))"
```
Expected: `32` and keys including `fenBefore`, `wrong`, `correct`, `cpLoss` (centipawns), `phase`. If the scratchpad file is gone, regenerate the 32 positions from `docs/audit-2026-09/coach-eval.md`'s FEN table plus `games.analysis_json`, or use the 10 spot-check FENs in that report as a smaller set and say so in the results.

- [ ] **Step 2: Write the harness** — `scripts/coach_fixture_eval.ts`

```ts
// usage: set -a; source server/.env; set +a; bun scripts/coach_fixture_eval.ts
import { Chess } from "chess.js";
import { readFileSync } from "fs";
import { explainBlunderCore } from "../server/services/coach";
import { getCoachEngine } from "../server/services/coach_engine";
import { COACH_RESPONSE_SCHEMA } from "../server/services/coach_prompt";

const MAX_GEMINI_CALLS = 80;
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY not set");

type Sample = { fenBefore: string; wrong: string | null; correct: string; cpLoss: number; phase: string };
const samples: Sample[] = JSON.parse(
  readFileSync(new URL("../server/tests/fixtures/coach_samples.json", import.meta.url), "utf8"),
);
const tricky = [
  { id: "T1-stalemate", fenBefore: "k7/8/1K6/8/8/8/8/2Q5 w - - 0 1", wrong: "Qc7", correct: "Qc8#", cpLoss: 999, phase: "endgame" },
  { id: "T2-same-move", fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", wrong: "e4", correct: "e4", cpLoss: 0, phase: "opening" },
  { id: "T5-illegal-wrong", fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", wrong: "Qd5", correct: "e4", cpLoss: 1, phase: "opening" },
];

let geminiCalls = 0;
const gemini = async (prompt: string, timeoutMs: number): Promise<string | null> => {
  if (geminiCalls >= MAX_GEMINI_CALLS) throw new Error(`Gemini call cap (${MAX_GEMINI_CALLS}) reached`);
  geminiCalls++;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 900, temperature: 0.2, responseMimeType: "application/json",
            responseSchema: COACH_RESPONSE_SCHEMA, thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
};

const store = new Map<string, any>();
const engine = getCoachEngine();
const rows: any[] = [];
const cases = [...samples.map((s, i) => ({ id: `S${String(i + 1).padStart(2, "0")}`, ...s })), ...tricky];

for (const c of cases) {
  const t = Date.now();
  const r = await explainBlunderCore(
    { fen: c.fenBefore, wrongMove: c.wrong, correctMove: c.correct, cpLoss: c.cpLoss / 100, phase: c.phase },
    {
      engine, gemini, masters: async () => null,
      cache: { get: (k) => store.get(JSON.stringify(k)) ?? null, put: (k, v) => void store.set(JSON.stringify(k), v) },
    },
  );
  const ms = Date.now() - t;
  // Independent legality check of every step, in the client's reset order.
  let stepsLegal = true;
  const steps = (r.body.steps as any[] | null) ?? [];
  const play = (fen: string, sans: string[]) => {
    const ch = new Chess(fen);
    return sans.every((s) => { try { return !!ch.move(s); } catch { return false; } });
  };
  const moves = steps.filter((s) => s.action?.type === "playMove").map((s) => s.action.san as string);
  if (moves.length) stepsLegal = play(c.fenBefore, moves.slice(0, -1)) && play(c.fenBefore, [moves[moves.length - 1]]);
  rows.push({ id: c.id, status: r.status, source: r.body.source ?? "-", ms, steps: steps.length, stepsLegal });
  console.log(rows[rows.length - 1]);
}

const ok = rows.filter((r) => r.status === 200);
const summary = {
  total: rows.length,
  status200: ok.length,
  non200: rows.filter((r) => r.status !== 200).map((r) => `${r.id}:${r.status}`),
  model: ok.filter((r) => r.source === "model").length,
  template: ok.filter((r) => r.source === "template").length,
  allStepsLegal: rows.every((r) => r.stepsLegal),
  medianMs: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  maxMs: Math.max(...rows.map((r) => r.ms)),
  geminiCalls,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
```

- [ ] **Step 3: Run it (spends real Gemini calls — capped at 80)**

```bash
cd "/Users/kevin/Desktop/Work Spaces/Chess Forge"
set -a; source server/.env; set +a
bun scripts/coach_fixture_eval.ts 2>&1 | tee /private/tmp/claude-501/-Users-kevin-Desktop-Work-Spaces-Chess-Forge/8d7ef58d-e437-45d4-9dbf-6243729a717a/scratchpad/coach_fixture_run.log | tail -40
```
Expected success criteria (from the spec): T1 → 200 and mentions stalemate; T2 → 200 with no Gemini call; T5 → 400; every row `stepsLegal: true`; `maxMs` reported (target ≤ ~9000); `geminiCalls` ≤ ~74. Record `model` vs `template` counts — a high template share means the verifier is too strict or the prompt needs tuning; investigate by printing the `violations` for those rows before changing thresholds.

- [ ] **Step 4: Grade for false claims**

Independently of the pipeline's own verifier, list every output (`analysis` + captions) for the 32 organic samples and check them against Stockfish/chess.js the way `docs/audit-2026-09/coach-eval.md` did (attackers/defenders via chess.js, plain-board facts). Report the count of outputs with a verifiably false statement (audit baseline: 15/32 = 47%). Target: 0 for `source: "model"` outputs that passed the verifier; template outputs are correct by construction. If any false claim survives, add that pattern to `verifyClaims` with a failing test first (Task 3 style), bump `COACH_PROMPT_VERSION`, and rerun.

- [ ] **Step 5: Record results and update docs**

- Append a `## Rerun after fix (2026-09-24)` section to `docs/audit-2026-09/coach-eval.md` with the summary JSON, the before/after false-claim rate, model-vs-template share, latency (median/max), and Gemini calls used.
- In the spec's "6b. Latency budget", replace the estimate with the measured numbers (warm-up ≈ 1.1s; depth 14 ≈ 0.2–0.8s per position; total server budget 9s under the 10s client timeout).
- In `CLAUDE.md`: (a) `services/ai_coach.ts` line → note the live coach path is `server/services/coach*.ts` using Gemini 2.5 Flash with Stockfish-grounded facts; (b) replace "Coach explanations — NOT persisted" with: cached in `coach_cache` keyed by prompt version; clear by bumping `COACH_PROMPT_VERSION` in `server/services/coach_cache.ts`; (c) note Stockfish (`brew install stockfish`) is required on the server or the coach returns 503.

- [ ] **Step 6: Final verification**

Run: `bun test server/tests && npm run typecheck:server && ./dev.sh build; echo "EXIT=$?"`
Expected: tests pass (the fixture script is not part of `bun test`), typecheck clean, `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add server/tests/fixtures/coach_samples.json scripts/coach_fixture_eval.ts docs/audit-2026-09/coach-eval.md docs/superpowers/specs/2026-09-24-coach-engine-facts-design.md CLAUDE.md
git commit -m "test(coach): fixture rerun harness, results, and docs"
```

---

## Rollout (after all tasks; per CLAUDE.md "coach prompt or model" checklist)

1. `./dev.sh build`, then restart the live backend (`./dev.sh restart`) — foreground build first, verify exit 0.
2. `curl` the endpoint with a known-bad FEN (T1 above) on :3001 to confirm the new behavior before debugging from screenshots (a stale PWA can show old output).
3. Confirm `sqlite3 server/chess_trainer.db "SELECT COUNT(*) FROM coach_cache;"` grows as positions are explained.
4. Bump `COACH_PROMPT_VERSION` in future prompt/model/threshold changes.

## Self-Review (run against the spec)

- **Coverage:** validation (T4 `parseInput` + legality) · facts (T2) · single call + server-built steps (T2 `stepsFromFacts`, T4) · short-circuits same-move/equal/stalemate (T2, T4) · verifier + template (T3) · errors/timeouts/cancellation (T4 budget, T5 route + UI guard) · cache + versioning (T1) · engine warm-up + missing-binary 503 (T1, T4, T5) · testing + fixture rerun with spend cap (T6) · rollout/CLAUDE.md (T6). Spec §6 said keep the client timeout at 10s and this plan does (9s server budget).
- **Placeholders:** none left; every code step has full code. The two "if X differs" notes in T2/T3 tell the engineer how to resolve a fixture doubt without weakening assertions.
- **Type consistency:** `EvalEngine` is defined once (T1 `coach_engine.ts`) and imported by T2+; `CoachFacts`/`MoveFacts`/`Score`/`PieceRef`/`CoachCaptions`/`CoachInput` defined in T2 and used identically in T3–T4; `MastersSummary` defined in T4 `coach_prompt.ts` and structurally matches `fetchMastersData`'s return (T5 passes it directly); `CoachCachePayload.steps` is `unknown[] | null` and `stepsFromFacts` returns `CoachStepOut[]` (assignable); `explainBlunderCore` names match between T4 and T5/T6.
- **Known risk to watch during execution:** the T4 time-budget test's stub is deliberately simple but slightly awkward; the assertions are what matter. `chess.js` `attackers()` ignores pins/legality by design (it reports geometric attacks), which the verifier relies on.
