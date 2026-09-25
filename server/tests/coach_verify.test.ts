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
    const all = [t.analysis, t.concept, ...Object.values(t.captions)].join(". ");
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
    const all = [t.analysis, t.concept, ...Object.values(t.captions)].join(". ");
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

describe("verifyClaims fails closed", () => {
  const REJECT = [
    "Nf3 attacks your queen.",
    "c3 hangs.",
    "The e6 pawn is undefended.",
    "The pawn on e5 hangs.",
    "The pawn on e5 is now undefended.",
    "The knight on c6 pins the pawn on e5.",
    "Black threatens mate on g7 after Nf3.",
    "Qxf7 is not needed but d4 wins a pawn.",
    "The queen on h5 is trapped.",
    "Black wins your queen with Nf6.",
    "Your queen on h5 can be captured for free.",
    "Nf6 wins the queen.",
    "Black takes the knight.",
    "Nf3 loses both rooks.",
    "Nf3 costs you two pawns.",
    "Nf3 lets Black win your bishops.",
    "Nf3 loses the queens.",
    "Nf3 allows Black to trade queens.",
    "Nf3 costs you the queen.",
    "Nf3 throws away the queen.",
    "Nf3 forfeits the queen.",
    "Nf3 leaves you a queen down.",
    "Nf3 cedes the bishop.",
    "Nf6 nets a pawn.",
    "Black is up a piece after Nf6.",
    "Nf3 costs a pawn.",
    "Nf3 saves the queen.",
    "Nf6 wins the pawn.",
    "Black wins the pawn.",
    "Nf3 wins the pawn.",
    "Nf3 lets Black take the pawn.",
    "Nf6 captures the pawn.",
    "Black takes the pawn on f7.",
    "Nf3 lets Black win a pawn.",
    "Nf6 wins material.",
    "This loses a piece.",
    "You give up the queen.",
    "White loses the exchange.",
    "Nf3 drops the queen.",
    "Nf3 blunders the queen.",
    "Nf3 sacrifices the queen.",
    "The queen falls.",
    "The queen can be taken.",
    "The queen gets taken by Nf6.",
    "Black picks off the knight.",
    "Black snatches the pawn.",
    "Nf6 attacks the rook.",
    "Nf3 attacks the queen.",
    "Nf6 attacks the bishop on c4.",
  ];
  for (const phrase of REJECT) {
    test(`rejects: ${phrase}`, async () => {
      expect(verifyClaims(phrase, await scholarFacts()).ok).toBe(false);
    });
  }

  test("rejects a false guard claim because of the claim itself", async () => {
    const v = verifyClaims("The knight on c6 guards the pawn on d4.", await scholarFacts());
    expect(v.ok).toBe(false);
    expect(v.violations.some((x) => /false claim.*guards/i.test(x))).toBe(true);
  });

  const ACCEPT = [
    "Qxf7# is checkmate: the bishop on c4 attacks the pawn on f7. Nf3 lets Black defend with Nf6.",
    "The bishop on c4 attacks f7.",
    "The bishop on c4 attacks the black pawn on f7.",
    "The knight on c6 defends the pawn on e5.",
    "The queen on h5 is hanging.",
    "Qxf7# wins the pawn.",
    "Nf3 develops the knight.",
    "Nf3 allows Nf6, and Black brings the knight into play.",
    "Qxf7# ends the game.",
    "The bishop on c4 attacks f7.",
    "Qxf7# captures the pawn on f7.",
    "Nf3 allows Nf6.",
    "Nf3 wins tempo for Black.",
    "Nf6 attacks the queen.",
    "Nf3 allows Nf6, which attacks the queen on h5.",
    "Qxf7# attacks the king.",
  ];
  for (const phrase of ACCEPT) {
    test(`accepts: ${phrase}`, async () => {
      expect(verifyClaims(phrase, await scholarFacts())).toEqual({ ok: true, violations: [] });
    });
  }
});

describe("templateFromFacts with a capturing reply", () => {
  test("passes its own verifier", async () => {
    const f = await buildFacts(
      { fen: "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", wrongMove: "Nf3", correctMove: "exd5", cpLoss: null },
      stub([
        { cp: 100, mate: null, bestMoveUci: "e4d5", pvUci: ["e4d5"] },
        { cp: 300, mate: null, bestMoveUci: "d5e4", pvUci: ["d5e4"] },
      ]),
    );
    expect(f.reply?.captured).toBe("p");
    const t = templateFromFacts(f);
    expect(t.analysis).toContain("captures your pawn");
    const all = [t.analysis, t.concept, ...Object.values(t.captions)].join(". ");
    expect(verifyClaims(all, f)).toEqual({ ok: true, violations: [] });
  });
});

describe("default-deny", () => {
  test("over-rejects true but unprovable text by design", async () => {
    // Deliberate: no verifier proof exists for "attacked twice", so a referent + subject clause is denied.
    expect(verifyClaims("Nf3 leaves the f7 pawn attacked twice.", await scholarFacts()).ok).toBe(false);
  });
});

describe("templateFromFacts honesty", () => {
  const OPEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  test("no wrong move: why uses the best-move eval, not lossPawns", async () => {
    const f = await buildFacts(
      { fen: OPEN, wrongMove: null, correctMove: "e4", cpLoss: 250 },
      stub([{ cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] }]),
    );
    const t = templateFromFacts(f);
    expect(t.captions.why).not.toContain("at stake");
    expect(t.captions.why).not.toContain("2.5");
    expect(t.captions.why).toContain("+0.30 for you after e4");
    const all = [t.analysis, t.concept, ...Object.values(t.captions)].join(". ");
    expect(verifyClaims(all, f).ok).toBe(true);
  });

  test("allowed forced mate is stated as such; mover-mated concept is King safety", async () => {
    const f = await buildFacts(
      { fen: OPEN, wrongMove: "f3", correctMove: "e4", cpLoss: null },
      stub([
        { cp: 30, mate: null, bestMoveUci: "e2e4", pvUci: ["e2e4"] },
        { cp: null, mate: 2, bestMoveUci: "e7e5", pvUci: ["e7e5"] },
      ]),
    );
    const t = templateFromFacts(f);
    expect(f.evalAfterWrong?.mate).toBe(-2);
    {
      expect(t.analysis).toContain("allows a forced mate in 2");
      expect(t.analysis).not.toContain("decisive amount");
      expect(t.concept).toBe("King safety");
    }
    const all = [t.analysis, t.concept, ...Object.values(t.captions)].join(". ");
    expect(verifyClaims(all, f).ok).toBe(true);
  });
});
