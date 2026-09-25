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
