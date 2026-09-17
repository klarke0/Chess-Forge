/**
 * Import Caro-Kann repertoire from Lichess study BR22mPv3
 * ("Caro-Kann - Interactive Lesson - Complete Repertoire" by Shreksify, 60 chapters)
 *
 * Usage: bun run scripts/importCaroKann.ts
 */

import { Database } from "bun:sqlite";
import { Chess } from "chess.js";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const PGN_URL = "https://lichess.org/api/study/BR22mPv3.pgn";
const REPERTOIRE_ID = 2;
const STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// ─── PGN parser ──────────────────────────────────────────────────────────────

interface ParsedMove {
  san: string;
  fenBefore: string;
  fenAfter: string;
  comment?: string;
  variations: ParsedMove[][];
}

interface ParsedGame {
  headers: Record<string, string>;
  moves: ParsedMove[];
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "{") {
      if (current) tokens.push(current);
      current = "{";
      inComment = true;
    } else if (char === "}") {
      current += "}";
      tokens.push(current);
      current = "";
      inComment = false;
    } else if (inComment) {
      current += char;
    } else if (char === "(" || char === ")") {
      if (current) tokens.push(current);
      tokens.push(char);
      current = "";
    } else if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens.filter(
    (t) => !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t),
  );
}

function parseRecursive(
  tokens: string[],
  chess: Chess,
): { moves: ParsedMove[]; remaining: string[] } {
  const moves: ParsedMove[] = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token === "(") {
      const varStartFen =
        moves.length > 0 ? moves[moves.length - 1].fenBefore : chess.fen();
      const varChess = new Chess(varStartFen);
      const { moves: variation, remaining } = parseRecursive(
        tokens.slice(i + 1),
        varChess,
      );
      if (moves.length > 0) moves[moves.length - 1].variations.push(variation);
      tokens = remaining;
      i = 0;
      continue;
    }

    if (token === ")") {
      return { moves, remaining: tokens.slice(i + 1) };
    }

    if (token.startsWith("{")) {
      if (moves.length > 0)
        moves[moves.length - 1].comment = token.slice(1, -1).trim();
      i++;
      continue;
    }

    if (token.startsWith("$")) {
      i++;
      continue;
    }

    try {
      const fenBefore = chess.fen();
      const cleanToken = token.replace(/[!?]+$/, "");
      const m = chess.move(cleanToken);
      if (m) {
        moves.push({
          san: m.san,
          fenBefore,
          fenAfter: chess.fen(),
          variations: [],
        });
      }
    } catch {
      // skip unrecognised tokens
    }
    i++;
  }

  return { moves, remaining: [] };
}

function parseGame(gameText: string): ParsedGame {
  const headers: Record<string, string> = {};
  // Use matchAll to avoid .exec() pattern
  for (const m of gameText.matchAll(/\[(\w+)\s+"(.*?)"\]/g)) {
    headers[m[1]] = m[2];
  }

  const setupFen = headers["FEN"] ?? STANDARD_FEN;
  const chess = new Chess(setupFen);
  const moveText = gameText.replace(/\[.*?\]/gs, "").trim();
  const tokens = tokenize(moveText);
  const { moves } = parseRecursive(tokens, chess);
  return { headers, moves };
}

function parsePgn(pgn: string): ParsedGame[] {
  return pgn
    .split(/\n\n(?=\[Event)/)
    .map(parseGame)
    .filter((g) => g.moves.length > 0);
}

// ─── Position tree builder ───────────────────────────────────────────────────

type MoveEntry = {
  san: string;
  nextFen: string;
  comment?: string;
  /** True when every ancestor was on the PGN trunk (outside all parentheses). */
  isMainLine: boolean;
  /** Parenthesis nesting depth where the move was first seen. Lower = more authoritative. */
  depth: number;
};
type PositionMap = Map<string, Map<string, MoveEntry>>;

/**
 * `isMainLine`/`depth` must be written, not left at their column defaults: the
 * drill builder resolves several book replies at one FEN with
 * `ORDER BY is_main_line DESC, depth ASC, san ASC`, so leaving both at 0 makes
 * the answer alphabetical. If the same (fen, san) shows up on several branches
 * we keep the best classification seen.
 */
function walkMoves(
  moves: ParsedMove[],
  positions: PositionMap,
  trunk = true,
  depth = 0,
) {
  for (const move of moves) {
    let fenMap = positions.get(move.fenBefore);
    if (!fenMap) {
      fenMap = new Map();
      positions.set(move.fenBefore, fenMap);
    }
    const existing = fenMap.get(move.san);
    if (!existing) {
      fenMap.set(move.san, {
        san: move.san,
        nextFen: move.fenAfter,
        ...(move.comment ? { comment: move.comment } : {}),
        isMainLine: trunk,
        depth,
      });
    } else {
      existing.isMainLine = existing.isMainLine || trunk;
      existing.depth = Math.min(existing.depth, depth);
    }
    for (const variation of move.variations) {
      walkMoves(variation, positions, false, depth + 1);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(scriptDir, "../server/chess_trainer.db");

if (!existsSync(dbFile)) {
  console.error(`DB not found at ${dbFile}`);
  process.exit(1);
}

const db = new Database(dbFile);

console.log(`Fetching ${PGN_URL} ...`);
const res = await fetch(PGN_URL);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const pgn = await res.text();
console.log(`Downloaded ${pgn.length} bytes`);

const games = parsePgn(pgn);
console.log(`Parsed ${games.length} chapters`);

const positionMap: PositionMap = new Map();
const chapterNames: string[] = [];

for (const game of games) {
  const name =
    game.headers["ChapterName"] || game.headers["White"] || "Chapter";
  chapterNames.push(name);
  walkMoves(game.moves, positionMap);
}

let totalMoves = 0;
for (const fenMap of positionMap.values()) totalMoves += fenMap.size;
console.log(
  `Position tree: ${positionMap.size} unique FENs, ${totalMoves} move entries`,
);

db.transaction(() => {
  db.prepare("DELETE FROM positions WHERE repertoire_id = ?").run(
    REPERTOIRE_ID,
  );
  db.prepare("DELETE FROM chapters WHERE repertoire_id = ?").run(REPERTOIRE_ID);

  const insertChapter = db.prepare(
    "INSERT INTO chapters (repertoire_id, name, sort_order, start_moves, first_fen) VALUES (?, ?, ?, ?, ?)",
  );
  for (let i = 0; i < chapterNames.length; i++) {
    insertChapter.run(
      REPERTOIRE_ID,
      chapterNames[i],
      i,
      JSON.stringify(["e4"]),
      STANDARD_FEN,
    );
  }

  const insertPos = db.prepare(
    "INSERT OR IGNORE INTO positions (repertoire_id, fen, san, next_fen, comment, is_main_line, depth) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  let inserted = 0;
  for (const [fen, fenMap] of positionMap) {
    for (const move of fenMap.values()) {
      insertPos.run(
        REPERTOIRE_ID,
        fen,
        move.san,
        move.nextFen,
        move.comment ?? null,
        move.isMainLine ? 1 : 0,
        move.depth,
      );
      inserted++;
    }
  }

  console.log(
    `✓ ${chapterNames.length} chapters, ${inserted} positions → repertoire_id=${REPERTOIRE_ID}`,
  );
})();

db.close();
console.log("Done.");
