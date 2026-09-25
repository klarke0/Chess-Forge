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
import { templateFromFacts, verifyClaims } from "./coach_verify";

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
  const cached = deps.cache.get(key);
  if (cached) return ok(cached);

  const now = deps.now ?? Date.now;
  const started = now();
  const budget = deps.budgetMs ?? 9000;

  let facts: CoachFacts;
  let masters: MastersSummary | null;
  try {
    [facts, masters] = await Promise.all([
      buildFacts(input, deps.engine),
      deps.masters(input.fen).catch(() => null),
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

  for (let attempt = 0; attempt < 2; attempt++) {
    const left = budget - (now() - started);
    if (left < GEMINI_MIN_LEFT_MS) {
      skippedForTime = true;
      break;
    }
    const text = await deps.gemini(
      buildCoachPrompt(facts, { phase: input.phase, framing: input.framing, masters, violations }),
      Math.min(GEMINI_MAX_MS, left),
    );
    if (text === null) {
      geminiErrors++;
      continue;
    }
    sawModelText = true;
    const parsed = parseCoachJson(text);
    if (!parsed) {
      violations = ["the answer was not valid JSON in the requested shape"];
      continue;
    }
    // Joined with ". " so the verifier sees each string as its own clause.
    const all = [parsed.analysis, parsed.concept, ...Object.values(parsed.captions)]
      .filter(Boolean)
      .join(". ");
    let verdict: { ok: boolean; violations: string[] };
    try {
      verdict = verifyClaims(all, facts);
    } catch (e) {
      console.error("[coach] verifier error:", e);
      verdict = { ok: false, violations: ["verifier error"] };
    }
    if (verdict.ok) {
      const p = payload(facts, parsed, "model");
      deps.cache.put(key, p);
      return ok(p);
    }
    violations = verdict.violations;
  }

  if (geminiErrors > 0 && !sawModelText) {
    return { status: 502, body: { error: "Coach unavailable (Gemini error)" } };
  }

  const p = payload(facts, templateFromFacts(facts), "template");
  // A template caused by rejected claims is deterministic and safe to cache;
  // one caused by running out of time is not — the next call should try Gemini.
  if (!skippedForTime) deps.cache.put(key, p);
  return ok(p);
}
