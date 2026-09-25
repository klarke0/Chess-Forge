import { describe, expect, spyOn, test } from "bun:test";
import type { EngineEval } from "../services/engine_native";
import type { EvalEngine } from "../services/coach_engine";
import type { CoachCacheKey, CoachCachePayload } from "../services/coach_cache";
import { buildFacts } from "../services/coach_facts";
import { buildCoachPrompt } from "../services/coach_prompt";
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
    expect((r.body.steps as unknown[]).length).toBe(2);
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
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const h = harness({
        engine: { evaluate: async () => { throw new Error("stockfish binary not found"); } },
      });
      const r = await explainBlunderCore(body, h.deps);
      expect(r.status).toBe(503);
      expect(h.store.size).toBe(0);
      expect(spy.mock.calls[0]?.[0]).toBe("[coach] engine failure:");
    } finally {
      spy.mockRestore();
    }
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

  test("masters that never resolves is bounded by mastersTimeoutMs; sync throw is a miss", async () => {
    const h = harness({ masters: () => new Promise(() => {}) });
    h.deps.mastersTimeoutMs = 50;
    expect((await explainBlunderCore(body, h.deps)).status).toBe(200);
    const h2 = harness({
      masters: () => { throw new Error("sync"); },
    });
    expect((await explainBlunderCore(body, h2.deps)).status).toBe(200);
  });

  test("cache.get / cache.put throwing never break the request", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const h = harness({});
      h.deps.cache = {
        get: () => { throw new Error("db"); },
        put: () => { throw new Error("db"); },
      };
      const r = await explainBlunderCore(body, h.deps);
      expect(r.status).toBe(200);
      expect(r.body.source).toBe("model");
    } finally {
      warn.mockRestore();
    }
  });

  test("gemini rejecting on both attempts is a 502", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const h = harness({ gemini: async () => { throw new Error("network"); } });
      const r = await explainBlunderCore(body, h.deps);
      expect(r.status).toBe(502);
      expect(h.store.size).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  test("a throw while building the prompt is a 500 JSON, not an exception", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      const bad = {
        white: 1, draws: 1, black: 1,
        get moves(): never { throw new Error("boom"); },
      } as unknown as never;
      const h = harness({ masters: async () => bad });
      const r = await explainBlunderCore(body, h.deps);
      expect(r.status).toBe(500);
      expect(r.body.error).toBe("Coach failed");
    } finally {
      err.mockRestore();
    }
  });

  test("retry prompt contains the first attempt's violations", async () => {
    const prompts: string[] = [];
    const replies = [lyingModelJson, goodModelJson];
    const h = harness({ gemini: async (p) => (prompts.push(p), replies.shift() ?? null) });
    await explainBlunderCore(body, h.deps);
    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain("PREVIOUS ANSWER WAS REJECTED");
    expect(prompts[1]).toContain("PREVIOUS ANSWER WAS REJECTED");
    expect(prompts[1]).toMatch(/knight|d7|unsupported|unverifiable/i);
  });

  test("time runs out on the second attempt after a rejection: 200 template, not cached", async () => {
    let t = 0;
    const h = harness({
      now: () => t,
      budgetMs: 9000,
      gemini: async () => { t += 7000; return lyingModelJson; },
    });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("template");
    expect(h.store.size).toBe(0);
  });

  test("rejected attempt then a Gemini null: 200 template, not cached", async () => {
    const h = harness({ geminiReplies: [lyingModelJson, null] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("template");
    expect(h.store.size).toBe(0);
  });

  test("malformed JSON twice: template, not cached", async () => {
    const h = harness({ geminiReplies: ["nope", "nope"] });
    const r = await explainBlunderCore(body, h.deps);
    expect(r.body.source).toBe("template");
    expect(h.store.size).toBe(0);
  });
});

describe("verifier throwing", () => {
  test("throws on both attempts: uncached template, model not told 'verifier error'", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      const prompts: string[] = [];
      const h = harness({});
      h.deps.gemini = async (p) => (prompts.push(p), goodModelJson);
      h.deps.verify = () => { throw new Error("verifier bug"); };
      const r = await explainBlunderCore(body, h.deps);
      expect(r.status).toBe(200);
      expect(r.body.source).toBe("template");
      expect(h.store.size).toBe(0);
      expect(prompts.length).toBe(2);
      expect(prompts[1]).not.toContain("verifier error");
    } finally {
      err.mockRestore();
    }
  });

  test("throws once then ok: model card is cached", async () => {
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      const h = harness({});
      h.deps.gemini = async () => goodModelJson;
      let n = 0;
      h.deps.verify = () => {
        if (n++ === 0) throw new Error("verifier bug");
        return { ok: true, violations: [] };
      };
      const r = await explainBlunderCore(body, h.deps);
      expect(r.body.source).toBe("model");
      expect(h.store.size).toBe(1);
    } finally {
      err.mockRestore();
    }
  });
});

describe("buildCoachPrompt", () => {
  const facts = async (evals: EngineEval[], wrong: string | null, cpLoss: number | null = null) => {
    let i = 0;
    const engine: EvalEngine = { async evaluate() { return evals[i++]!; } };
    return buildFacts({ fen: SCHOLAR, wrongMove: wrong, correctMove: "Qxf7#", cpLoss }, engine);
  };

  test("equal severity omits reply and refutation", async () => {
    const f = await facts(
      [
        { cp: 30, mate: null, bestMoveUci: "h5f7", pvUci: ["h5f7"] },
        { cp: -30, mate: null, bestMoveUci: "g8f6", pvUci: ["g8f6"] },
      ],
      "Nf3",
    );
    expect(f.severity).toBe("equal");
    const p = buildCoachPrompt(f, {});
    expect(p).not.toContain("Engine's best reply");
    expect(p).not.toContain("Refutation line");
  });

  test("no played move: no 'ALLOWS' wording; reply facts shown when severe", async () => {
    const f = await facts([{ cp: null, mate: 1, bestMoveUci: "h5f7", pvUci: ["h5f7"] }], null);
    const p = buildCoachPrompt(f, {});
    expect(p).not.toContain("ALLOWS");
    const g = await facts(scholarEvals(), "Nf3");
    expect(buildCoachPrompt(g, {})).toContain("Engine's best reply");
  });

  test("masters with zero games yields no NaN; violations and unverified framing appear", async () => {
    const f = await facts(scholarEvals(), "Nf3");
    const p = buildCoachPrompt(f, {
      masters: { white: 0, draws: 0, black: 0, moves: [{ san: "Qxf7#", white: 0, draws: 0, black: 0 }] },
      violations: ["claim X"],
      framing: "hello",
    });
    expect(p).not.toContain("NaN");
    expect(p).toContain("claim X");
    expect(p).toContain("CONTEXT (unverified, do not repeat claims from it): hello");
  });
});
