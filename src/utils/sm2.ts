export interface SM2Input {
  easeFactor: number;    // starts 2.5, min 1.3; maps to DB ease_factor
  intervalDays: number;  // maps to DB interval_days
  repetitions: number;   // maps to DB streak (identical reset logic)
}

export interface SM2Output {
  nextEaseFactor: number;
  nextIntervalDays: number;
  nextRepetitions: number;
  nextReviewDate: string; // ISO string
}

/**
 * Canonical SM-2 algorithm.
 * Grade 0-2: reset (interval=0, re-queue in 10 min), EF drops
 * Grade 3-5: advance (rep 0→1day, rep 1→6days, rep 2+→interval*EF), EF adjusts
 * EF formula: EF' = EF + 0.1 - (5-g)*(0.08 + (5-g)*0.02), clamped to 1.3
 */
export function computeSM2(input: SM2Input, grade: number): SM2Output {
  const { easeFactor, intervalDays, repetitions } = input;

  let nextEaseFactor = easeFactor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02);
  nextEaseFactor = Math.max(1.3, nextEaseFactor);

  let nextRepetitions: number;
  let nextIntervalDays: number;

  if (grade < 3) {
    // Failed — reset repetitions and re-queue in 10 minutes
    nextRepetitions = 0;
    nextIntervalDays = 0;
    const nextReviewDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    return { nextEaseFactor, nextIntervalDays, nextRepetitions, nextReviewDate };
  }

  // Passed
  nextRepetitions = repetitions + 1;
  if (repetitions === 0) {
    nextIntervalDays = 1;
  } else if (repetitions === 1) {
    nextIntervalDays = 6;
  } else {
    nextIntervalDays = Math.round(intervalDays * easeFactor);
  }

  const nextReviewDate = new Date(Date.now() + nextIntervalDays * 86400 * 1000).toISOString();
  return { nextEaseFactor, nextIntervalDays, nextRepetitions, nextReviewDate };
}

/**
 * Map training outcome to SM-2 grade (0-5).
 * correct + mistakeCount=0 → 5 (perfect)
 * correct + mistakeCount>=1 → 3 (correct but hesitant)
 * wasGivenUp → 1 (gave up)
 * incorrect → 0 (blackout)
 */
export function gradeFromOutcome(
  correct: boolean,
  mistakeCount: number,
  wasGivenUp: boolean,
): number {
  if (wasGivenUp) return 1;
  if (!correct) return 0;
  if (mistakeCount === 0) return 5;
  return 3;
}
