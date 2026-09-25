import { describe, expect, test } from "bun:test";
import { Chess } from "chess.js";
import {
  AnalysisJob,
  GameDataError,
  analyzeGame,
  dbEvalCache,
  type JobEngine,
} from "../services/analysis_job";
import { ANALYSIS_DEPTH, ANALYSIS_MOVETIME_MS, ANALYSIS_VERSION } from "../services/analysis_config";
import {
  PGN_A,
  PGN_B,
  PGN_C,
  PGN_MATE,
  insertGame,
  makeStubEngine,
  memoryDb,
  scriptFor,
  type Entry,
} from "./support/analysis_stubs";

const newCache = () => dbEvalCache(memoryDb());

// PGN_A = 1. e4 e5 2. Nf3 Nc6 — positions 0..4 (start, then after each ply).
const flatScript = (over: Partial<Record<number, Entry>> = {}): Entry[] => {
  const base: Entry[] = [
    { white: 20, best: "e2e4" },
    { white: 25, best: "e7e5" },
    { white: 30, best: "g1f3" },
    { white: 28, best: "b8c6" },
    { white: 30, best: "f1b5" },
  ];
  return base.map((e, i) => over[i] ?? e);
};

describe("analyzeGame — grading integration", () => {
  test("output keeps the analysis_json move shape with bestMove from the PARENT search", async () => {
    const engine = makeStubEngine({ script: scriptFor(PGN_A, flatScript()) });
    const out = (await analyzeGame(PGN_A, engine, newCache()))!;
    expect(out.map((m) => m.san)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
    expect(out.map((m) => m.bestMove)).toEqual(["e2e4", "e7e5", "g1f3", "b8c6"]);
    for (const m of out) {
      expect(Object.keys(m).sort()).toEqual(["bestMove", "cpLoss", "eval", "fen", "grade", "san"]);
    }
    // fen is the position AFTER the move, exactly as chess.js prints it.
    const c = new Chess();
    for (const m of out) {
      c.move(m.san);
      expect(m.fen).toBe(c.fen());
    }
  });

  test("eval is WHITE point of view whichever side is to move", async () => {
    const engine = makeStubEngine({ script: scriptFor(PGN_A, flatScript()) });
    const out = (await analyzeGame(PGN_A, engine, newCache()))!;
    // The stub reports side-to-move POV (negated when Black is to move); analyzeGame must undo that.
    expect(out.map((m) => m.eval)).toEqual([25, 30, 28, 30]);
  });

  test("playing the engine's top move is graded best", async () => {
    const engine = makeStubEngine({ script: scriptFor(PGN_A, flatScript()) });
    const out = (await analyzeGame(PGN_A, engine, newCache()))!;
    expect(out[0].grade).toBe("best"); // e4 == e2e4
    expect(out[2].grade).toBe("best"); // Nf3 == g1f3
  });

  test("a big loss is a blunder and the played move is NOT the top move", async () => {
    // After 2.Nf3 White collapses from +30 to -400 while the engine wanted 2.d4.
    const script = scriptFor(PGN_A, flatScript({ 2: { white: 30, best: "d2d4" }, 3: { white: -400, best: "b8c6" } }));
    const out = (await analyzeGame(PGN_A, makeStubEngine({ script }), newCache()))!;
    expect(out[2].grade).toBe("blunder");
    expect(out[2].cpLoss).toBe(430);
    expect(out[2].bestMove).toBe("d2d4");
  });

  test("a near-equal non-top move is excellent, not best", async () => {
    // Engine wanted 2.d4 (+30); 2.Nf3 leaves +15: about 1.4 win% lost.
    const script = scriptFor(PGN_A, flatScript({ 2: { white: 30, best: "d2d4" }, 3: { white: 15, best: "b8c6" } }));
    const out = (await analyzeGame(PGN_A, makeStubEngine({ script }), newCache()))!;
    expect(out[2].grade).toBe("excellent");
    expect(out[2].cpLoss).toBe(15);
  });

  test("grading follows the mover: a Black move that hands White +3 is a blunder", async () => {
    // Move index 1 is Black's e5, played from +25 (White POV) into +330.
    const script = scriptFor(PGN_A, flatScript({ 1: { white: 25, best: "c7c5" }, 2: { white: 330, best: "g1f3" } }));
    const out = (await analyzeGame(PGN_A, makeStubEngine({ script }), newCache()))!;
    expect(out[1].grade).toBe("blunder");
    expect(out[1].cpLoss).toBe(305);
  });

  test("the parent's top move with a small measured drop stays best", async () => {
    // e5 == e7e5 (the engine's top move) and the child search sees White at +45 (a ~1.8 pp drop for Black).
    const script = scriptFor(PGN_A, flatScript({ 1: { white: 25, best: "e7e5" }, 2: { white: 45, best: "g1f3" } }));
    const out = (await analyzeGame(PGN_A, makeStubEngine({ script }), newCache()))!;
    expect(out[1].cpLoss).toBe(20);
    expect(out[1].grade).toBe("best");
  });

  test("the parent's top move that the child search measures as a big drop is graded by the loss bands", async () => {
    // e5 == e7e5 is the parent's top move, but the child search says White is +330: the two searches
    // disagree, and the measured 305 cp drop (~26 pp) is the better signal -> blunder, not best.
    const script = scriptFor(PGN_A, flatScript({ 1: { white: 25, best: "e7e5" }, 2: { white: 330, best: "g1f3" } }));
    const out = (await analyzeGame(PGN_A, makeStubEngine({ script }), newCache()))!;
    expect(out[1].bestMove).toBe("e7e5");
    expect(out[1].cpLoss).toBe(305);
    expect(out[1].grade).toBe("blunder");
    // Somewhere in between (~6 pp) it is an inaccuracy.
    const mid = scriptFor(PGN_A, flatScript({ 1: { white: 25, best: "e7e5" }, 2: { white: 90, best: "g1f3" } }));
    const outMid = (await analyzeGame(PGN_A, makeStubEngine({ script: mid }), newCache()))!;
    expect(outMid[1].grade).toBe("inaccuracy");
  });

  test("the first move is graded against the EVALUATED start position, not a fixed +20", async () => {
    // Start says +300 for White; after 1.e4 the engine says +20 -> a real 280 cp loss.
    // Against the old magic +20 this would have looked like a perfect move.
    const script = scriptFor(PGN_A, flatScript({ 0: { white: 300, best: "d2d4" }, 1: { white: 20, best: "e7e5" } }));
    const out = (await analyzeGame(PGN_A, makeStubEngine({ script }), newCache()))!;
    expect(out[0].cpLoss).toBe(280);
    expect(out[0].grade).toBe("blunder");
    expect(out[0].bestMove).toBe("d2d4"); // the first move now HAS a bestMove
  });

  test("mate scores clamp to +-2000 in White's point of view", async () => {
    // After 1...e5 (White to move) engine sees White mating; after 2.Nf3 (Black to move) Black mates.
    const script = scriptFor(PGN_A, [
      { white: 20, best: "e2e4" },
      { white: 25, best: "e7e5" },
      { mate: 3, best: "d1h5" },
      { mate: 2, best: "b8c6" },
      { white: 30, best: "f1b5" },
    ]);
    const out = (await analyzeGame(PGN_A, makeStubEngine({ script }), newCache()))!;
    expect(out[1].eval).toBe(2000); // White to move, mate > 0 -> White mates
    expect(out[2].eval).toBe(-2000); // Black to move, mate > 0 -> Black mates
    expect(out[2].grade).toBe("blunder"); // Nf3 walked into it
  });

  test("uses the configured depth and the per-position time cap", async () => {
    const engine = makeStubEngine({ script: scriptFor(PGN_A, flatScript()) });
    await analyzeGame(PGN_A, engine, newCache());
    expect(new Set(engine.requests.map((r) => r.depth))).toEqual(new Set([ANALYSIS_DEPTH]));
    expect(new Set(engine.requests.map((r) => r.movetimeMs))).toEqual(new Set([ANALYSIS_MOVETIME_MS]));
    const e2 = makeStubEngine({ script: scriptFor(PGN_A, flatScript()) });
    await analyzeGame(PGN_A, e2, newCache(), { depth: 9, movetimeMs: 50 });
    expect(e2.requests[0]).toEqual({ depth: 9, movetimeMs: 50 });
  });

  test("evaluates the start position plus one position per ply, no more", async () => {
    const engine = makeStubEngine({ script: scriptFor(PGN_A, flatScript()) });
    await analyzeGame(PGN_A, engine, newCache());
    expect(engine.calls.length).toBe(5);
  });
});

describe("analyzeGame — position cache", () => {
  test("a second pass over the same game never touches the engine and gives the same result", async () => {
    const cache = newCache();
    const first = makeStubEngine({ script: scriptFor(PGN_A, flatScript()) });
    const a = await analyzeGame(PGN_A, first, cache);
    const second = makeStubEngine({ script: scriptFor(PGN_A, flatScript()) });
    const b = await analyzeGame(PGN_A, second, cache);
    expect(first.calls.length).toBe(5);
    expect(second.calls.length).toBe(0);
    expect(b).toEqual(a);
  });

  test("a game sharing an opening only pays for the positions it does not share", async () => {
    // PGN_A and PGN_C share the start position and 1.e4 -> 2 of 5 positions cached.
    const cache = newCache();
    await analyzeGame(PGN_A, makeStubEngine({}), cache);
    const engine = makeStubEngine({});
    await analyzeGame(PGN_C, engine, cache);
    expect(engine.calls.length).toBe(3);
  });

  test("a deeper cached eval satisfies a shallower request", async () => {
    const cache = newCache();
    await analyzeGame(PGN_A, makeStubEngine({}), cache, { depth: 16 });
    const engine = makeStubEngine({});
    await analyzeGame(PGN_A, engine, cache, { depth: 12 });
    expect(engine.calls.length).toBe(0);
  });

  test("a cached eval keeps its bestMove (used for playedIsBest)", async () => {
    const cache = newCache();
    await analyzeGame(PGN_A, makeStubEngine({ script: scriptFor(PGN_A, flatScript()) }), cache);
    const out = (await analyzeGame(PGN_A, makeStubEngine({}), cache))!;
    expect(out[0].grade).toBe("best");
    expect(out.map((m) => m.bestMove)).toEqual(["e2e4", "e7e5", "g1f3", "b8c6"]);
  });
});

describe("analyzeGame — terminal moves, promotion, FEN headers", () => {
  test("a checkmating move gets no engine call, a fixed eval and best", async () => {
    // 1. f3 e5 2. g4 Qh4#: positions 0..3 are searched, the mated position is not.
    const engine = makeStubEngine({});
    const out = (await analyzeGame(PGN_MATE, engine, newCache()))!;
    expect(engine.calls.length).toBe(4);
    const last = out[3];
    expect(last.san).toBe("Qh4#");
    expect(last.eval).toBe(-2000); // Black mated White
    expect(last.cpLoss).toBe(0);
    expect(last.grade).toBe("best");
    expect(last.bestMove).toBe("a2a3"); // parent search's best move (stub default)
  });

  test("White delivering mate is +2000", async () => {
    const pgn = "1. e4 f6 2. d4 g5 3. Qh5#";
    const engine = makeStubEngine({});
    const out = (await analyzeGame(pgn, engine, newCache()))!;
    expect(out[out.length - 1].eval).toBe(2000);
    expect(engine.calls.length).toBe(5); // start + 4 non-terminal positions
  });

  test("a stalemating move is eval 0, best, with no engine call for the final position", async () => {
    const pgn = '[SetUp "1"]\n[FEN "7k/8/6K1/8/8/8/5Q2/8 w - - 0 1"]\n\n1. Qf7';
    const engine = makeStubEngine({});
    const out = (await analyzeGame(pgn, engine, newCache()))!;
    expect(engine.calls.length).toBe(1); // only the start position
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ san: "Qf7", eval: 0, cpLoss: 0, grade: "best" });
  });

  test("a promotion is compared as from+to+piece against the engine's UCI", async () => {
    const pgn = '[SetUp "1"]\n[FEN "8/P7/8/8/8/8/k7/4K3 w - - 0 1"]\n\n1. a8=Q+ Kb2';
    const script = scriptFor(pgn, [
      { white: 900, best: "a7a8q" },
      { white: 890, best: "a2b2" },
      { white: 890, best: "a8b8" },
    ]);
    const out = (await analyzeGame(pgn, makeStubEngine({ script }), newCache()))!;
    expect(out[0].san).toBe("a8=Q+");
    expect(out[0].grade).toBe("best");
    // Under-promotion would NOT be the engine's move.
    const under = '[SetUp "1"]\n[FEN "8/P7/8/8/8/8/k7/4K3 w - - 0 1"]\n\n1. a8=R+ Kb2';
    const script2 = scriptFor(under, [
      { white: 900, best: "a7a8q" },
      { white: 300, best: "a2b2" },
      { white: 300, best: "a8b8" },
    ]);
    const out2 = (await analyzeGame(under, makeStubEngine({ script: script2 }), newCache()))!;
    expect(out2[0].grade).toBe("blunder");
  });

  test("castling matches the engine's king-move UCI", async () => {
    const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O";
    const out0 = await analyzeGame(pgn, makeStubEngine({}), newCache());
    expect(out0!.length).toBe(7);
    const script = scriptFor(pgn, [
      { white: 20, best: "e2e4" },
      { white: 25, best: "e7e5" },
      { white: 30, best: "g1f3" },
      { white: 28, best: "b8c6" },
      { white: 30, best: "f1c4" },
      { white: 25, best: "g8f6" },
      { white: 30, best: "e1g1" },
      { white: 30, best: "f6e4" },
    ]);
    const out = (await analyzeGame(pgn, makeStubEngine({ script }), newCache()))!;
    expect(out[6].san).toBe("O-O");
    expect(out[6].grade).toBe("best");
  });

  test("a game with no moves analyses to an empty list without touching the engine", async () => {
    const engine = makeStubEngine({});
    expect(await analyzeGame('[Event "x"]\n[Result "*"]\n\n*', engine, newCache())).toEqual([]);
    expect(engine.calls.length).toBe(0);
  });

  test("an unparseable PGN throws GameDataError before any engine call", async () => {
    const engine = makeStubEngine({});
    await expect(analyzeGame("1. e4 e5 2. Qxx9", engine, newCache())).rejects.toBeInstanceOf(GameDataError);
    expect(engine.calls.length).toBe(0);
  });
});

