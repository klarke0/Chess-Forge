import { createHash } from "crypto";
import db from "../db";
import { normalizeFen } from "./fen";

export interface LineMove {
  fen: string;
  san: string;
  comment: string | null;
  isKevinMove: boolean;
}

export interface BookLine {
  lineKey: string;
  chapterId: number | null;
  chapterName: string | null;
  moves: LineMove[];
  kevinMoveCount: number;
  quarantined: boolean;
}

const START_FEN_4 = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

function ensureFullFen(fen: string): string {
  return fen.split(" ").length >= 6 ? fen : `${fen} 0 1`;
}

/**
 * Enumerate root->leaf lines through the positions tree.
 * CRITICAL: positions.fen is 4-field; positions.next_fen is 6-field. Links
 * resolve via normalizeFen(next_fen). Transposition-safe via a per-path
 * visited set; total output capped by maxLines.
 */
export function enumerateLines(repertoireId: number, maxLines = 500): BookLine[] {
  const side = (
    db.query("SELECT side FROM repertoires WHERE id = ?").get(repertoireId) as
      | { side: string }
      | null
  )?.side ?? "white";
  const kevinColor = side === "white" ? "w" : "b";

  const rows = db
    .query(
      "SELECT fen, san, next_fen, comment FROM positions WHERE repertoire_id = ? ORDER BY is_main_line DESC, depth ASC, san ASC",
    )
    .all(repertoireId) as { fen: string; san: string; next_fen: string; comment: string | null }[];

  const byFen = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = normalizeFen(r.fen);
    if (!byFen.has(key)) byFen.set(key, []);
    byFen.get(key)!.push(r);
  }

  const flagged = new Set(
    (
      db
        .query(
          "SELECT fen, san FROM book_audit WHERE repertoire_id = ? AND verdict = 'flagged'",
        )
        .all(repertoireId) as { fen: string; san: string }[]
    ).map((r) => `${normalizeFen(r.fen)}|${r.san}`),
  );

  const chapters = db
    .query(
      "SELECT id, name, first_fen FROM chapters WHERE repertoire_id = ? ORDER BY sort_order",
    )
    .all(repertoireId) as { id: number; name: string; first_fen: string }[];
  const chapterByFen = new Map(
    chapters.map((c) => [normalizeFen(c.first_fen), c]),
  );

  const out: BookLine[] = [];
  const walk = (
    fenKey: string,
    path: LineMove[],
    visited: Set<string>,
    chapter: { id: number; name: string } | null,
    hasFlagged: boolean,
  ) => {
    if (out.length >= maxLines) return;
    const moves = byFen.get(fenKey);
    const chapterHere = chapterByFen.get(fenKey);
    const chap = chapterHere ? { id: chapterHere.id, name: chapterHere.name } : chapter;
    if (!moves || moves.length === 0) {
      if (path.length >= 2) {
        const sans = path.map((m) => m.san).join(" ");
        out.push({
          lineKey: createHash("sha256").update(sans).digest("hex").slice(0, 16),
          chapterId: chap?.id ?? null,
          chapterName: chap?.name ?? null,
          moves: path,
          kevinMoveCount: path.filter((m) => m.isKevinMove).length,
          quarantined: hasFlagged,
        });
      }
      return;
    }
    for (const mv of moves) {
      const nextKey = normalizeFen(mv.next_fen);
      if (visited.has(nextKey)) continue; // cycle guard
      const sideToMove = fenKey.split(" ")[1];
      const isKevin = sideToMove === kevinColor;
      const move: LineMove = {
        fen: ensureFullFen(mv.fen),
        san: mv.san,
        comment: mv.comment,
        isKevinMove: isKevin,
      };
      const flaggedHere = isKevin && flagged.has(`${fenKey}|${mv.san}`);
      walk(
        nextKey,
        [...path, move],
        new Set(visited).add(nextKey),
        chap,
        hasFlagged || flaggedHere,
      );
      if (out.length >= maxLines) return;
    }
  };

  const roots = new Set<string>([normalizeFen(START_FEN_4)]);
  for (const c of chapters) roots.add(normalizeFen(c.first_fen));
  // Only walk roots that actually have moves and are not mid-tree duplicates of
  // the start walk: start position first, then chapter roots not reachable
  // from it (disconnected chapter subtrees).
  const startKey = normalizeFen(START_FEN_4);
  walk(startKey, [], new Set([startKey]), null, false);
  const coveredFens = new Set(out.flatMap((l) => l.moves.map((m) => normalizeFen(m.fen))));
  for (const c of chapters) {
    const key = normalizeFen(c.first_fen);
    if (key !== startKey && !coveredFens.has(key) && byFen.has(key)) {
      walk(key, [], new Set([key]), { id: c.id, name: c.name }, false);
    }
  }
  return out;
}

/** Placement (board-only) occurrence counts from Kevin's real games + deviations. */
export function buildPlacementCounts(repertoireId: number): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (fen: string | null) => {
    if (!fen) return;
    const placement = fen.split(" ")[0];
    counts.set(placement, (counts.get(placement) ?? 0) + 1);
  };
  const gp = db
    .query("SELECT fen_before FROM game_positions")
    .all() as { fen_before: string | null }[];
  for (const r of gp) bump(r.fen_before);
  const devs = db
    .query("SELECT fen FROM deviations WHERE repertoire_id = ?")
    .all(repertoireId) as { fen: string }[];
  for (const r of devs) bump(r.fen);
  return counts;
}

/** Sum of placement hits over the line's first 12 positions (opening-weighted). */
export function frequencyScore(
  line: BookLine,
  placementCounts: Map<string, number>,
): number {
  let score = 0;
  for (const m of line.moves.slice(0, 12)) {
    score += placementCounts.get(m.fen.split(" ")[0]) ?? 0;
  }
  return score;
}
