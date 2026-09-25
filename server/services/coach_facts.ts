import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import type { EngineEval } from "./engine_native";
import type { EvalEngine } from "./coach_engine";

export const COACH_ENGINE_DEPTH = 14;

export class CoachInputError extends Error {}

export type Severity = "equal" | "inaccuracy" | "mistake" | "blunder" | "decisive";

/** cp in centipawns or mate-in-N, always from the MOVER's point of view. */
export interface Score {
  cp: number | null;
  mate: number | null;
}

export interface PieceRef {
  color: Color;
  type: PieceSymbol;
  square: Square;
}

export interface MoveFacts {
  san: string;
  from: Square;
  to: Square;
  piece: PieceSymbol;
  captured: PieceSymbol | null;
  givesCheck: boolean;
  givesMate: boolean;
  givesStalemate: boolean;
  /** Enemy pieces that attack the landing square right after the move. */
  landingAttackers: PieceRef[];
  /** Friendly pieces that guard the landing square. */
  landingDefenders: PieceRef[];
  /** Enemy pieces the moved piece attacks from its landing square. */
  attacks: PieceRef[];
}

export interface CoachFacts {
  fen: string;
  mover: Color;
  moverName: "White" | "Black";
  wrong: MoveFacts | null;
  best: MoveFacts;
  reply: MoveFacts | null;
  evalBefore: Score;
  evalAfterWrong: Score | null;
  evalAfterBest: Score;
  lossPawns: number;
  severity: Severity;
  bestPvSan: string[];
  refutationPvSan: string[];
  wrongEqualsBest: boolean;
  pieces: PieceRef[];
  /** Every position the coach text may legitimately describe. */
  positions: string[];
  engineDepth: number;
}

export interface CoachInput {
  fen: string;
  wrongMove: string | null;
  correctMove: string;
  /** Pawns, from the client. Only used when wrongMove is null. */
  cpLoss: number | null;
  phase?: string;
  framing?: string;
}

export interface CoachCaptions {
  wrong: string;
  reply: string;
  best: string;
  why: string;
}

export type CoachStepOut = {
  text: string;
  action:
    | { type: "playMove"; san: string; highlight?: "red" | "green" | "amber" }
    | { type: "highlight"; squares: string[]; color?: "red" | "green" | "amber" | "blue" };
};

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
export const pieceName = (t: PieceSymbol): string => PIECE_NAMES[t];

export function scoreToPawns(s: Score): number {
  if (s.mate !== null) {
    const n = Math.min(Math.abs(s.mate), 50);
    return s.mate > 0 ? 100 - n : -(100 - n);
  }
  return (s.cp ?? 0) / 100;
}

const flip = (s: Score): Score => ({
  cp: s.cp === null ? null : -s.cp,
  mate: s.mate === null ? null : -s.mate,
});

export function severityFor(
  lossPawns: number,
  opts: { allowsMate: boolean; flippedToLost: boolean; stalemateThrow: boolean },
): Severity {
  if (opts.allowsMate || opts.flippedToLost || opts.stalemateThrow) return "decisive";
  if (lossPawns < 0.3) return "equal";
  if (lossPawns < 0.7) return "inaccuracy";
  if (lossPawns < 1.5) return "mistake";
  return "blunder";
}

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function uciToSan(fen: string, uci: string): string | null {
  if (!UCI_RE.test(uci)) return null;
  try {
    const m = new Chess(fen).move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    return m ? m.san : null;
  } catch {
    return null;
  }
}

