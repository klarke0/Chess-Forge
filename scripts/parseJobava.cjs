const { Chess } = require("chess.js");
const fs = require("fs");
const path = require("path");

/**
 * Jobava London PGN parser.
 *
 * Canonical source: "Jobava London New Version.pgn" — the revised, superset
 * version of the course. Per-chapter PGNs and "All Lines in One File" are
 * earlier/duplicate exports of the same content; ingesting them all caused
 * collisions where the trainer would pick a sub-variation move as the
 * "correct" answer for a main-line position.
 *
 * For each (fen, san) we record:
 *   - is_main_line: true if EVERY parent move on the path from the chapter
 *     root to this move was on its own variation's main line (stack depth 1
 *     throughout). That is the move the author explicitly recommends.
 *   - depth: the variation depth at which the move was encountered
 *     (0 = chapter mainline, 1 = first sideline, etc.). Lower is more
 *     authoritative.
 *
 * If the same (fen, san) appears multiple times across chapters/branches we
 * keep the BEST classification seen (is_main_line wins; smallest depth wins).
 *
 * VARIATION HANDLING NOTE:
 * chess.js v1+ creates boards from a FEN with NO move history, so calling
 * .undo() on a board created via `new Chess(fen)` is a no-op (returns null).
 * We therefore track `fenBeforeLastMove` explicitly on each stack frame so
 * that when a '(' opens a variation we can restore the board to the position
 * before the last move was played — which is exactly where the variation
 * begins — without needing undo().
 */

const dirPath = path.join(
  __dirname,
  "../bortnyk-and-naroditsky-s-jobava-london/",
);

const CANONICAL = "Jobava London New Version.pgn";

const repertoire = {
  chapters: [],
  positions: {},
};

function normalizeFen(fen) {
  return fen.split(" ").slice(0, 4).join(" ");
}

function upsertMove(normKey, entry) {
  const list = (repertoire.positions[normKey] ||= []);
  const existing = list.find((x) => x.san === entry.san);
  if (!existing) {
    list.push(entry);
    return;
  }
  if (entry.is_main_line && !existing.is_main_line) {
    existing.is_main_line = true;
    existing.depth = Math.min(existing.depth, entry.depth);
  } else if (entry.depth < existing.depth) {
    existing.depth = entry.depth;
  }
  if (entry.comment && !existing.comment) existing.comment = entry.comment;
}

