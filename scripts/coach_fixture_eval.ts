// usage: set -a; source server/.env; set +a; bun scripts/coach_fixture_eval.ts
// Measures the coach pipeline against the audit fixtures. Spends real Gemini calls (capped).
import { Chess } from "chess.js";
import { readFileSync, writeFileSync } from "fs";
import { explainBlunderCore } from "../server/services/coach";
import { getCoachEngine } from "../server/services/coach_engine";
import { COACH_RESPONSE_SCHEMA } from "../server/services/coach_prompt";
import { verifyClaims } from "../server/services/coach_verify";

const MAX_GEMINI_CALLS = 80;
const OUT = "/private/tmp/claude-501/-Users-kevin-Desktop-Work-Spaces-Chess-Forge/8d7ef58d-e437-45d4-9dbf-6243729a717a/scratchpad/coach_fixture_run.json";
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY not set");

type Sample = { fenBefore: string; wrong: string | null; correct: string; cpLoss: number; phase: string };
const samples: Sample[] = JSON.parse(
  readFileSync(new URL("../server/tests/fixtures/coach_samples.json", import.meta.url), "utf8"),
);
const tricky = [
  { id: "T1-stalemate", fenBefore: "k7/8/1K6/8/8/8/8/2Q5 w - - 0 1", wrong: "Qc7", correct: "Qc8#", cpLoss: 999, phase: "endgame" },
  { id: "T2-same-move", fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", wrong: "e4", correct: "e4", cpLoss: 0, phase: "opening" },
  { id: "T5-illegal-wrong", fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", wrong: "Qd5", correct: "e4", cpLoss: 1, phase: "opening" },
];

let currentCase = "";
let geminiCalls = 0;
const geminiLog: { caseId: string; returnedNull: boolean; replyLen: number }[] = [];
const verifyLog: { caseId: string; attempt: number; ok: boolean; violations: string[]; text: string }[] = [];

const gemini = async (prompt: string, timeoutMs: number): Promise<string | null> => {
  if (geminiCalls >= MAX_GEMINI_CALLS) throw new Error(`Gemini call cap (${MAX_GEMINI_CALLS}) reached`);
  geminiCalls++;
  let out: string | null = null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 900, temperature: 0.2, responseMimeType: "application/json",
            responseSchema: COACH_RESPONSE_SCHEMA, thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
    if (res.ok) {
      const data: any = await res.json();
      out = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    }
  } catch {
    out = null;
  }
  geminiLog.push({ caseId: currentCase, returnedNull: out === null, replyLen: out?.length ?? 0 });
  return out;
};

const verify = (text: string, facts: Parameters<typeof verifyClaims>[1]) => {
  const v = verifyClaims(text, facts);
  const attempt = verifyLog.filter((x) => x.caseId === currentCase).length + 1;
  verifyLog.push({ caseId: currentCase, attempt, ok: v.ok, violations: v.violations, text });
  return v;
};

const store = new Map<string, any>();
const engine = getCoachEngine();
const rows: any[] = [];
const only = process.env.ONLY_CASES?.split(",");
const cases = [...samples.map((s, i) => ({ id: `S${String(i + 1).padStart(2, "0")}`, ...s })), ...tricky].filter(
  (c) => !only || only.includes(c.id),
);

for (const c of cases) {
  currentCase = c.id;
  const t = Date.now();
  const r = await explainBlunderCore(
    { fen: c.fenBefore, wrongMove: c.wrong, correctMove: c.correct, cpLoss: c.cpLoss / 100, phase: c.phase },
    {
      engine, gemini, verify, masters: async () => null,
      cache: { get: (k) => store.get(JSON.stringify(k)) ?? null, put: (k, v) => void store.set(JSON.stringify(k), v) },
    },
  );
  const ms = Date.now() - t;
  const steps = (r.body.steps as any[] | null) ?? [];
  const play = (fen: string, sans: string[]) => {
    const ch = new Chess(fen);
    return sans.every((s) => { try { return !!ch.move(s); } catch { return false; } });
  };
  const moves = steps.filter((s) => s.action?.type === "playMove").map((s) => s.action.san as string);
  let stepsLegal = true;
  if (moves.length) stepsLegal = play(c.fenBefore, moves.slice(0, -1)) && play(c.fenBefore, [moves[moves.length - 1]]);

  const vs = verifyLog.filter((x) => x.caseId === c.id);
  const gs = geminiLog.filter((x) => x.caseId === c.id);
  let reason: string | null = null;
  const strip = (m: string | null) => (m ?? "").replace(/[+#]/g, "");
  if (r.status === 200 && r.body.source === "template") {
    if (gs.length === 0 && c.wrong && strip(c.wrong) === strip(c.correct)) reason = "same-move";
    else if (vs.length >= 2 && vs.every((x) => !x.ok)) reason = "verifier-rejected-twice";
    else if (gs.some((g) => g.returnedNull)) reason = "gemini-null";
    // Fewer than 2 model attempts without a null means the loop broke out for lack of time.
    else if (gs.length < 2) reason = "time-skip";
    else reason = "other";
  }
  rows.push({
    id: c.id, status: r.status, source: r.body.source ?? "-", ms, steps: steps.length, stepsLegal,
    geminiCalls: gs.length, geminiNulls: gs.filter((g) => g.returnedNull).length,
    verifyResults: vs.map((x) => x.ok), violations: vs.flatMap((x) => x.violations), reason,
    body: r.body,
    firstAttemptRejectedText: vs[0] && !vs[0].ok ? vs[0].text.slice(0, 300) : undefined,
  });
  console.log({ id: c.id, status: r.status, source: r.body.source ?? "-", ms, calls: gs.length, reason });
}

const shape = (v: string) =>
  v
    .replace(/\b[KQRBN]?[a-h]?x?[a-h][1-8](=[QRBN])?[+#]?/g, "<sq>")
    .replace(/\b(pawns?|knights?|bishops?|rooks?|queens?|kings?)\b/gi, "<piece>")
    .replace(/-?\d+(\.\d+)?/g, "<n>")
    .slice(0, 80);
const shapeCounts = new Map<string, number>();
for (const r of rows) for (const v of r.violations) shapeCounts.set(shape(v), (shapeCounts.get(shape(v)) ?? 0) + 1);
const topViolations = [...shapeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

const ok200 = rows.filter((r) => r.status === 200);
const reasons: Record<string, number> = {};
for (const r of rows) if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const summary = {
  total: rows.length,
  status200: ok200.length,
  non200: rows.filter((r) => r.status !== 200).map((r) => `${r.id}:${r.status}`),
  model: ok200.filter((r) => r.source === "model").length,
  template: ok200.filter((r) => r.source === "template").length,
  templateReasons: reasons,
  allStepsLegal: rows.every((r) => r.stepsLegal),
  medianMs: ms[Math.floor(ms.length / 2)],
  maxMs: ms[ms.length - 1],
  geminiCalls,
  topViolations,
};
console.log(JSON.stringify(summary, null, 2));
writeFileSync(process.env.OUT_PATH ?? OUT, JSON.stringify({ summary, rows }, null, 2));
process.exit(0);
