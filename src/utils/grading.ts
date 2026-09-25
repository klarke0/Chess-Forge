/**
 * Move grading from win-probability loss. Pure — no db / engine imports.
 *
 * MIRRORS `server/utils/grading.ts` (the server grades games in the analysis
 * job; the client grades a live review fallback). The two files must stay in
 * lockstep, like `normalizeFen`; `server/tests/grading_parity.test.ts` fails if
 * they drift. Edit both, or neither.
 *
 * Model: lichess's centipawn -> win% curve. A move's loss is the MOVER's win%
 * before the move minus their win% after it, in percentage points. Grades:
 *
 *   best        loss <= GRADE_BANDS.best, or the played move IS the engine's top move
 *               and loss <= GRADE_BANDS.good (see "top-move guard" below)
 *   excellent   loss <= GRADE_BANDS.excellent
 *   good        loss <= GRADE_BANDS.good
 *   inaccuracy  loss <= GRADE_BANDS.inaccuracy
 *   mistake     loss <= GRADE_BANDS.mistake
 *   blunder     anything worse
 *
 * Top-move guard: "the played move is the engine's top move" comes from the
 * PARENT position's search, while the loss comes from a SEPARATE search of the
 * position after the move. If the top move is followed by a drop bigger than the
 * `good` ceiling (5 pp) the two searches disagree, and the measured loss is the
 * better signal, so the move is graded by the loss bands instead of `best`.
 *
 * The bands are exported constants so they can be tuned; re-grading from stored
 * evals needs no engine.
 */

export type Grade = "best" | "excellent" | "good" | "inaccuracy" | "mistake" | "blunder";

/** Inclusive upper bound, in win-percentage points lost, for each grade above `blunder`. */
export const GRADE_BANDS = {
  best: 0.2,
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
} as const;

/**
 * Centipawn value a forced mate is clamped to in stored evals (White's POV).
 * Matches the browser scan this replaces.
 */
export const MATE_CP = 2000;

const WIN_CURVE_K = 0.00368208;
const CP_CLAMP = 10000;

/**
 * Expected score (0..100) for a side that is `cp` centipawns ahead — lichess's
 * win-chance curve. `cp` is from the point of view of the side whose win% is
 * wanted, clamped to +-10000.
 */
export function winPercent(cp: number): number {
  const c = Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_CURVE_K * c)) - 1);
}

/**
 * Win% (0..100) for the SIDE TO MOVE, from a raw engine score. The engine
 * reports scores from the side to move's point of view, so this is too:
 *   mate > 0  -> the side to move mates                -> 100
 *   mate < 0  -> the side to move gets mated           -> 0
 *   mate = 0  -> the side to move is already mated     -> 0
 * Otherwise `cp` goes through the curve (a missing cp counts as 0). Mate wins
 * over a stray cp. To get the OTHER side's win%, use 100 minus this.
 */
export function winPercentFromScore(score: { cp: number | null; mate: number | null }): number {
  if (score.mate !== null) return score.mate > 0 ? 100 : 0;
  return winPercent(score.cp ?? 0);
}

/**
 * Centipawns the mover gave up. Evals are WHITE's point of view (mate already
 * clamped to +-MATE_CP); a move that improves the mover's position loses 0.
 */
export function computeCpLoss(
  prevEvalWhite: number,
  newEvalWhite: number,
  mover: "w" | "b",
): number {
  return mover === "w"
    ? Math.max(0, prevEvalWhite - newEvalWhite)
    : Math.max(0, newEvalWhite - prevEvalWhite);
}

/**
 * Grade one move. `prevEvalWhite` / `newEvalWhite` are WHITE-POV centipawns for
 * the position before and after the move; `playedIsBest` is whether the played
 * move equals the engine's top move for the position before it.
 * `winLoss` is always the measured win% loss (>= 0), including when
 * `playedIsBest` is what made the grade `best`.
 */
export function gradeMove(args: {
  prevEvalWhite: number;
  newEvalWhite: number;
  mover: "w" | "b";
  playedIsBest: boolean;
}): { grade: Grade; winLoss: number } {
  const { prevEvalWhite, newEvalWhite, mover, playedIsBest } = args;
  const sign = mover === "w" ? 1 : -1;
  const before = winPercent(sign * prevEvalWhite);
  const after = winPercent(sign * newEvalWhite);
  const winLoss = Math.max(0, before - after);

  // Top move counts as best only while the measured drop is within the `good` ceiling.
  const topMoveHolds = playedIsBest && winLoss <= GRADE_BANDS.good;

  let grade: Grade;
  if (topMoveHolds || winLoss <= GRADE_BANDS.best) grade = "best";
  else if (winLoss <= GRADE_BANDS.excellent) grade = "excellent";
  else if (winLoss <= GRADE_BANDS.good) grade = "good";
  else if (winLoss <= GRADE_BANDS.inaccuracy) grade = "inaccuracy";
  else if (winLoss <= GRADE_BANDS.mistake) grade = "mistake";
  else grade = "blunder";
  return { grade, winLoss };
}
