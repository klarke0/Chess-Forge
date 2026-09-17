/**
 * Server-side SM-2 spaced repetition algorithm.
 * Mirrors src/utils/sm2.ts for use in backend progress recording.
 */

export interface SM2Input {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

export interface SM2Output {
  nextEaseFactor: number;
  nextIntervalDays: number;
  nextRepetitions: number;
  nextReviewDate: string;
}

/**
 * Canonical SM-2 algorithm.
 * Grade 0-2: reset (interval=0, re-queue in 10 min), EF drops
 * Grade 3-5: advance (rep 0->1day, rep 1->6days, rep 2+->interval*EF), EF adjusts
 */
export function computeSM2(input: SM2Input, grade: number): SM2Output {
  const easeFactor = Number.isFinite(input.easeFactor) ? input.easeFactor : 2.5;
  const intervalDays = Number.isFinite(input.intervalDays) ? input.intervalDays : 0;
  const repetitions = Number.isInteger(input.repetitions) ? input.repetitions : 0;

  let nextEaseFactor =
    easeFactor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02);
  nextEaseFactor = Math.max(1.3, Math.min(2.5, nextEaseFactor));

  if (grade < 3) {
    return {
      nextEaseFactor,
      nextIntervalDays: 0,
      nextRepetitions: 0,
      nextReviewDate: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  const nextRepetitions = repetitions + 1;
  let nextIntervalDays: number;
  if (repetitions === 0) {
    nextIntervalDays = 1;
  } else if (repetitions === 1) {
    nextIntervalDays = 6;
  } else {
    nextIntervalDays = Math.round(intervalDays * easeFactor);
  }
  // Cap at 30 days. Higher caps starve the drill pool: with ~75 progress rows
  // and 12 positions/session, a 180-day cap meant correct positions vanished
  // for 6 months and the same handful of failures cycled forever.
  // See CLAUDE.md "Drill pool freshness" before raising this.
  nextIntervalDays = Math.min(30, nextIntervalDays);

  const nextReviewDate = new Date(
    Date.now() + nextIntervalDays * 86400 * 1000,
  ).toISOString();
  return { nextEaseFactor, nextIntervalDays, nextRepetitions, nextReviewDate };
}
