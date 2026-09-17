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
