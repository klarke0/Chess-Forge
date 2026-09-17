/**
 * Book-move lookup helpers for drill grading.
 *
 * A single FEN can be reached by several move orders and legitimately have
 * more than one correct book reply stored in `positions`. The drill builder
 * still picks ONE canonical move to display as the expected answer, but every
 * stored reply for that (repertoire, fen) must be graded as correct — otherwise
 * playing the move that belongs to the line you are actually drilling gets
 * marked wrong.
 */
import { Chess } from "chess.js";
import db from "../db";
import { normalizeFen } from "./fen";

/** chess.js needs a 6-field FEN; `positions.fen` is stored normalized (4 fields). */
function toFullFen(fen: string): string {
  const parts = fen.split(" ");
  if (parts.length >= 6) return fen;
  return [...parts, "0", "1"].slice(0, 6).join(" ");
}

/**
 * Every stored book reply for this position, canonical move first
 * (main-line, then shallowest, then alphabetical — the same ordering the
 * drill builder uses to choose the displayed answer).
 */
export function bookMovesFor(repertoireId: number, fen: string): string[] {
  const rows = db
    .query(
      "SELECT san FROM positions WHERE repertoire_id = ? AND fen = ? ORDER BY is_main_line DESC, depth ASC, san ASC",
    )
    .all(repertoireId, normalizeFen(fen)) as { san: string }[];
  return rows.map((r) => r.san).filter((s) => !!s && s.trim().length > 0);
}

/**
 * The full set of answers to accept for a drill position: the displayed
 * `correctSan` plus every other stored book reply, filtered to moves that are
 * actually legal from this FEN. `correctSan` is always first.
 */
export function acceptableSansFor(
  repertoireId: number,
  fen: string,
  correctSan: string,
): string[] {
  const candidates = [correctSan, ...bookMovesFor(repertoireId, fen)].filter(
    (s) => !!s && s.trim().length > 0,
  );

  const out: string[] = [];
  const seen = new Set<string>();
  const full = toFullFen(fen);
  for (const san of candidates) {
    if (seen.has(san)) continue;
    seen.add(san);
    try {
      const board = new Chess(full);
      if (board.move(san)) out.push(san);
    } catch {
      // Illegal from this position (stale row / different move order) — drop it.
    }
  }
  return out.length > 0 ? out : [correctSan];
}

/**
 * Populate `acceptableSans` on every position in a built session. Positions
 * outside the repertoire (engine `bestMove` answers) end up with just their
 * own `correctSan`, which preserves the previous single-answer behaviour.
 */
export function attachAcceptableSans<
  T extends { fen: string; correctSan: string; acceptableSans?: string[] },
>(repertoireId: number, positions: T[]): T[] {
  for (const p of positions) {
    p.acceptableSans = acceptableSansFor(repertoireId, p.fen, p.correctSan);
  }
  return positions;
}
