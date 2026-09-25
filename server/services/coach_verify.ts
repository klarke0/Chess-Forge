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

const CLAUSE_SPLIT = /[.!?;:,]|\s+(?:but|because)\s+/i;
const HAZARD =
  /\b(attack(?:s|ed|ing)?|defend(?:s|ed|ing)?|protect(?:s|ed|ing)?|guard(?:s|ed|ing)?|support(?:s|ed|ing)?|hang(?:s|ing)?|undefended|unprotected|unguarded|loose|en prise|fork(?:s|ed|ing)?|pin(?:s|ned|ning)?|skewer(?:s|ed|ing)?|threaten(?:s|ed|ing)?|eyeing|target(?:s|ing)?|pressur(?:e|es|ing)|traps?)\b/i;
const UNPROVABLE = /\b(fork(?:s|ed|ing)?|pin(?:s|ned|ning)?|skewer(?:s|ed|ing)?)\b/i;
const MATE_WORD = /\b(checkmate[sd]?|mate[sd]?|mating)\b/i;
const ATTACK_VERB = "attacks?|attacking|hits|targets|targeting|threatens|threatening|pressures|pressuring|eyeing";
const DEFEND_VERB = "defends|defending|protects|protecting|guards|guarding|supports|supporting";
const RELATION = new RegExp(
  `${PIECE} on ${SQ} (${ATTACK_VERB}|${DEFEND_VERB}) ((?:(?:the|your|their|a|white|black|enemy|opposing) )*)(?:${PIECE}(?: on ${SQ})?|${SQ})\\b`,
  "gi",
);
const SUBJECT = `(?:${PIECE} (?:on|at) ${SQ}|the ${SQ} ${PIECE}|${SQ})`;
const HANGING = new RegExp(
  `${SUBJECT} (?:(?:(?:is|are) )?(?:(?:now|completely|left) )*(?:hang(?:s|ing)|undefended|unprotected|unguarded|loose|en prise)` +
    `|(?:is|are) not (?:defended|protected|guarded)|has no defenders)`,
  "gi",
);
const MOVE_AFTER_VERB = /\b(?:play|plays|played|playing|after|with|push|pushes|advance|advances|move|moves)\s+([a-h][1-8])\b/gi;
const MOVE_AT_START = /^\s*([a-h][1-8])\s+(?:wins|loses|captures|takes|gains|threatens|attacks|forks|pins|hangs|defends)\b/i;

function checkClause(
  clause: string,
  facts: CoachFacts,
  boards: Chess[],
  allowed: Set<string>,
  violations: string[],
): void {
  const typeOf = (name: string): PieceSymbol => TYPE_BY_NAME[name.toLowerCase()];
  const before = violations.length;

  // Bare-square pawn pushes count as moves and must be supplied.
  const pushes = [...clause.matchAll(MOVE_AFTER_VERB)].map((m) => m[1]);
  const start = clause.match(MOVE_AT_START);
  if (start) pushes.push(start[1]);
  for (const sq of pushes) {
    if (!allowed.has(sq.toLowerCase())) violations.push(`unsupplied move ${sq}`);
  }

  // Mate words: direction must match the facts.
  if (MATE_WORD.test(clause)) {
    const moverMates = facts.best.givesMate || (facts.evalBefore.mate ?? 0) > 0 || (facts.evalAfterBest.mate ?? 0) > 0;
    const opponentMates = !!facts.reply?.givesMate || (facts.evalAfterWrong?.mate ?? 0) < 0;
    const anyMate = moverMates || opponentMates || facts.wrong?.givesMate === true;
    const colours = [...clause.matchAll(/\b(white|black)\b/gi)].map((m) => m[1].toLowerCase());
    const mine = colours.includes(facts.moverName.toLowerCase());
    const theirs = colours.some((c) => c !== facts.moverName.toLowerCase());
    const opp = /\bopponent/i.test(clause);
    const you = /\b(you|your|yours)\b/i.test(clause);
    const studentSide = mine || (you && !opp);
    const otherSide = theirs || opp;
    if (studentSide !== otherSide) {
      if (studentSide && !moverMates) violations.push(`false claim: student side mates: "${clause.trim()}"`);
      if (otherSide && !opponentMates) violations.push(`false claim: opponent mates: "${clause.trim()}"`);
    } else if (!anyMate) {
      violations.push("mentions mate but the engine facts show none");
    }
  }

  if (!HAZARD.test(clause)) return;

  // Relations: attack-like / defend-like between two pieces.
  let proven = 0;
  for (const m of clause.matchAll(RELATION)) {
    const srcType = typeOf(m[1]);
    const srcSq = m[2].toLowerCase() as Square;
    const defending = new RegExp(`^(${DEFEND_VERB})$`, "i").test(m[3]);
    const dstType = m[5] ? typeOf(m[5]) : undefined;
    const dstSq = (m[6] ?? m[7])?.toLowerCase() as Square | undefined;
    const holds = boards.some((b) => {
      const src = b.get(srcSq);
      if (!src || src.type !== srcType) return false;
      return b.board().flat().some((t) => {
        if (!t || (dstType && t.type !== dstType)) return false;
        if (dstSq && t.square !== dstSq) return false;
        if (defending ? t.color !== src.color : t.color === src.color) return false;
        return b.attackers(t.square, src.color).includes(srcSq);
      });
    });
    if (holds) proven++;
    else violations.push(`false claim: ${m[0]}`);
  }

  // Hanging / undefended.
  for (const m of clause.matchAll(HANGING)) {
    const t = m[1] ? typeOf(m[1]) : m[4] ? typeOf(m[4]) : undefined;
    const sq = (m[2] ?? m[3] ?? m[5]).toLowerCase() as Square;
    const needsAttacker = /hang|en prise/i.test(m[0]);
    const holds = boards.some((b) => {
      const p = b.get(sq);
      if (!p || (t && p.type !== t)) return false;
      const enemy: Color = p.color === "w" ? "b" : "w";
      const undefended = b.attackers(sq, p.color).length === 0;
      return undefended && (!needsAttacker || b.attackers(sq, enemy).length > 0);
    });
    if (holds) proven++;
    else violations.push(`false claim: ${m[0]}`);
  }

  // Referent: a piece word, a bare square or an unsupplied SAN token.
  const squares = [...clause.matchAll(/\b[a-h][1-8]\b/gi)].map((m) => m[0].toLowerCase());
  const referent =
    new RegExp(`\\b${PIECE}\\b`, "i").test(clause) ||
    squares.some((sq) => !allowed.has(sq)) ||
    [...clause.matchAll(SAN_TOKEN)].some((m) => !allowed.has(strip(m[0])));
  if (!referent) return;
  if (UNPROVABLE.test(clause)) violations.push(`unverifiable claim: "${clause.trim()}"`);
  else if (proven === 0 && violations.length === before) violations.push(`unverifiable claim: "${clause.trim()}"`);
}

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

  // 3-4, 6. Clause-level rules: every hazard claim must be proven, else fail closed.
  for (const clause of text.split(CLAUSE_SPLIT)) {
    checkClause(clause, facts, boards, allowed, violations);
  }

  // 5. Mate / stalemate / check words need a supporting fact.
  const moves = [facts.best, facts.wrong, facts.reply].filter((x): x is NonNullable<typeof x> => !!x);
  const mateInvolved =
    moves.some((mv) => mv.givesMate) ||
    facts.evalBefore.mate !== null ||
    facts.evalAfterBest.mate !== null ||
    facts.evalAfterWrong?.mate != null;
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
