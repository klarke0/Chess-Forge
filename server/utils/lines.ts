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
      "SELECT id, name, first_fen, start_moves FROM chapters WHERE repertoire_id = ? ORDER BY sort_order",
    )
    .all(repertoireId) as { id: number; name: string; first_fen: string; start_moves: string }[];

  // Chapter identity lives in start_moves (a JSON array of SANs from the game
  // start), NOT first_fen — in production every chapter row shares the same
  // first_fen (the starting position). A line belongs to the chapter whose
  // start_moves is a prefix of its SAN sequence; longest match wins.
  const chapterMoves: { id: number; name: string; moves: string[] }[] = chapters
    .map((c) => {
      let moves: string[] = [];
      try {
        const parsed = JSON.parse(c.start_moves);
        if (Array.isArray(parsed)) moves = parsed as string[];
      } catch {
        moves = [];
      }
      return { id: c.id, name: c.name, moves };
    })
    .sort((a, b) => b.moves.length - a.moves.length);

  const matchChapterByPrefix = (sans: string[]): { id: number; name: string } | null => {
    for (const c of chapterMoves) {
      if (c.moves.length === 0 || c.moves.length > sans.length) continue;
      let match = true;
      for (let i = 0; i < c.moves.length; i++) {
        if (c.moves[i] !== sans[i]) {
          match = false;
          break;
        }
      }
      if (match) return { id: c.id, name: c.name };
    }
    return null;
  };

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
    if (!moves || moves.length === 0) {
      if (path.length >= 2) {
        const sanList = path.map((m) => m.san);
        const sans = sanList.join(" ");
        // Fixed roots (disconnected chapter subtrees, second pass) keep the
        // walk-root chapter; the main walk (from the start position) resolves
        // by longest start_moves prefix match.
        const chap = chapter ?? matchChapterByPrefix(sanList);
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
        chapter,
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
      const before = out.length;
      walk(key, [], new Set([key]), { id: c.id, name: c.name }, false);
      // Fold this root's newly-walked lines into coveredFens before the next
      // root check, so overlapping disconnected subtrees don't get re-walked
      // (and duplicated) by a later chapter's root check.
      for (let i = before; i < out.length; i++) {
        for (const m of out[i].moves) coveredFens.add(normalizeFen(m.fen));
      }
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
