import db from "../db";

export interface GamePositionRow {
  fen_before: string;
  san: string;
}

/**
 * Loads `game_positions` rows for many games in a single query, returning a
 * Map keyed by game_id. Replaces the per-game-in-loop SELECT pattern that
 * was causing N+1s on the insights and blunders endpoints.
 *
 * Position arrays are ordered by `id` ASC (i.e. ply order), matching the
 * insertion order used by `saveAnalysis`.
 */
export function batchLoadGamePositions(
  ids: number[],
): Map<number, GamePositionRow[]> {
  const out = new Map<number, GamePositionRow[]>();
  if (ids.length === 0) return out;

  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT game_id, fen_before, san
       FROM game_positions
       WHERE game_id IN (${placeholders})
       ORDER BY game_id, id`,
    )
    .all(...ids) as { game_id: number; fen_before: string; san: string }[];

  for (const row of rows) {
    let arr = out.get(row.game_id);
    if (!arr) {
      arr = [];
      out.set(row.game_id, arr);
    }
    arr.push({ fen_before: row.fen_before, san: row.san });
  }
  return out;
}
