/**
 * Shape of a single per-move analysis row produced by
 * `services/background_analysis.ts` and persisted as `games.analysis_json`.
 *
 * Adding a new field? Update `parseAnalysisJson`'s validator and update the
 * `NOT LIKE '%<field>%'` filter in `server/routes/v2_refresh_analysis.ts`
 * so old rows missing the field are re-queued for analysis (see CLAUDE.md
 * "Analysis & coach updates — clear stale outputs").
 */
export interface AnalysisMove {
  san: string;
  fen: string;
  eval: number;
  cpLoss: number;
  grade: "best" | "good" | "inaccuracy" | "mistake" | "blunder" | string;
  /** UCI engine bestMove. Missing on games analyzed before March 2026. */
  bestMove?: string;
}

/**
 * Parse `games.analysis_json` defensively. Returns `null` on invalid JSON or
 * a non-array shape so callers can `continue` past corrupt rows; logs a
 * warning so schema drift surfaces in the console rather than silently
 * skipping games.
 */
export function parseAnalysisJson(
  json: string | null | undefined,
  gameId?: number,
): AnalysisMove[] | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    console.warn(
      `[parseAnalysisJson] Invalid JSON${gameId ? ` for game ${gameId}` : ""}:`,
      err,
    );
    return null;
  }
  if (!Array.isArray(parsed)) {
    console.warn(
      `[parseAnalysisJson] Expected array${gameId ? ` for game ${gameId}` : ""}, got ${typeof parsed}`,
    );
    return null;
  }
  return parsed as AnalysisMove[];
}
