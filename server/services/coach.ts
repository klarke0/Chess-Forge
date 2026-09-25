import { Chess } from "chess.js";
import type { CoachCacheKey, CoachCachePayload } from "./coach_cache";
import type { EvalEngine } from "./coach_engine";
import {
  buildFacts,
  CoachInputError,
  stepsFromFacts,
  type CoachCaptions,
  type CoachFacts,
  type CoachInput,
} from "./coach_facts";
import {
  buildCoachPrompt,
  parseCoachJson,
  type MastersSummary,
} from "./coach_prompt";
import { templateFromFacts, verifyClaims, type Verdict } from "./coach_verify";

export interface CoachDeps {
  engine: EvalEngine;
  gemini(prompt: string, timeoutMs: number): Promise<string | null>;
  masters(fen: string): Promise<MastersSummary | null>;
  cache: {
    get(k: CoachCacheKey): CoachCachePayload | null;
    put(k: CoachCacheKey, v: CoachCachePayload): void;
  };
  now?: () => number;
  /** Total server budget; must stay under the client's 10s request timeout. */
  budgetMs?: number;
  /** Cap on the optional masters lookup (default 1500ms). */
  mastersTimeoutMs?: number;
  /** Claim verifier; defaults to the real one. Injectable for tests. */
  verify?: (text: string, facts: CoachFacts) => Verdict;
}

export interface CoachResult {
  status: number;
  body: Record<string, unknown>;
}

const GEMINI_MAX_MS = 6000;
const GEMINI_MIN_LEFT_MS = 2500;
const stripDecor = (s: string) => s.replace(/[+#]/g, "");

function parseInput(raw: unknown): CoachInput | string {
  if (typeof raw !== "object" || raw === null) return "Request body must be a JSON object";
  const b = raw as Record<string, unknown>;
  if (typeof b.fen !== "string" || b.fen.length === 0 || b.fen.length > 100) {
    return "fen (string) is required";
  }
  if (typeof b.correctMove !== "string" || b.correctMove.length === 0 || b.correctMove.length > 12) {
    return "correctMove (string) is required";
  }
  if (b.wrongMove != null && (typeof b.wrongMove !== "string" || b.wrongMove.length > 12)) {
    return "wrongMove must be a string or null";
  }
  return {
    fen: b.fen,
    wrongMove: (b.wrongMove as string | null | undefined) || null,
    correctMove: b.correctMove,
    cpLoss: typeof b.cpLoss === "number" && Number.isFinite(b.cpLoss) ? b.cpLoss : null,
    phase: typeof b.phase === "string" ? b.phase.slice(0, 40) : undefined,
    framing: typeof b.framing === "string" ? b.framing.slice(0, 500) : undefined,
  };
}

function payload(
  facts: CoachFacts,
  t: { concept: string; analysis: string; captions: CoachCaptions },
  source: "model" | "template",
): CoachCachePayload {
  return {
    concept: t.concept,
    analysis: t.analysis,
    steps: stepsFromFacts(facts, t.captions),
    source,
  };
}

const ok = (p: CoachCachePayload): CoachResult => ({ status: 200, body: { ...p } });

export async function explainBlunderCore(raw: unknown, deps: CoachDeps): Promise<CoachResult> {
  const input = parseInput(raw);
  if (typeof input === "string") return { status: 400, body: { error: input } };

  // Same move as the best move: nothing to explain, and no engine needed.
  try {
    new Chess(input.fen).move(input.correctMove);
    if (input.wrongMove) new Chess(input.fen).move(input.wrongMove);
  } catch {
    return { status: 400, body: { error: "fen, correctMove and wrongMove must be legal in the position" } };
  }
  if (input.wrongMove && stripDecor(input.wrongMove) === stripDecor(input.correctMove)) {
    return {
      status: 200,
      body: {
        concept: "Correct move",
        analysis: `${input.correctMove} is the engine's move — you played it.`,
        steps: null,
        source: "template",
      },
    };
  }

  const key: CoachCacheKey = {
    fen: input.fen,
    wrongMove: input.wrongMove,
    correctMove: input.correctMove,
  };
  try {
    return await run(input, key, deps);
  } catch (e) {
    console.error("[coach] unexpected failure:", e);
    return { status: 500, body: { error: "Coach failed" } };
  }
}

async function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function run(input: CoachInput, key: CoachCacheKey, deps: CoachDeps): Promise<CoachResult> {
  let cached: CoachCachePayload | null = null;
  try {
    cached = deps.cache.get(key);
  } catch (e) {
    console.warn("[coach] cache read failed:", e);
  }
  if (cached) return ok(cached);

  const put = (p: CoachCachePayload) => {
    try {
      deps.cache.put(key, p);
    } catch (e) {
      console.warn("[coach] cache write failed:", e);
    }
  };

  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? 9000;

  let facts: CoachFacts;
  let masters: MastersSummary | null;
  try {
    [facts, masters] = await Promise.all([
      buildFacts(input, deps.engine),
      withTimeout(
        Promise.resolve()
          .then(() => deps.masters(input.fen))
          .catch(() => null),
        deps.mastersTimeoutMs ?? 1500,
      ),
    ]);
  } catch (e) {
    if (e instanceof CoachInputError) return { status: 400, body: { error: e.message } };
    console.error("[coach] engine failure:", e);
    return { status: 503, body: { error: "Engine unavailable" } };
  }

  let violations: string[] = [];
  let geminiErrors = 0;
  let sawModelText = false;
  let skippedForTime = false;
  // Only a verifier rejection is deterministic enough to cache as a template.
  let lastFailure: "verifier" | "other" = "other";

  for (let attempt = 0; attempt < 2; attempt++) {
    const left = budget - (now() - started);
    if (left < GEMINI_MIN_LEFT_MS) {
      skippedForTime = true;
      break;
    }
    const prompt = buildCoachPrompt(facts, {
      phase: input.phase,
      framing: input.framing,
      masters,
      violations,
    });
    let text: string | null;
    try {
      text = await deps.gemini(prompt, Math.min(GEMINI_MAX_MS, left));
    } catch (e) {
      console.warn("[coach] gemini failed:", e);
      text = null;
    }
    if (text === null) {
      geminiErrors++;
      lastFailure = "other";
      continue;
    }
    sawModelText = true;
    const parsed = parseCoachJson(text);
    if (!parsed) {
      violations = ["the answer was not valid JSON in the requested shape"];
      lastFailure = "other";
      continue;
    }
    // Joined with ". " so the verifier sees each string as its own clause.
    const all = [parsed.analysis, parsed.concept, ...Object.values(parsed.captions)]
      .filter(Boolean)
      .join(". ");
    let verdict: Verdict;
    try {
      verdict = (deps.verify ?? verifyClaims)(all, facts);
    } catch (e) {
      // A verifier bug is not a model lie: don't blame the model or cache the result.
      console.error("[coach] verifier error:", e);
      lastFailure = "other";
      continue;
    }
    if (verdict.ok) {
      const p = payload(facts, parsed, "model");
      put(p);
      return ok(p);
    }
    violations = verdict.violations;
    lastFailure = "verifier";
  }

  if (geminiErrors > 0 && !sawModelText) {
    return { status: 502, body: { error: "Coach unavailable (Gemini error)" } };
  }

  const p = payload(facts, templateFromFacts(facts), "template");
  if (!skippedForTime && lastFailure === "verifier") put(p);
  return ok(p);
}
