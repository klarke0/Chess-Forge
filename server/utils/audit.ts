import type { EngineEval } from "../services/engine_native";

/** Clamp mate scores onto a large cp scale so mate-vs-cp losses compare sanely. */
const MATE_CP = 1000;

function toCp(e: EngineEval): number {
  if (e.mate !== null) return e.mate > 0 ? MATE_CP : -MATE_CP;
  return e.cp ?? 0;
}

/**
 * Loss for the mover: eval of best play minus the eval actually obtained.
 * `afterPlayed` was evaluated from the OPPONENT's side, so negate it.
 */
export function lossCp(best: EngineEval, afterPlayed: EngineEval): number {
  const obtained = -toCp(afterPlayed);
  return Math.max(0, toCp(best) - obtained);
}

export type Verdict = "ok" | "gray" | "flagged";

export function engineVerdict(loss: number): Verdict {
  if (loss < 75) return "ok";
  if (loss < 150) return "gray";
  return "flagged";
}

export function mastersVerdict(
  moveGames: number,
  totalGames: number,
): "ok_masters" | "flagged" {
  if (moveGames >= 10) return "ok_masters";
  if (totalGames > 0 && moveGames / totalGames >= 0.05) return "ok_masters";
  return "flagged";
}
