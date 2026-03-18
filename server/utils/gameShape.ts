export type GameShape =
  | 'Wild'
  | 'Giveaway'
  | 'Sudden'
  | 'Sharp'
  | 'Smooth'
  | 'Intense'
  | 'Balanced';

/**
 * Classify a game's "shape" from its eval trajectory.
 * evals: white-perspective centipawns per move (ReviewedMove.eval array)
 * grades: grade per move (same order as evals)
 */
export function classifyGameShape(
  evals: number[],
  grades: string[],
): GameShape {
  if (evals.length < 4) return 'Balanced';

  const totalBlunders = grades.filter(g => g === 'blunder').length;

  // 1. Wild — too many blunders
  if (totalBlunders >= 4) return 'Wild';

  // 2. Giveaway — one side had large advantage then lost
  const finalEval = evals[evals.length - 1];
  const loserWasWhite = finalEval < -100; // white is clearly losing at the end
  const loserWasBlack = finalEval > 100;  // black is clearly losing at the end
  if (loserWasWhite) {
    // White lost — did white ever have >200cp advantage?
    const peakWhiteAdvantage = Math.max(...evals);
    if (peakWhiteAdvantage > 200) return 'Giveaway';
  } else if (loserWasBlack) {
    // Black lost — did black ever have >200cp advantage (negative eval)?
    const peakBlackAdvantage = Math.min(...evals);
    if (peakBlackAdvantage < -200) return 'Giveaway';
  }

  // Count lead changes (eval crossing 0)
  let leadChanges = 0;
  for (let i = 1; i < evals.length; i++) {
    if (Math.sign(evals[i]) !== Math.sign(evals[i - 1]) &&
        Math.sign(evals[i]) !== 0 &&
        Math.sign(evals[i - 1]) !== 0) {
      leadChanges++;
    }
  }

  // Max swing between consecutive moves
  let maxSwing = 0;
  for (let i = 1; i < evals.length; i++) {
    maxSwing = Math.max(maxSwing, Math.abs(evals[i] - evals[i - 1]));
  }

  // Eval standard deviation
  const mean = evals.reduce((s, e) => s + e, 0) / evals.length;
  const variance = evals.reduce((s, e) => s + (e - mean) ** 2, 0) / evals.length;
  const stddev = Math.sqrt(variance);

  // 3. Sudden — one dramatic swing with no back-and-forth
  if (leadChanges <= 1 && maxSwing > 350) return 'Sudden';

  // 4. Sharp — many lead changes (back and forth)
  if (leadChanges >= 3) return 'Sharp';

  // 5. Smooth — one-sided throughout, low variance
  if (leadChanges === 0 && stddev < 80) return 'Smooth';

  // 6. Intense — long strategic fight, close and clean
  if (evals.length >= 35 && stddev < 120 && totalBlunders <= 1) return 'Intense';

  // 7. Default
  return 'Balanced';
}
