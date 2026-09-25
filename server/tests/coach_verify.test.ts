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
