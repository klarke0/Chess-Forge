import type { Database } from "bun:sqlite";
import database from "../db";
import { normalizeFen } from "../utils/fen";

/**
 * Bump on ANY change to the coach prompt, model, severity thresholds or claim
 * verifier. Rows written under an older version stop matching, which is how
 * stale explanations are "cleared" (see CLAUDE.md: analysis & coach updates).
 */
export const COACH_PROMPT_VERSION = 2;

export interface CoachCacheKey {
  fen: string;
  wrongMove: string | null;
  correctMove: string;
}

export interface CoachCachePayload {
  concept: string;
  analysis: string;
  steps: unknown[] | null;
  source: "model" | "template";
}

const ready = new WeakSet<Database>();

function ensureTable(db: Database): void {
  if (ready.has(db)) return;
  db.query(
    `CREATE TABLE IF NOT EXISTS coach_cache (
       fen_norm TEXT NOT NULL,
       wrong_move TEXT NOT NULL,
       correct_move TEXT NOT NULL,
       prompt_version INTEGER NOT NULL,
       response_json TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       PRIMARY KEY (fen_norm, wrong_move, correct_move, prompt_version)
     )`,
  ).run();
  ready.add(db);
}

function params(key: CoachCacheKey): [string, string, string, number] {
  return [normalizeFen(key.fen), key.wrongMove ?? "", key.correctMove, COACH_PROMPT_VERSION];
}

export function getCachedCoach(
  key: CoachCacheKey,
  db: Database = database,
): CoachCachePayload | null {
  ensureTable(db);
  const row = db
    .query(
      `SELECT response_json FROM coach_cache
       WHERE fen_norm = ? AND wrong_move = ? AND correct_move = ? AND prompt_version = ?`,
    )
    .get(...params(key)) as { response_json: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.response_json) as CoachCachePayload;
  } catch {
    return null;
  }
}

export function putCachedCoach(
  key: CoachCacheKey,
  value: CoachCachePayload,
  db: Database = database,
): void {
  ensureTable(db);
  db.query(
    `INSERT OR REPLACE INTO coach_cache
       (fen_norm, wrong_move, correct_move, prompt_version, response_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(...params(key), JSON.stringify(value));
}
