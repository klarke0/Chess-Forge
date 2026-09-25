import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { getCachedEval, putCachedEval } from "../services/position_cache";

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("position eval cache", () => {
  test("miss, then hit after put, values preserved as stored", () => {
    const db = new Database(":memory:");
    expect(getCachedEval(FEN, 14, db)).toBeNull();
    putCachedEval(FEN, 14, { cp: 31, mate: null, bestMoveUci: "e2e4" }, db);
    expect(getCachedEval(FEN, 14, db)).toEqual({
      cp: 31,
      mate: null,
      bestMoveUci: "e2e4",
      depth: 14,
    });
  });

  test("mate scores round-trip with a null cp", () => {
    const db = new Database(":memory:");
    putCachedEval(FEN, 14, { cp: null, mate: -3, bestMoveUci: "a1a2" }, db);
    expect(getCachedEval(FEN, 14, db)).toMatchObject({ cp: null, mate: -3 });
  });

  test("move counters in the FEN do not fragment the key", () => {
    const db = new Database(":memory:");
    putCachedEval(FEN, 14, { cp: 20, mate: null, bestMoveUci: "d2d4" }, db);
    expect(getCachedEval(FEN.replace("0 1", "9 55"), 14, db)?.cp).toBe(20);
  });

  test("a different side to move is a different position", () => {
    const db = new Database(":memory:");
    putCachedEval(FEN, 14, { cp: 20, mate: null, bestMoveUci: "d2d4" }, db);
    expect(getCachedEval(FEN.replace(" w ", " b "), 14, db)).toBeNull();
  });

  test("a deeper cached eval satisfies a shallower request", () => {
    const db = new Database(":memory:");
    putCachedEval(FEN, 16, { cp: 25, mate: null, bestMoveUci: "e2e4" }, db);
    expect(getCachedEval(FEN, 12, db)).toMatchObject({ cp: 25, depth: 16 });
    expect(getCachedEval(FEN, 16, db)).toMatchObject({ cp: 25, depth: 16 });
  });

  test("a shallower cached eval does NOT satisfy a deeper request", () => {
    const db = new Database(":memory:");
    putCachedEval(FEN, 12, { cp: 25, mate: null, bestMoveUci: "e2e4" }, db);
    expect(getCachedEval(FEN, 14, db)).toBeNull();
  });

  test("with several rows, the deepest one wins", () => {
    const db = new Database(":memory:");
    putCachedEval(FEN, 12, { cp: 10, mate: null, bestMoveUci: "a2a3" }, db);
    putCachedEval(FEN, 18, { cp: 30, mate: null, bestMoveUci: "e2e4" }, db);
    putCachedEval(FEN, 14, { cp: 20, mate: null, bestMoveUci: "d2d4" }, db);
    expect(getCachedEval(FEN, 13, db)).toMatchObject({ cp: 30, depth: 18, bestMoveUci: "e2e4" });
  });

  test("put twice at the same depth overwrites instead of throwing", () => {
    const db = new Database(":memory:");
    putCachedEval(FEN, 14, { cp: 10, mate: null, bestMoveUci: "a2a3" }, db);
    putCachedEval(FEN, 14, { cp: 44, mate: null, bestMoveUci: "e2e4" }, db);
    expect(getCachedEval(FEN, 14, db)).toMatchObject({ cp: 44, bestMoveUci: "e2e4" });
  });

  test("the table is created lazily and has the documented shape", () => {
    const db = new Database(":memory:");
    getCachedEval(FEN, 14, db);
    const cols = (db.query("PRAGMA table_info(position_evals)").all() as {
      name: string;
      pk: number;
    }[]).map((c) => c.name);
    expect(cols).toEqual(["fen_norm", "depth", "cp", "mate", "best_uci"]);
    const pk = (db.query("PRAGMA table_info(position_evals)").all() as {
      name: string;
      pk: number;
    }[])
      .filter((c) => c.pk > 0)
      .map((c) => c.name);
    expect(pk.sort()).toEqual(["depth", "fen_norm"]);
  });
});
