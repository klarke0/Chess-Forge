import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  COACH_PROMPT_VERSION,
  getCachedCoach,
  putCachedCoach,
  type CoachCachePayload,
} from "../services/coach_cache";

const payload: CoachCachePayload = {
  concept: "Fork",
  analysis: "Nd5 forks the queen and rook.",
  steps: null,
  source: "model",
};
const key = {
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  wrongMove: "d4",
  correctMove: "e4",
};

describe("coach cache", () => {
  test("miss, then hit after put", () => {
    const db = new Database(":memory:");
    expect(getCachedCoach(key, db)).toBeNull();
    putCachedCoach(key, payload, db);
    expect(getCachedCoach(key, db)).toEqual(payload);
  });

  test("move counters in the FEN do not fragment the key", () => {
    const db = new Database(":memory:");
    putCachedCoach(key, payload, db);
    const otherCounters = { ...key, fen: key.fen.replace("0 1", "7 42") };
    expect(getCachedCoach(otherCounters, db)).toEqual(payload);
  });

  test("null wrongMove is a distinct key from a real wrong move", () => {
    const db = new Database(":memory:");
    putCachedCoach(key, payload, db);
    expect(getCachedCoach({ ...key, wrongMove: null }, db)).toBeNull();
  });

  test("rows written under another prompt version are ignored", () => {
    const db = new Database(":memory:");
    putCachedCoach(key, payload, db);
    db.query("UPDATE coach_cache SET prompt_version = ?").run(COACH_PROMPT_VERSION + 1);
    expect(getCachedCoach(key, db)).toBeNull();
  });

  test("put twice overwrites instead of throwing", () => {
    const db = new Database(":memory:");
    putCachedCoach(key, payload, db);
    putCachedCoach(key, { ...payload, concept: "Pin" }, db);
    expect(getCachedCoach(key, db)?.concept).toBe("Pin");
  });
});