function parseGame(pgnContent, chapterName, gameIndex) {
  const fenMatch = pgnContent.match(/\[FEN "([^"]+)"\]/);
  const startFen = fenMatch
    ? fenMatch[1]
    : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const name = gameIndex > 0 ? `${chapterName} #${gameIndex + 1}` : chapterName;

  const moveText = pgnContent.replace(/\[.*?\]/g, "").trim();
  const tokens = [];
  let current = "";
  let inComment = false;
  for (let i = 0; i < moveText.length; i++) {
    const char = moveText[i];
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

  const cleanTokens = tokens.filter((t) => !/^\d+\.+$/.test(t) && t !== "*");

  // mainSoFar: every ancestor frame was on its main line, AND we never
  // descended into a variation. Once we open a "(", anything inside the
  // resulting frame is, by definition, NOT main line.
  //
  // fenBeforeLastMove: the FEN of the frame's board BEFORE the most recent
  // move was played. When '(' opens a variation, we restore the board to
  // this FEN so the variation starts from the right position. We cannot use
  // chess.undo() because new Chess(fen) creates a board with no history.
  const stack = [{ chess: new Chess(startFen), mainSoFar: true, fenBeforeLastMove: null }];

  let lastFen = null;
  let lastMoveSan = null;
  const mainLineMoves = [];

  for (let i = 0; i < cleanTokens.length; i++) {
    const token = cleanTokens[i];
    const top = stack[stack.length - 1];

    if (token === "(") {
      // A variation opens from the position BEFORE the last move on this frame.
      // If no move has been played yet on this frame, the variation starts from
      // the frame's current position (unusual but safe to handle).
      const variationStartFen = top.fenBeforeLastMove ?? top.chess.fen();
      stack.push({ chess: new Chess(variationStartFen), mainSoFar: false, fenBeforeLastMove: null });
    } else if (token === ")") {
      stack.pop();
      if (stack.length === 0)
        stack.push({ chess: new Chess(startFen), mainSoFar: true, fenBeforeLastMove: null });
      lastFen = stack[stack.length - 1].chess.fen();
    } else if (token.startsWith("{")) {
      const comment = token.slice(1, -1).trim();
      if (lastFen && lastMoveSan) {
        const normKey = normalizeFen(lastFen);
        const moves = repertoire.positions[normKey];
        if (moves) {
          const move = moves.find((m) => m.san === lastMoveSan);
          if (move)
            move.comment = move.comment
              ? move.comment + " " + comment
              : comment;
        }
      }
    } else {
      try {
        const fenBefore = top.chess.fen();
        const normKey = normalizeFen(fenBefore);
        // Strip trailing move-quality glyphs (!,?,!?,?!) and PGN NAG tokens ($14 etc).
        // NAG tokens are either standalone ($14) or appended without a space (Nc3$14).
        // Do NOT strip trailing digits that are part of move notation (Nc3, Qd4, e5).
        // Note: in a JS regex literal, \$ is an end-of-string anchor; use [$] for a
        // literal dollar sign character inside a character class.
        const cleanToken = token
          .replace(/[$]\d+$/, "")   // strip appended NAG like Nc3$14 → Nc3
          .replace(/[!?]+$/, "");   // strip trailing !/?
        if (!cleanToken || /^[$/]/.test(token)) continue; // skip standalone $N tokens
        const move = top.chess.move(cleanToken);
        if (move) {
          const depth = stack.length - 1;
          const isMain = top.mainSoFar;
          upsertMove(normKey, {
            san: move.san,
            nextFen: top.chess.fen(),
            is_main_line: isMain,
            depth,
          });
          if (depth === 0 && isMain) mainLineMoves.push(move.san);
          lastFen = fenBefore;
          lastMoveSan = move.san;
          // Record where we were before this move so that '(' can roll back.
          top.fenBeforeLastMove = fenBefore;
        }
      } catch (e) {
        /* ignore illegal/annotation tokens */
      }
    }
  }

  repertoire.chapters.push({
    name: name.replace(".pgn", ""),
    startMoves: mainLineMoves,
    firstFen: startFen,
  });
}

const filePath = path.join(dirPath, CANONICAL);
let content = fs.readFileSync(filePath, "utf8");
// Strip BOM, normalize line endings.
content = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
const games = content
  .split(/\n\n(?=\[Event)/)
  .filter((g) => g.trim().length > 0);

if (games.length === 0) parseGame(content, CANONICAL, 0);
else games.forEach((g, i) => parseGame(g, CANONICAL, i));

const initialNorm = normalizeFen(
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
);
repertoire.start = repertoire.positions[initialNorm] || [];

fs.writeFileSync(
  path.join(__dirname, "../src/data/jobava_full.json"),
  JSON.stringify(repertoire, null, 2),
);

let total = 0,
  main = 0,
  alt = 0;
const histogram = {};
for (const [, moves] of Object.entries(repertoire.positions)) {
  histogram[moves.length] = (histogram[moves.length] || 0) + 1;
  for (const m of moves) {
    total++;
    if (m.is_main_line) main++;
    else alt++;
  }
}
console.log(
  `Parsed ${repertoire.chapters.length} chapters, ${Object.keys(repertoire.positions).length} unique FENs, ${total} (fen,san) entries.`,
);
console.log(`  main_line=${main}  alt/sideline=${alt}`);
console.log(`  FEN move-count histogram:`, histogram);
