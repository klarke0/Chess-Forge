import { describe, expect, test } from "bun:test";
import {
  GRADE_BANDS,
  MATE_CP,
  computeCpLoss,
  gradeMove,
  winPercent,
  winPercentFromScore,
} from "../utils/grading";

const K = 0.00368208;
/** Inverse of winPercent: the cp whose win% is `w` (0 < w < 100). */
const cpForWin = (w: number) => Math.log(w / (100 - w)) / K;

describe("winPercent", () => {
  test("0 cp is exactly 50%", () => {
    expect(winPercent(0)).toBeCloseTo(50, 10);
  });

  test("matches the lichess curve at known points", () => {
    // 100 cp ~ 59.1%, 300 cp ~ 75.1%, 1000 cp ~ 97.5% (lichess win-chance table)
    expect(winPercent(100)).toBeCloseTo(59.1, 1);
    expect(winPercent(300)).toBeCloseTo(75.1, 1);
    expect(winPercent(1000)).toBeCloseTo(97.5, 1);
  });

  test("is symmetric: winPercent(-x) === 100 - winPercent(x)", () => {
    for (const cp of [1, 25, 137, 800, 2000]) {
      expect(winPercent(-cp)).toBeCloseTo(100 - winPercent(cp), 9);
    }
  });

  test("is strictly increasing within the clamp", () => {
    let prev = -1;
    for (let cp = -3000; cp <= 3000; cp += 50) {
      const w = winPercent(cp);
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });

  test("clamps cp to +-10000 (no NaN/overflow on absurd input)", () => {
    expect(winPercent(1e9)).toBe(winPercent(10000));
    expect(winPercent(-1e9)).toBe(winPercent(-10000));
    expect(Number.isFinite(winPercent(Number.MAX_SAFE_INTEGER))).toBe(true);
  });
});

describe("winPercentFromScore (side-to-move POV)", () => {
  test("cp scores go through the curve", () => {
    expect(winPercentFromScore({ cp: 100, mate: null })).toBeCloseTo(winPercent(100), 12);
    expect(winPercentFromScore({ cp: -250, mate: null })).toBeCloseTo(winPercent(-250), 12);
  });

  test("the side to move mating is 100, being mated is 0", () => {
    expect(winPercentFromScore({ cp: null, mate: 3 })).toBe(100);
    expect(winPercentFromScore({ cp: null, mate: 1 })).toBe(100);
    expect(winPercentFromScore({ cp: null, mate: -2 })).toBe(0);
  });

  test("`mate 0` means the side to move is already mated", () => {
    expect(winPercentFromScore({ cp: null, mate: 0 })).toBe(0);
  });

  test("mate takes precedence over a stray cp", () => {
    expect(winPercentFromScore({ cp: 50, mate: 2 })).toBe(100);
  });

  test("a missing cp (and no mate) is treated as 0 cp", () => {
    expect(winPercentFromScore({ cp: null, mate: null })).toBeCloseTo(50, 10);
  });
});

describe("computeCpLoss", () => {
  test("white mover loses when White's eval drops", () => {
    expect(computeCpLoss(50, -100, "w")).toBe(150);
  });

  test("black mover loses when White's eval rises", () => {
    expect(computeCpLoss(-50, 120, "b")).toBe(170);
  });

  test("an improving move is a 0 loss for either mover", () => {
    expect(computeCpLoss(0, 200, "w")).toBe(0);
    expect(computeCpLoss(0, -200, "b")).toBe(0);
  });

  test("mate clamps: throwing away a mate is a 4000 cp loss", () => {
    expect(computeCpLoss(MATE_CP, -MATE_CP, "w")).toBe(2 * MATE_CP);
    expect(computeCpLoss(-MATE_CP, MATE_CP, "b")).toBe(2 * MATE_CP);
  });
});

describe("GRADE_BANDS", () => {
  test("are the spec's values, strictly increasing", () => {
    expect(GRADE_BANDS).toEqual({
      best: 0.2,
      excellent: 2,
      good: 5,
      inaccuracy: 10,
      mistake: 20,
    });
    const v = Object.values(GRADE_BANDS);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
  });
});

describe("gradeMove", () => {
  // Build a White-mover move from an equal position losing exactly `loss` pp.
  const whiteLoses = (loss: number, playedIsBest = false) =>
    gradeMove({
      prevEvalWhite: 0,
      newEvalWhite: cpForWin(50 - loss),
      mover: "w",
      playedIsBest,
    });

  test("a loss of exactly 0 is best", () => {
    expect(gradeMove({ prevEvalWhite: 30, newEvalWhite: 30, mover: "w", playedIsBest: false })).toEqual({
      grade: "best",
      winLoss: 0,
    });
  });

  test("an improving move is best with winLoss clamped at 0 (never negative)", () => {
    const r = gradeMove({ prevEvalWhite: 0, newEvalWhite: 300, mover: "w", playedIsBest: false });
    expect(r.grade).toBe("best");
    expect(r.winLoss).toBe(0);
  });

  test("winLoss is the mover's win% before minus after", () => {
    const r = gradeMove({ prevEvalWhite: 100, newEvalWhite: -100, mover: "w", playedIsBest: false });
    expect(r.winLoss).toBeCloseTo(winPercent(100) - winPercent(-100), 10);
  });

  test("each band edge: just inside stays, just outside moves down a grade", () => {
    const e = 1e-6;
    expect(whiteLoses(GRADE_BANDS.best - e).grade).toBe("best");
    expect(whiteLoses(GRADE_BANDS.best + e).grade).toBe("excellent");
    expect(whiteLoses(GRADE_BANDS.excellent - e).grade).toBe("excellent");
    expect(whiteLoses(GRADE_BANDS.excellent + e).grade).toBe("good");
    expect(whiteLoses(GRADE_BANDS.good - e).grade).toBe("good");
    expect(whiteLoses(GRADE_BANDS.good + e).grade).toBe("inaccuracy");
    expect(whiteLoses(GRADE_BANDS.inaccuracy - e).grade).toBe("inaccuracy");
    expect(whiteLoses(GRADE_BANDS.inaccuracy + e).grade).toBe("mistake");
    expect(whiteLoses(GRADE_BANDS.mistake - e).grade).toBe("mistake");
    expect(whiteLoses(GRADE_BANDS.mistake + e).grade).toBe("blunder");
  });

  test("the mover's perspective is respected: same swing, mirrored evals, same grade", () => {
    for (const loss of [0.1, 1, 3, 8, 15, 30]) {
      const w = gradeMove({
        prevEvalWhite: 80,
        newEvalWhite: cpForWin(winPercent(80) - loss),
        mover: "w",
        playedIsBest: false,
      });
      const b = gradeMove({
        prevEvalWhite: -80,
        newEvalWhite: -cpForWin(winPercent(80) - loss),
        mover: "b",
        playedIsBest: false,
      });
      expect(b.grade).toBe(w.grade);
      expect(b.winLoss).toBeCloseTo(w.winLoss, 9);
    }
  });

  test("a black move that raises White's eval is graded against Black", () => {
    // Black at -100 (good for Black) plays a move after which White is +200.
    const r = gradeMove({ prevEvalWhite: -100, newEvalWhite: 200, mover: "b", playedIsBest: false });
    expect(r.grade).toBe("blunder");
  });

  test("the same cp swing costs more win% near equality than when already winning", () => {
    const equal = gradeMove({ prevEvalWhite: 0, newEvalWhite: -100, mover: "w", playedIsBest: false });
    const crushing = gradeMove({ prevEvalWhite: 900, newEvalWhite: 800, mover: "w", playedIsBest: false });
    expect(equal.winLoss).toBeGreaterThan(crushing.winLoss);
    expect(equal.grade).toBe("inaccuracy"); // 50% -> 40.9%, 9.1 pp
    expect(crushing.grade).toBe("excellent");
  });

  test("the engine's top move is best while the measured loss stays within the good ceiling (5 pp)", () => {
    // Not the near-zero band: a 1 pp and a 3 pp drop are still 'best' when it IS the top move...
    for (const loss of [0.1, 1, 3, 4.9]) {
      const r = whiteLoses(loss, true);
      expect(r.grade).toBe("best");
      // ...and winLoss keeps reporting what was measured.
      expect(r.winLoss).toBeCloseTo(loss, 6);
    }
    // The same drops are NOT best for a move that is not the top move.
    expect(whiteLoses(1).grade).toBe("excellent");
    expect(whiteLoses(3).grade).toBe("good");
  });

  test("the top-move override has a ceiling at GRADE_BANDS.good: past it the two searches disagree, so the loss bands rule", () => {
    const e = 1e-6;
    expect(whiteLoses(GRADE_BANDS.good - e, true).grade).toBe("best");
    expect(whiteLoses(GRADE_BANDS.good + e, true).grade).toBe("inaccuracy");
    expect(whiteLoses(6, true).grade).toBe("inaccuracy");
    expect(whiteLoses(GRADE_BANDS.inaccuracy + e, true).grade).toBe("mistake");
    expect(whiteLoses(15, true).grade).toBe("mistake");
    expect(whiteLoses(GRADE_BANDS.mistake + e, true).grade).toBe("blunder");
    expect(whiteLoses(25, true).grade).toBe("blunder");
  });

  test("playedIsBest never makes a grade WORSE than the loss bands would", () => {
    for (const loss of [0, 0.1, 0.5, 1.5, 2.5, 4, 5, 7, 12, 19, 21, 40]) {
      const withTop = whiteLoses(loss, true).grade;
      const without = whiteLoses(loss, false).grade;
      const order = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];
      expect(order.indexOf(withTop)).toBeLessThanOrEqual(order.indexOf(without));
    }
  });

  test("a top move that throws away a mate-sized advantage is a blunder, not best", () => {
    expect(
      gradeMove({ prevEvalWhite: MATE_CP, newEvalWhite: 0, mover: "w", playedIsBest: true }).grade,
    ).toBe("blunder");
  });

  test("a near-equal non-top move is excellent, not best", () => {
    // ~1 pp loss: not the engine's top move, but inside the excellent band.
    expect(whiteLoses(1).grade).toBe("excellent");
  });

  test("mate clamps: throwing away a mate is a blunder, keeping it is best", () => {
    expect(
      gradeMove({ prevEvalWhite: MATE_CP, newEvalWhite: 0, mover: "w", playedIsBest: false }).grade,
    ).toBe("blunder");
    expect(
      gradeMove({ prevEvalWhite: MATE_CP, newEvalWhite: MATE_CP, mover: "w", playedIsBest: false }).grade,
    ).toBe("best");
    expect(
      gradeMove({ prevEvalWhite: -MATE_CP, newEvalWhite: 0, mover: "b", playedIsBest: false }).grade,
    ).toBe("blunder");
  });

  test("walking into a mate is a blunder", () => {
    expect(
      gradeMove({ prevEvalWhite: 0, newEvalWhite: -MATE_CP, mover: "w", playedIsBest: false }).grade,
    ).toBe("blunder");
  });
});
