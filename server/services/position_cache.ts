import type { Database } from "bun:sqlite";
import database from "../db";
import { normalizeFen } from "../utils/fen";
import type { EngineEval } from "./engine_native";

/**
 * Persistent engine evaluations keyed by (normalized FEN, depth). Repertoire
 * openings repeat across hundreds of games, so the game-analysis job hits this
 * constantly, and re-grading or re-running a game is nearly free.
 *
 * cp / mate are stored SIDE-TO-MOVE point of view, exactly as the engine
 * returns them — normalizing to White's POV is the caller's job. `depth` is the
 * depth that was REQUESTED; a `movetime`-capped search may have stopped a ply or
 * two short of it.
 */
export interface CachedEval {
  cp: number | null;
  mate: number | null;
  bestMoveUci: string;
  /** The depth of the row that satisfied the request (>= the requested depth). */
  depth: number;
}

export type EvalToCache = Pick<EngineEval, "cp" | "mate" | "bestMoveUci">;

const ready = new WeakSet<Database>();

function ensureTable(db: Database): void {
  if (ready.has(db)) return;
  db.query(
    `CREATE TABLE IF NOT EXISTS position_evals (
       fen_norm TEXT NOT NULL,
       depth INTEGER NOT NULL,
       cp INTEGER,
       mate INTEGER,
       best_uci TEXT,
       PRIMARY KEY (fen_norm, depth)
     )`,
  ).run();
  ready.add(db);
}

/**
 * Deepest cached row with depth >= `depth`, or null. A deeper search is at
 * least as good as the shallower one requested, so it satisfies the request.
 */
export function getCachedEval(
  fen: string,
  depth: number,
  db: Database = database,
): CachedEval | null {
  ensureTable(db);
  const row = db
    .query(
      `SELECT cp, mate, best_uci, depth FROM position_evals
       WHERE fen_norm = ? AND depth >= ?
       ORDER BY depth DESC LIMIT 1`,
    )
    .get(normalizeFen(fen), depth) as
    | { cp: number | null; mate: number | null; best_uci: string | null; depth: number }
    | null;
  if (!row) return null;
  return { cp: row.cp, mate: row.mate, bestMoveUci: row.best_uci ?? "", depth: row.depth };
}

export function putCachedEval(
  fen: string,
  depth: number,
  value: EvalToCache,
  db: Database = database,
): void {
  ensureTable(db);
  db.query(
    `INSERT OR REPLACE INTO position_evals (fen_norm, depth, cp, mate, best_uci)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(normalizeFen(fen), depth, value.cp, value.mate, value.bestMoveUci);
}
