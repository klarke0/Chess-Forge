import { pieceName, scoreToPawns, type CoachCaptions, type CoachFacts, type MoveFacts, type PieceRef, type Score } from "./coach_facts";

export interface MastersSummary {
  white: number;
  draws: number;
  black: number;
  moves: Array<{ san: string; white: number; draws: number; black: number }>;
}

/** Gemini `responseSchema` (OpenAPI subset). */
export const COACH_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    concept: { type: "STRING" },
    analysis: { type: "STRING" },
    captions: {
      type: "OBJECT",
      properties: {
        wrong: { type: "STRING" },
        reply: { type: "STRING" },
        best: { type: "STRING" },
        why: { type: "STRING" },
      },
      required: ["wrong", "reply", "best", "why"],
    },
  },
  required: ["concept", "analysis", "captions"],
} as const;

const colorName = (c: "w" | "b") => (c === "w" ? "White" : "Black");
const refText = (p: PieceRef) => `${colorName(p.color)} ${pieceName(p.type)} on ${p.square}`;

function evalText(s: Score): string {
  if (s.mate !== null) {
    return `mate in ${Math.abs(s.mate)} for ${s.mate > 0 ? "you" : "your opponent"}`;
  }
  return `${(scoreToPawns(s) >= 0 ? "+" : "") + scoreToPawns(s).toFixed(2)} pawns (positive = good for you)`;
}

function moveText(label: string, m: MoveFacts): string {
  const parts = [
    `${label} ${m.san}: ${pieceName(m.piece)} from ${m.from} to ${m.to}`,
    m.captured ? `captures a ${pieceName(m.captured)}` : "captures nothing",
    m.givesMate ? "gives CHECKMATE" : m.givesCheck ? "gives check" : "gives no check",
    m.givesStalemate ? "STALEMATES the opponent (a draw)" : null,
    `attacked on ${m.to} by: ${m.landingAttackers.map(refText).join(", ") || "nobody"}`,
    `defended on ${m.to} by: ${m.landingDefenders.map(refText).join(", ") || "nobody"}`,
    `attacks: ${m.attacks.map(refText).join(", ") || "no enemy piece"}`,
  ].filter(Boolean);
  return `- ${parts.join("; ")}`;
}

export function buildCoachPrompt(
  f: CoachFacts,
  ctx: { phase?: string; framing?: string; masters?: MastersSummary | null; violations?: string[] },
): string {
  const student = f.moverName;
  const lines: string[] = [
    `You are a chess coach for a 1400-1800 club player. Explain ONE move. You narrate engine facts; you do not analyze. Every claim about an attack, defense, capture, check or material MUST come from the FACTS block. If FACTS does not support a claim, do not make it.`,
    ``,
    `The student plays ${student}. "You"/"your" always means ${student}.`,
    `POSITION (FEN): ${f.fen}`,
    `PIECES: ${f.pieces.map(refText).join(", ")}`,
    ctx.phase ? `Game phase: ${ctx.phase}` : ``,
    ``,
    `FACTS (Stockfish depth ${f.engineDepth} + rules engine; treat as ground truth):`,
    `- Eval before the move: ${evalText(f.evalBefore)}`,
  ];
  if (f.wrong && f.evalAfterWrong) {
    lines.push(
      `- Eval after the played move ${f.wrong.san}: ${evalText(f.evalAfterWrong)} (loss ${f.lossPawns >= 50 ? "decisive" : f.lossPawns.toFixed(2) + " pawns"}; severity: ${f.severity})`,
    );
  }
  lines.push(`- Eval after the best move ${f.best.san}: ${evalText(f.evalAfterBest)}`);
  lines.push(`- Best line: ${f.bestPvSan.join(" ") || f.best.san}`);
  if (f.wrong) lines.push(moveText("Played move", f.wrong));
  lines.push(moveText("Best move", f.best));
  if (f.reply && f.severity !== "equal") {
    lines.push(moveText("Engine's best reply to the played move", f.reply));
    lines.push(`- Refutation line: ${f.refutationPvSan.join(" ")}`);
  }
  const total = ctx.masters ? ctx.masters.white + ctx.masters.draws + ctx.masters.black : 0;
  if (ctx.masters && ctx.masters.moves.length > 0 && total > 0) {
    const top = ctx.masters.moves
      .slice(0, 3)
      .map((m) => `${m.san} ${Math.round(((m.white + m.draws + m.black) / total) * 100)}%`)
      .join(", ");
    lines.push(`- Masters play from here: ${top} (context only; do not name these moves in your answer)`);
  }
  lines.push(
    ``,
    `RULES`,
    `1. Name only pieces and squares from PIECES or FACTS. Never invent a piece or square.`,
    `2. Never write attacks, defends, hangs, wins, forks, pins, or threatens mate unless FACTS states it. Never write check, checkmate or stalemate unless FACTS says so.`,
    `3. Mention only these moves: ${[f.wrong?.san, f.reply && f.severity !== "equal" ? f.reply.san : null, f.best.san].filter(Boolean).join(", ")}${f.bestPvSan.length ? " and the lines above" : ""}. Do not suggest any other move.`,
    `4. Phrase every attack or defense claim as exactly '<piece> on <square> attacks the <piece> on <square>' or '<move> attacks the <piece>'; never use 'supports', 'eyes', 'pins', 'forks', 'traps', 'wins material', 'costs you', or claims about who wins or loses the game. Do not make claims about the final result of the game.`,
    f.severity === "equal"
      ? `5. The moves are nearly equal. Say both are fine and give ONE practical reason to prefer ${f.best.san}. Do NOT invent a tactic or refutation.`
      : f.wrong && f.reply
        ? `5. Explain what ${f.best.san} DOES, and what the played move ALLOWS (use the engine's reply). Do not merely restate the move.`
        : `5. Explain what ${f.best.san} does and why it matters. Do not merely restate the move.`,
    `6. Speak to the student as "you". "analysis" is at most 55 words; each caption at most 14 words.`,
    `7. In captions, refer to the student's move as "Your move <SAN>" and the alternative as "Better: <SAN>".`,
    ctx.framing ? `CONTEXT (unverified, do not repeat claims from it): ${ctx.framing}` : ``,
  );
  if (ctx.violations && ctx.violations.length > 0) {
    lines.push(
      ``,
      `YOUR PREVIOUS ANSWER WAS REJECTED for these unsupported claims: ${ctx.violations.join("; ")}. Rewrite it using only the FACTS.`,
    );
  }
  lines.push(
    ``,
    `OUTPUT JSON: { "concept": <one specific concept, not "tactics">, "analysis": <what the best move does + what the played move allows + one principle>, "captions": { "wrong": <caption for the played move>, "reply": <caption for the engine reply, or "" if none>, "best": <caption for the best move>, "why": <the key idea in one line> } }`,
  );
  return lines.join("\n");
}

const clip = (s: unknown, max: number): string | null =>
  typeof s === "string" && s.trim().length > 0 ? s.trim().slice(0, max) : null;

export function parseCoachJson(
  raw: string,
): { concept: string; analysis: string; captions: CoachCaptions } | null {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  let obj: any;
  try {
    obj = JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
  const concept = clip(obj?.concept, 80);
  const analysis = clip(obj?.analysis, 700);
  const cap = obj?.captions;
  const best = clip(cap?.best, 160);
  const why = clip(cap?.why, 160);
  if (!concept || !analysis || !best || !why) return null;
  return {
    concept,
    analysis,
    captions: {
      wrong: clip(cap?.wrong, 160) ?? "",
      reply: clip(cap?.reply, 160) ?? "",
      best,
      why,
    },
  };
}
