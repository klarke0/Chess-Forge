import db from "../db";

/**
 * POST /api/v2/refresh-analysis
 *
 * Clears analysis_json for games that are missing bestMove data so the
 * background analysis queue re-processes them. Targets the most recent
 * games first (up to 300). Returns the number of games queued.
 */
export async function refreshAnalysis(_req: Request): Promise<Response> {
  try {
    const result = db
      .prepare(
        `UPDATE games
         SET analysis_json = NULL, game_shape = NULL
         WHERE id IN (
           SELECT id FROM games
           WHERE analysis_json IS NOT NULL
             AND analysis_json NOT LIKE '%"bestMove"%'
           ORDER BY date DESC
           LIMIT 300
         )`,
      )
      .run();

    const queued = result.changes ?? 0;
    console.log(`[POST /api/v2/refresh-analysis] Queued ${queued} games for re-analysis`);
    return Response.json({ ok: true, queued });
  } catch (err: any) {
    console.error("[POST /api/v2/refresh-analysis] Error:", err);
    return Response.json({ error: err.message ?? "Server error" }, { status: 500 });
  }
}
