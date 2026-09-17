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