describe("analyzeGame — stop and failure", () => {
  test("stopping mid-game returns null and stops calling the engine", async () => {
    let stop = false;
    const engine = makeStubEngine({
      onCall: (n) => {
        if (n === 2) stop = true;
      },
    });
    const out = await analyzeGame(PGN_A, engine, newCache(), { shouldStop: () => stop });
    expect(out).toBeNull();
    expect(engine.calls.length).toBe(2);
  });

  test("an engine error propagates (the queue decides what to do)", async () => {
    const engine = makeStubEngine({ failOnCalls: [3] });
    await expect(analyzeGame(PGN_A, engine, newCache())).rejects.toThrow(/engine process closed/);
  });

  test("progress is reported per ply", async () => {
    const seen: [number, number][] = [];
    await analyzeGame(PGN_A, makeStubEngine({}), newCache(), {
      onProgress: (ply, plies) => seen.push([ply, plies]),
    });
    expect(seen).toEqual([
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The queue runner
// ---------------------------------------------------------------------------

interface Rig {
  db: ReturnType<typeof memoryDb>;
  job: AnalysisJob;
  engines: ReturnType<typeof makeStubEngine>[];
  counter: { n: number };
  clock: { t: number };
}

function rig(
  opts: {
    onCall?: (n: number, r: Rig) => void | Promise<void>;
    failOnCalls?: number[];
    hasEngine?: boolean;
    msPerCall?: number;
  } = {},
): Rig {
  const db = memoryDb();
  const engines: Rig["engines"] = [];
  const counter = { n: 0 };
  const clock = { t: 1_000_000 };
  const r = { db, engines, counter, clock } as Rig;
  r.job = new AnalysisJob({
    db,
    hasEngine: () => opts.hasEngine ?? true,
    now: () => clock.t,
    createEngine: (): JobEngine => {
      const e = makeStubEngine({
        counter,
        failOnCalls: opts.failOnCalls,
        onCall: async (n) => {
          clock.t += opts.msPerCall ?? 0;
          await opts.onCall?.(n, r);
        },
      });
      engines.push(e);
      return e;
    },
    log: () => {},
  });
  return r;
}

const gameRow = (db: Rig["db"], id: number) =>
  db.query("SELECT * FROM games WHERE id = ?").get(id) as Record<string, unknown>;

describe("AnalysisJob — selection", () => {
  test("never-analyzed first, then legacy/older versions, each newest first; failed and current are skipped", () => {
    const { db, job } = rig();
    const legacyOld = insertGame(db, { pgn: PGN_A, date: "2026-03-01", analysisJson: "[]", analysisVersion: null });
    const legacyNew = insertGame(db, { pgn: PGN_A, date: "2026-08-01", analysisJson: "[]", analysisVersion: 1 });
    const freshOld = insertGame(db, { pgn: PGN_A, date: "2026-01-01" });
    const freshNew = insertGame(db, { pgn: PGN_A, date: "2026-06-01" });
    insertGame(db, { pgn: PGN_A, date: "2026-09-01", analysisJson: "[]", analysisVersion: ANALYSIS_VERSION }); // done
    insertGame(db, { pgn: PGN_A, date: "2026-09-02", analysisFailed: "boom" }); // failed
    // Version >= 2 but json cleared (clear-analysis / refresh-analysis) counts as never-analyzed.
    const cleared = insertGame(db, { pgn: PGN_A, date: "2026-05-01", analysisVersion: ANALYSIS_VERSION });
    expect(job.queue()).toEqual([freshNew, cleared, freshOld, legacyNew, legacyOld]);
  });
});

describe("AnalysisJob — running", () => {
  test("analyses everything, saving with version + depth, then disposes the engine", async () => {
    const { db, job, engines } = rig();
    const a = insertGame(db, { pgn: PGN_A, date: "2026-02-01" });
    const b = insertGame(db, { pgn: PGN_B, date: "2026-01-01" });
    expect(job.start()).toEqual({ started: true });
    await job.idle();
    for (const id of [a, b]) {
      const r = gameRow(db, id);
      expect(r.analysis_version).toBe(ANALYSIS_VERSION);
      expect(r.analysis_depth).toBe(ANALYSIS_DEPTH);
      expect(r.analysis_failed).toBeNull();
      expect(JSON.parse(r.analysis_json as string)).toHaveLength(4);
    }
    expect(engines).toHaveLength(1);
    expect(engines[0].disposed).toBe(true);
    expect(job.status().running).toBe(false);
  });

  test("newest games are analysed first", async () => {
    const order: number[] = [];
    const { db, job } = rig({
      onCall: (_n, r) => {
        const cur = r.job.status().current?.gameId;
        if (cur !== undefined && order[order.length - 1] !== cur) order.push(cur);
      },
    });
    const old = insertGame(db, { pgn: PGN_B, date: "2026-01-01" });
    const recent = insertGame(db, { pgn: PGN_A, date: "2026-09-01" });
    job.start();
    await job.idle();
    expect(order).toEqual([recent, old]);
  });

  test("the engine is created lazily and never for an empty queue", () => {
    const { job, engines } = rig();
    expect(job.start()).toEqual({ started: false, reason: "nothing-pending" });
    expect(engines).toHaveLength(0);
    expect(job.status().running).toBe(false);
  });

  test("the engine is not held while idle: created on start, disposed when the queue drains", async () => {
    const { db, job, engines } = rig();
    insertGame(db, { pgn: PGN_A });
    expect(engines).toHaveLength(0);
    job.start();
    await job.idle();
    expect(engines.every((e) => e.disposed)).toBe(true);
  });

  test("only one run at a time: a second start() is refused", async () => {
    const { db, job, engines } = rig();
    insertGame(db, { pgn: PGN_A });
    expect(job.start().started).toBe(true);
    expect(job.start()).toEqual({ started: false, reason: "already-running" });
    await job.idle();
    expect(engines).toHaveLength(1);
  });

  test("no Stockfish: start() reports no-engine and nothing is touched", () => {
    const { db, job } = rig({ hasEngine: false });
    insertGame(db, { pgn: PGN_A });
    expect(job.start()).toEqual({ started: false, reason: "no-engine" });
    expect(job.status().running).toBe(false);
  });

  test("maxGames bounds a run", async () => {
    const { db, job } = rig();
    insertGame(db, { pgn: PGN_A, date: "2026-03-01" });
    insertGame(db, { pgn: PGN_B, date: "2026-02-01" });
    insertGame(db, { pgn: PGN_C, date: "2026-01-01" });
    job.start({ maxGames: 2 });
    await job.idle();
    expect(job.status().counts).toMatchObject({ done: 2, pending: 1 });
  });

  test("a restarted server is resumable: rerunning only picks up what is left", async () => {
    const { db, job } = rig();
    insertGame(db, { pgn: PGN_A, date: "2026-03-01" });
    insertGame(db, { pgn: PGN_B, date: "2026-02-01" });
    job.start({ maxGames: 1 });
    await job.idle();
    expect(job.status().counts.pending).toBe(1);
    job.start();
    await job.idle();
    expect(job.status().counts).toMatchObject({ pending: 0, done: 2 });
  });
});

describe("AnalysisJob — stop", () => {
  test("stopping mid-game saves nothing for that game and releases the engine", async () => {
    const { db, job, engines } = rig({
      onCall: (n, r) => {
        if (n === 3) r.job.stop();
      },
    });
    const id = insertGame(db, { pgn: PGN_A });
    job.start();
    await job.idle();
    const r = gameRow(db, id);
    expect(r.analysis_json).toBeNull();
    expect(r.analysis_version).toBeNull();
    expect(r.analysis_failed).toBeNull();
    expect(engines[0].disposed).toBe(true);
    expect(job.status()).toMatchObject({ running: false, current: null, startedAt: null });
    expect(job.status().counts.pending).toBe(1);
  });

  test("resuming after a stop finishes the game, and positions already searched come from the cache", async () => {
    const { db, job, engines } = rig({
      onCall: (n, r) => {
        if (n === 3) r.job.stop();
      },
    });
    const id = insertGame(db, { pgn: PGN_A });
    job.start();
    await job.idle();
    job.start();
    await job.idle();
    expect(gameRow(db, id).analysis_version).toBe(ANALYSIS_VERSION);
    expect(engines).toHaveLength(2);
    expect(engines[1].calls.length).toBeLessThan(5); // start + first positions were cached
  });

  test("start() while a stop is still unwinding cancels the stop", async () => {
    const { db, job } = rig({
      onCall: (n, r) => {
        if (n === 2) {
          r.job.stop();
          r.job.start(); // user flips it straight back on
        }
      },
    });
    const id = insertGame(db, { pgn: PGN_A });
    job.start();
    await job.idle();
    expect(gameRow(db, id).analysis_version).toBe(ANALYSIS_VERSION);
  });

  test("stop() when idle is a harmless no-op", () => {
    const { job } = rig();
    expect(() => job.stop()).not.toThrow();
    expect(job.status().running).toBe(false);
  });
});

describe("AnalysisJob — failures", () => {
  test("a game that cannot be analysed is marked failed with a reason and the queue continues", async () => {
    const { db, job } = rig();
    const bad = insertGame(db, { pgn: "1. e4 e5 2. Qxx9", date: "2026-09-01" });
    const good = insertGame(db, { pgn: PGN_A, date: "2026-08-01" });
    job.start();
    await job.idle();
    const b = gameRow(db, bad);
    expect(String(b.analysis_failed)).toMatch(/invalid PGN/i);
    expect(String(b.analysis_failed).length).toBeLessThanOrEqual(200);
    expect(b.analysis_json).toBeNull();
    expect(gameRow(db, good).analysis_version).toBe(ANALYSIS_VERSION);
    expect(job.status().counts).toMatchObject({ failed: 1, done: 1, pending: 0 });
  });

  test("a failed game is never selected again until retried", async () => {
    const { db, job } = rig();
    const bad = insertGame(db, { pgn: "1. e4 e5 2. Qxx9" });
    job.start();
    await job.idle();
    expect(job.queue()).toEqual([]);
    expect(job.start()).toEqual({ started: false, reason: "nothing-pending" });
    expect(job.retryFailed()).toBe(1);
    expect(gameRow(db, bad).analysis_failed).toBeNull();
    expect(job.queue()).toEqual([bad]);
    expect(job.retryFailed()).toBe(0);
  });

  test("an engine crash restarts the engine once and retries the game", async () => {
    const { db, job, engines } = rig({ failOnCalls: [3] });
    const id = insertGame(db, { pgn: PGN_A });
    job.start();
    await job.idle();
    expect(gameRow(db, id).analysis_version).toBe(ANALYSIS_VERSION);
    expect(gameRow(db, id).analysis_failed).toBeNull();
    expect(engines).toHaveLength(2);
    expect(engines[0].disposed).toBe(true);
    expect(engines[1].disposed).toBe(true);
  });

  test("a second crash on the same game marks it failed, and the queue moves on", async () => {
    // Calls 3 and (after the restart, with positions 0-1 cached) the next call both die.
    const { db, job, engines } = rig({ failOnCalls: [3, 4] });
    const first = insertGame(db, { pgn: PGN_A, date: "2026-09-01" });
    const second = insertGame(db, { pgn: PGN_B, date: "2026-08-01" });
    job.start();
    await job.idle();
    expect(String(gameRow(db, first).analysis_failed)).toMatch(/engine error/i);
    expect(gameRow(db, second).analysis_version).toBe(ANALYSIS_VERSION);
    expect(engines.length).toBeGreaterThanOrEqual(3);
    expect(engines.every((e) => e.disposed)).toBe(true);
  });

  test("three engine-failed games in a row abort the run instead of failing the whole library", async () => {
    // Every engine call dies.
    const calls = Array.from({ length: 200 }, (_, i) => i + 1);
    const { db, job } = rig({ failOnCalls: calls });
    for (let i = 0; i < 6; i++) insertGame(db, { pgn: PGN_A, date: `2026-0${i + 1}-01` });
    job.start();
    await job.idle();
    expect(job.status().counts.failed).toBe(3);
    expect(job.status().counts.pending).toBe(3);
    expect(job.status().running).toBe(false);
  });

  test("a failure creating the engine aborts the run without blaming the game", async () => {
    const db = memoryDb();
    const id = insertGame(db, { pgn: PGN_A });
    const job = new AnalysisJob({
      db,
      hasEngine: () => true,
      createEngine: () => {
        throw new Error("spawn failed");
      },
      log: () => {},
    });
    job.start();
    await job.idle();
    expect(gameRow(db, id).analysis_failed).toBeNull();
    expect(job.status()).toMatchObject({ running: false, counts: { pending: 1, failed: 0 } });
  });
});

describe("AnalysisJob — status", () => {
  test("the payload is exactly the documented shape", () => {
    const { db, job } = rig();
    insertGame(db, { pgn: PGN_A });
    const s = job.status();
    expect(Object.keys(s).sort()).toEqual(
      ["counts", "current", "depth", "etaSeconds", "running", "startedAt", "version"].sort(),
    );
    expect(Object.keys(s.counts).sort()).toEqual(["done", "failed", "pending", "total"]);
    expect(s).toEqual({
      running: false,
      current: null,
      counts: { pending: 1, done: 0, failed: 0, total: 1 },
      startedAt: null,
      etaSeconds: null,
      depth: ANALYSIS_DEPTH,
      version: ANALYSIS_VERSION,
    });
  });

  test("counts partition the library: done + pending + failed = total", () => {
    const { db, job } = rig();
    insertGame(db, { pgn: PGN_A });
    insertGame(db, { pgn: PGN_A, analysisJson: "[]", analysisVersion: 1 });
    insertGame(db, { pgn: PGN_A, analysisJson: "[]", analysisVersion: ANALYSIS_VERSION });
    insertGame(db, { pgn: PGN_A, analysisJson: "[]", analysisVersion: ANALYSIS_VERSION });
    insertGame(db, { pgn: PGN_A, analysisFailed: "x" });
    insertGame(db, { pgn: PGN_A, analysisVersion: ANALYSIS_VERSION }); // json cleared -> pending
    const c = job.status().counts;
    expect(c).toEqual({ pending: 3, done: 2, failed: 1, total: 6 });
    expect(c.done + c.pending + c.failed).toBe(c.total);
  });

  test("while running: current game, ply progress, an ISO startedAt", async () => {
    let snapshot = null as ReturnType<AnalysisJob["status"]> | null;
    const { db, job } = rig({
      onCall: (n, r) => {
        if (n === 4) snapshot = r.job.status();
      },
    });
    const id = insertGame(db, { pgn: PGN_A, white: "kevin", black: "magnus" });
    job.start();
    await job.idle();
    expect(snapshot).not.toBeNull();
    const s = snapshot!;
    expect(s.running).toBe(true);
    expect(s.current).toEqual({ gameId: id, white: "kevin", black: "magnus", ply: 2, plies: 4 });
    expect(new Date(s.startedAt!).toISOString()).toBe(s.startedAt!);
  });

  test("ETA is null until a game finishes, then positive, and null again when idle", async () => {
    const etas: (number | null)[] = [];
    const { db, job } = rig({
      msPerCall: 2000,
      onCall: (_n, r) => {
        etas.push(r.job.status().etaSeconds);
      },
    });
    insertGame(db, { pgn: PGN_A, date: "2026-03-01" });
    insertGame(db, { pgn: PGN_B, date: "2026-02-01" });
    insertGame(db, { pgn: PGN_C, date: "2026-01-01" });
    job.start();
    await job.idle();
    expect(etas[0]).toBeNull(); // nothing finished yet -> no basis for an estimate
    const later = etas.filter((e): e is number => e !== null);
    expect(later.length).toBeGreaterThan(0);
    for (const e of later) expect(e).toBeGreaterThan(0);
    expect(job.status().etaSeconds).toBeNull();
  });

  test("ETA arithmetic: 10 s per finished game x 2 games still pending = 20 s", async () => {
    let eta = null as number | null;
    const { db, job } = rig({
      msPerCall: 2000,
      onCall: (n, r) => {
        // Game 1 makes calls 1-5 (start + 4 plies, 2 s each = 10 s). Call 6 is game 2's
        // first uncached position; by then game 1 is saved.
        if (n === 6) eta = r.job.status().etaSeconds;
      },
    });
    insertGame(db, { pgn: "1. e4 e5 2. Nf3 Nc6", date: "2026-03-01" });
    insertGame(db, { pgn: "1. d4 d5 2. c4 e6", date: "2026-02-01" });
    insertGame(db, { pgn: "1. c4 e5 2. Nc3 Nf6", date: "2026-01-01" });
    job.start();
    await job.idle();
    // Pending at that moment: game 2 (in flight) + game 3.
    expect(eta).toBe(20);
  });
});
