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