export function pvToSan(fen: string, pv: string[], maxPlies = 4): string[] {
  const out: string[] = [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return out;
  }
  for (const uci of pv.slice(0, maxPlies)) {
    if (!UCI_RE.test(uci)) break;
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (!m) break;
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

function piecesOf(chess: Chess): PieceRef[] {
  const out: PieceRef[] = [];
  for (const row of chess.board()) {
    for (const p of row) if (p) out.push({ color: p.color, type: p.type, square: p.square });
  }
  return out;
}

export function describeMove(fen: string, san: string): { facts: MoveFacts; fenAfter: string } {
  const chess = new Chess(fen);
  const mv = chess.move(san); // throws on an illegal move
  const me = mv.color;
  const them: Color = me === "w" ? "b" : "w";
  const ref = (sq: Square): PieceRef | null => {
    const p = chess.get(sq);
    return p ? { color: p.color, type: p.type, square: sq } : null;
  };
  const refs = (sqs: Square[]): PieceRef[] =>
    sqs.map(ref).filter((r): r is PieceRef => r !== null);

  const facts: MoveFacts = {
    san: mv.san,
    from: mv.from,
    to: mv.to,
    piece: mv.piece,
    captured: mv.captured ?? null,
    givesCheck: chess.inCheck(),
    givesMate: chess.isCheckmate(),
    givesStalemate: chess.isStalemate(),
    landingAttackers: refs(chess.attackers(mv.to, them)),
    landingDefenders: refs(chess.attackers(mv.to, me)),
    attacks: piecesOf(chess).filter(
      (p) => p.color === them && chess.attackers(p.square, me).includes(mv.to),
    ),
  };
  return { facts, fenAfter: chess.fen() };
}

/** Score of the position after the mover's move, from the mover's POV. */
async function scoreAfter(
  fenAfter: string,
  engine: EvalEngine,
  depth: number,
): Promise<{ score: Score; ev: EngineEval | null }> {
  const c = new Chess(fenAfter);
  if (c.isCheckmate()) return { score: { cp: null, mate: 1 }, ev: null };
  if (c.isStalemate() || c.isDraw()) return { score: { cp: 0, mate: null }, ev: null };
  const ev = await engine.evaluate(fenAfter, depth);
  return { score: flip({ cp: ev.cp, mate: ev.mate }), ev };
}

const stripDecor = (san: string): string => san.replace(/[+#]/g, "");

export async function buildFacts(
  input: CoachInput,
  engine: EvalEngine,
  depth: number = COACH_ENGINE_DEPTH,
): Promise<CoachFacts> {
  let base: Chess;
  try {
    base = new Chess(input.fen);
  } catch {
    throw new CoachInputError("fen is not a valid position");
  }
  const mover = base.turn();

  let best: ReturnType<typeof describeMove>;
  try {
    best = describeMove(input.fen, input.correctMove);
  } catch {
    throw new CoachInputError(`correctMove ${input.correctMove} is not legal in this position`);
  }
  let wrong: ReturnType<typeof describeMove> | null = null;
  if (input.wrongMove) {
    try {
      wrong = describeMove(input.fen, input.wrongMove);
    } catch {
      throw new CoachInputError(`wrongMove ${input.wrongMove} is not legal in this position`);
    }
  }
  const wrongEqualsBest = wrong !== null && stripDecor(wrong.facts.san) === stripDecor(best.facts.san);

  // Evaluation of the position itself (mover to move => already the mover's POV).
  const before = await engine.evaluate(input.fen, depth);
  const evalBefore: Score = { cp: before.cp, mate: before.mate };
  const topSan = uciToSan(input.fen, before.bestMoveUci);

  // The best move's value: if it is the engine's own top move it equals evalBefore.
  let evalAfterBest: Score = evalBefore;
  let bestPvSan = pvToSan(input.fen, before.pvUci);
  if (topSan === null || stripDecor(topSan) !== stripDecor(best.facts.san)) {
    const r = await scoreAfter(best.fenAfter, engine, depth);
    evalAfterBest = r.score;
    bestPvSan = [best.facts.san, ...(r.ev ? pvToSan(best.fenAfter, r.ev.pvUci, 3) : [])];
  }

  let evalAfterWrong: Score | null = null;
  let reply: ReturnType<typeof describeMove> | null = null;
  let refutationPvSan: string[] = [];
  if (wrong && !wrongEqualsBest) {
    const r = await scoreAfter(wrong.fenAfter, engine, depth);
    evalAfterWrong = r.score;
    if (r.ev) {
      const replySan = uciToSan(wrong.fenAfter, r.ev.bestMoveUci);
      if (replySan) reply = describeMove(wrong.fenAfter, replySan);
      refutationPvSan = pvToSan(wrong.fenAfter, r.ev.pvUci, 4);
    }
  }

  let lossPawns: number;
  if (evalAfterWrong) {
    lossPawns = Math.max(0, scoreToPawns(evalAfterBest) - scoreToPawns(evalAfterWrong));
    const bestMates = evalAfterBest.mate !== null && evalAfterBest.mate > 0;
    const wrongMates = evalAfterWrong.mate !== null && evalAfterWrong.mate > 0;
    const bothWinning =
      scoreToPawns(evalAfterBest) >= 1.5 && scoreToPawns(evalAfterWrong) >= 1.5;
    // Keeping a forced win is not a blunder, even if the mate is slower or the win is non-mate.
    if (bothWinning && bestMates && wrongMates) lossPawns = 0;
    else if (bothWinning && bestMates) lossPawns = Math.min(lossPawns, 0.5);
  } else if (wrongEqualsBest) {
    lossPawns = 0;
  } else {
    // Arbitrary "mistake-level" default when the client gives no cpLoss.
    lossPawns = input.cpLoss !== null && input.cpLoss > 0 ? input.cpLoss : 1.0;
  }

  const bestPawns = scoreToPawns(evalAfterBest);
  const afterWrongPawns = evalAfterWrong ? scoreToPawns(evalAfterWrong) : null;
  const severity: Severity = wrongEqualsBest
    ? "equal"
    : severityFor(lossPawns, {
        allowsMate: evalAfterWrong?.mate != null && evalAfterWrong.mate < 0,
        flippedToLost: afterWrongPawns !== null && bestPawns >= 1.5 && afterWrongPawns <= -1.5,
        stalemateThrow: !!wrong?.facts.givesStalemate && bestPawns >= 1.5,
      });

  const positions = [input.fen];
  if (wrong) positions.push(wrong.fenAfter);
  if (reply) positions.push(reply.fenAfter);
  positions.push(best.fenAfter);

  return {
    fen: input.fen,
    mover,
    moverName: mover === "w" ? "White" : "Black",
    wrong: wrong?.facts ?? null,
    best: best.facts,
    reply: reply?.facts ?? null,
    evalBefore,
    evalAfterWrong,
    evalAfterBest,
    lossPawns,
    severity,
    bestPvSan,
    refutationPvSan,
    wrongEqualsBest,
    pieces: piecesOf(base),
    positions,
    engineDepth: depth,
  };
}

export function stepsFromFacts(facts: CoachFacts, captions: CoachCaptions): CoachStepOut[] {
  const steps: CoachStepOut[] = [];
  if (facts.wrong && !facts.wrongEqualsBest) {
    steps.push({
      text: captions.wrong,
      action: { type: "playMove", san: facts.wrong.san, highlight: "red" },
    });
    if (facts.reply && facts.severity !== "equal") {
      steps.push({
        text: captions.reply,
        action: { type: "playMove", san: facts.reply.san, highlight: "red" },
      });
    }
  }
  steps.push({
    text: captions.best,
    action: { type: "playMove", san: facts.best.san, highlight: "green" },
  });
  const squares: string[] = [facts.best.to, ...facts.best.attacks.map((a) => a.square)].slice(0, 4);
  steps.push({ text: captions.why, action: { type: "highlight", squares, color: "blue" } });
  return steps;
}
