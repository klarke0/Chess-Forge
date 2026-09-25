import { describe, expect, test } from "bun:test";
import type { EngineEval } from "../services/engine_native";
import type { EvalEngine } from "../services/coach_engine";
import type { CoachCacheKey, CoachCachePayload } from "../services/coach_cache";
import { explainBlunderCore, type CoachDeps } from "../services/coach";

const SCHOLAR = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function makeEngine(evals: EngineEval[]) {
  let calls = 0;
  const engine: EvalEngine = {
    async evaluate() {
      const ev = evals[calls++];
      if (!ev) throw new Error("unexpected engine call");
      return ev;
    },
  };
  return { engine, calls: () => calls };
}

const scholarEvals = (): EngineEval[] => [
  { cp: null, mate: 1, bestMoveUci: "h5f7", pvUci: ["h5f7"] },
  { cp: 30, mate: null, bestMoveUci: "g8f6", pvUci: ["g8f6"] },
];

const goodModelJson = JSON.stringify({
  concept: "Checkmate pattern",
  analysis:
    "Qxf7# ends the game at once. Nf3 lets Black defend with Nf6.",
  captions: {
    wrong: "Nf3 develops but misses the mate.",
    reply: "Nf6 defends against the threat.",
    best: "Qxf7# ends the game.",
    why: "The f7 square is the weak spot.",
  },
});
const lyingModelJson = JSON.stringify({
  concept: "Fork",
  analysis: "Bxf7+ wins because the knight on d7 attacks the queen.",
  captions: { wrong: "x", reply: "y", best: "z", why: "w" },
});

function harness(over: Partial<CoachDeps> & { evals?: EngineEval[]; geminiReplies?: Array<string | null> }) {
  const store = new Map<string, CoachCachePayload>();
  const k = (key: CoachCacheKey) => JSON.stringify(key);
  const replies = [...(over.geminiReplies ?? [goodModelJson])];
  let geminiCalls = 0;
  const { engine, calls } = makeEngine(over.evals ?? scholarEvals());
  const deps: CoachDeps = {
    engine: over.engine ?? engine,
    gemini: over.gemini ?? (async () => (geminiCalls++, replies.shift() ?? null)),
    masters: over.masters ?? (async () => null),
    cache: { get: (key) => store.get(k(key)) ?? null, put: (key, v) => void store.set(k(key), v) },
    now: over.now,
    budgetMs: over.budgetMs,
  };
  return { deps, store, engineCalls: calls, geminiCalls: () => geminiCalls };
}

const body = { fen: SCHOLAR, wrongMove: "Nf3", correctMove: "Qxf7#", cpLoss: null };

describe("explainBlunderCore", () => {
  test("happy path: model text verified, steps built by the server, result cached", async () => {
    const h = harness({});
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("model");
    expect((r.body.steps as unknown[]).length).toBe(4);
    expect(h.store.size).toBe(1);
    // Second call is a pure cache hit: no engine, no Gemini.
    const before = { e: h.engineCalls(), g: h.geminiCalls() };
    const again = await explainBlunderCore(body, h.deps);
    expect(again.status).toBe(200);
    expect({ e: h.engineCalls(), g: h.geminiCalls() }).toEqual(before);
  });

  test("a lying answer is retried once; a second lie falls back to the template and is cached", async () => {
    const h = harness({ geminiReplies: [lyingModelJson, lyingModelJson] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("template");
    expect(h.geminiCalls()).toBe(2);
    expect(h.store.size).toBe(1);
  });

  test("a lying answer followed by a good one succeeds on the retry", async () => {
    const h = harness({ geminiReplies: [lyingModelJson, goodModelJson] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.body.source).toBe("model");
    expect(h.geminiCalls()).toBe(2);
  });

  test("malformed JSON counts as a rejected attempt", async () => {
    const h = harness({ geminiReplies: ["not json at all", goodModelJson] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.body.source).toBe("model");
  });

  test("Gemini failing every time is a 502 and nothing is cached", async () => {
    const h = harness({ geminiReplies: [null, null] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(502);
    expect(r.body.error).toBeTruthy();
    expect(h.store.size).toBe(0);
  });

  test("engine failure is a 503", async () => {
    const h = harness({
      engine: { evaluate: async () => { throw new Error("stockfish binary not found"); } },
    });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(503);
    expect(h.store.size).toBe(0);
  });

  test("bad input is a 400, never a 500", async () => {
    const h = harness({});
    for (const bad of [
      null,
      "str",
      {},
      { fen: START },
      { fen: "not a fen", correctMove: "e4" },
      { fen: START, correctMove: "Qh5" },
      { fen: START, correctMove: "e4", wrongMove: "Ke3" },
      { fen: START, correctMove: "e4", wrongMove: 5 },
    ]) {
      const r = await explainBlunderCore(bad, h.deps);
      expect(r.status).toBe(400);
    }
    expect(h.engineCalls()).toBe(0);
  });

  test("wrongMove === correctMove returns a card with no engine or Gemini call", async () => {
    const h = harness({});
    const r = await explainBlunderCore({ fen: START, wrongMove: "e4", correctMove: "e4" }, h.deps);
    expect(r.status).toBe(200);
    expect(String(r.body.analysis)).toContain("e4");
    expect(r.body.steps).toBeNull();
    expect(h.engineCalls()).toBe(0);
    expect(h.geminiCalls()).toBe(0);
  });

  test("stalemate trap yields a truthful template card when the model lies", async () => {
    const h = harness({
      evals: [{ cp: null, mate: 1, bestMoveUci: "c1c8", pvUci: ["c1c8"] }],
      geminiReplies: [lyingModelJson, lyingModelJson],
    });
    const r = await explainBlunderCore(
      { fen: "k7/8/1K6/8/8/8/8/2Q5 w - - 0 1", wrongMove: "Qc7", correctMove: "Qc8#" },
      h.deps,
    );
    expect(r.status).toBe(200);
    expect(String(r.body.analysis).toLowerCase()).toContain("stalemate");
  });

  test("time budget: skips Gemini when too little time is left, returns an uncached template", async () => {
    let t = 0;
    const evals = scholarEvals();
    let i = 0;
    const h = harness({
      now: () => t,
      budgetMs: 9000,
      // Each engine call "takes" 5s on the fake clock; two calls leave < 2500ms of the 9s budget.
      engine: { evaluate: async () => { t += 5000; return evals[i++]; } },
    });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("template");
    expect(h.geminiCalls()).toBe(0);
    expect(h.store.size).toBe(0); // a time-budget template must not be cached
  });

  test("masters lookup failure never breaks the request", async () => {
    const h = harness({ masters: async () => { throw new Error("lichess down"); } });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
  });
});
