import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { pieceName, type CoachCaptions, type CoachFacts } from "./coach_facts";

export interface Verdict {
  ok: boolean;
  violations: string[];
}

const TYPE_BY_NAME: Record<string, PieceSymbol> = {
  pawn: "p",
  knight: "n",
  bishop: "b",
  rook: "r",
  queen: "q",
  king: "k",
};
const PIECE = "(pawn|knight|bishop|rook|queen|king)";
const SQ = "([a-h][1-8])";

const SAN_TOKEN =
  /\b(O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?)[+#]?/g;

const strip = (san: string): string => san.replace(/[+#]/g, "");

export function verifyClaims(text: string, facts: CoachFacts): Verdict {
  const violations: string[] = [];
  const boards = facts.positions.map((f) => new Chess(f));
  const typeOf = (name: string): PieceSymbol => TYPE_BY_NAME[name.toLowerCase()];

  // 1. Every move token must be one the server supplied.
  const allowed = new Set<string>(
    [
      facts.best.san,
      facts.wrong?.san,
      facts.reply?.san,
      ...facts.bestPvSan,
      ...facts.refutationPvSan,
    ]
      .filter((s): s is string => !!s)
      .map(strip),
  );
  for (const m of text.matchAll(SAN_TOKEN)) {
    if (!allowed.has(strip(m[0]))) violations.push(`unsupplied move ${m[0]}`);
  }

  // 2. "<piece> on <square>" must exist in some position the text may describe.
  for (const m of text.matchAll(new RegExp(`${PIECE} (?:on|at) ${SQ}`, "gi"))) {
    const t = typeOf(m[1]);
    const sq = m[2] as Square;
    if (!boards.some((b) => b.get(sq)?.type === t)) {
      violations.push(`no ${m[1].toLowerCase()} on ${sq}`);
    }
  }

  // 3. "<piece> on <sq> attacks/defends <piece> [on <sq>]" must hold on some board.
  const relation = new RegExp(
    `${PIECE} on ${SQ} (attacks|attacking|hits|threatens|threatening|defends|defending) (?:the |your |their |a )?${PIECE}(?: on ${SQ})?`,
    "gi",
  );
  for (const m of text.matchAll(relation)) {
    const srcType = typeOf(m[1]);
    const srcSq = m[2] as Square;
    const defending = /^defend/i.test(m[3]);
    const dstType = typeOf(m[4]);
    const dstSq = m[5] as Square | undefined;
    const holds = boards.some((b) => {
      const src = b.get(srcSq);
      if (!src || src.type !== srcType) return false;
      return b.board().flat().some((t) => {
        if (!t || t.type !== dstType) return false;
        if (dstSq && t.square !== dstSq) return false;
        if (defending ? t.color !== src.color : t.color === src.color) return false;
        return b.attackers(t.square, src.color).includes(srcSq);
      });
    });
    if (!holds) violations.push(`false claim: ${m[0]}`);
  }

  // 4. "<piece> on <sq> is hanging/undefended" must hold on some board.
  const hanging = new RegExp(
    `${PIECE} on ${SQ} (?:is |are )?(hanging|undefended|unprotected|loose|en prise)`,
    "gi",
  );
  for (const m of text.matchAll(hanging)) {
    const t = typeOf(m[1]);
    const sq = m[2] as Square;
    const needsAttacker = /hanging|en prise/i.test(m[3]);
    const holds = boards.some((b) => {
      const p = b.get(sq);
      if (!p || p.type !== t) return false;
      const enemy: Color = p.color === "w" ? "b" : "w";
      const defended = b.attackers(sq, p.color).length > 0;
      const attacked = b.attackers(sq, enemy).length > 0;
      return !defended && (!needsAttacker || attacked);
    });
    if (!holds) violations.push(`false claim: ${m[0]}`);
  }

  // 5. Mate / stalemate / check words need a supporting fact.
  const moves = [facts.best, facts.wrong, facts.reply].filter((x): x is NonNullable<typeof x> => !!x);
  const mateInvolved =
    moves.some((mv) => mv.givesMate) ||
    facts.evalBefore.mate !== null ||
    facts.evalAfterBest.mate !== null ||
    facts.evalAfterWrong?.mate != null;
  if (/\b(checkmate|checkmates|mate|mating)\b/i.test(text) && !mateInvolved) {
    violations.push("mentions mate but the engine facts show none");
  }
  if (/\bstalemate\b/i.test(text) && !moves.some((mv) => mv.givesStalemate)) {
    violations.push("mentions stalemate but no move stalemates");
  }
  if (/\bcheck(?:s|ed|ing)?\b/i.test(text) && !mateInvolved && !moves.some((mv) => mv.givesCheck)) {
    violations.push("mentions check but no move gives check");
  }

  return { ok: violations.length === 0, violations };
}

export function templateFromFacts(f: CoachFacts): {
  concept: string;
  analysis: string;
  captions: CoachCaptions;
} {
  const loss = f.lossPawns >= 50 ? "a decisive amount of material" : `${f.lossPawns.toFixed(1)} pawns`;
  const bestBits = [
    f.best.captured ? `wins the ${pieceName(f.best.captured)}` : null,
    f.best.givesMate ? "delivers checkmate" : f.best.givesCheck ? "gives check" : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const bestLine = `${f.best.san} is the engine's move${bestBits ? `: it ${bestBits}` : ""}.`;

  let wrongLine = "";
  if (f.wrong && !f.wrongEqualsBest) {
    if (f.wrong.givesStalemate) {
      wrongLine = `${f.wrong.san} is stalemate, a draw instead of a win.`;
    } else if (f.severity === "equal") {
      wrongLine = `${f.wrong.san} is close in the engine's eyes (${f.lossPawns.toFixed(1)} pawns), so this is a small point.`;
    } else {
      const replyBit = f.reply
        ? ` ${f.reply.san}${f.reply.captured ? `, which captures your ${pieceName(f.reply.captured)}` : ""}`
        : " a strong reply";
      wrongLine = `${f.wrong.san} allows${replyBit}; the engine puts the cost at ${loss}.`;
    }
  }

  const mateInvolved = f.best.givesMate || f.evalBefore.mate !== null;
  const concept = mateInvolved
    ? "Checkmate pattern"
    : f.reply?.captured
      ? "Loose piece"
      : f.best.captured
        ? "Winning material"
        : f.best.givesCheck
          ? "Forcing moves"
          : "Piece activity";

  return {
    concept,
    analysis: [bestLine, wrongLine].filter(Boolean).join(" "),
    captions: {
      wrong: f.wrong ? `${f.wrong.san} was played.` : "",
      reply: f.reply ? `${f.reply.san} is the engine's best answer.` : "",
      best: `${f.best.san} is the move.`,
      why: `Engine depth ${f.engineDepth}: about ${loss} at stake.`,
    },
  };
}
