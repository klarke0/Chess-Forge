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
