/**
 * Backfill `positions.is_main_line` (and `positions.depth`) from the source PGNs.
 *
 * WHY: the drill builder picks the displayed answer for a FEN with
 *   ORDER BY is_main_line DESC, depth ASC, san ASC
 * If is_main_line and depth are never populated the sort collapses to `san ASC`
 * — alphabetical — so a position with several legal book replies gets an
 * arbitrary "expected" move.
 *
 * MAIN LINE = the move sequence outside parentheses (PGN trunk). A move is
 * flagged when every ancestor on the path from the game root was itself on the
 * trunk. `depth` is the parenthesis nesting level where the move was first seen
 * (0 = trunk, 1 = first sideline, ...). Lower is more authoritative.
 *
 * The tokenizer mirrors `scripts/parseJobava.cjs` (same variation handling:
 * chess.js boards built from a FEN have no history, so `.undo()` is a no-op and
 * we track `fenBeforeLastMove` per stack frame instead). Verified against
 * python-chess on the Jobava source: identical (fen, san) sets and identical
 * trunk classification.
 *
 * Usage:
 *   node scripts/backfill_main_line.cjs            # dry run, prints what would change
 *   node scripts/backfill_main_line.cjs --apply    # writes to server/chess_trainer.db
 *
 * Back up server/chess_trainer.db before running with --apply.
 */
const { Chess } = require("chess.js");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DB = path.join(ROOT, "server", "chess_trainer.db");
const APPLY = process.argv.includes("--apply");

/**
 * repertoire id → PGN sources.
 *
 * `primary` files are the authoritative version of the repertoire: their trunk
 * is flagged unconditionally.
 *
 * `secondary` files are older or partial exports of the same course. Their
 * trunk is real evidence — each per-variation file's main line is the author's
 * recommendation for that branch — but it must never override the primary file,
 * so a secondary flag is skipped at any FEN where another stored move is
 * already main line or sits at a strictly shallower depth. Without that guard a
 * deep sideline from an old export can outrank the current recommendation and
 * make the displayed "expected" move confidently wrong.
 */
const JOBAVA_DIR = path.join(ROOT, "bortnyk-and-naroditsky-s-jobava-london");
const JOBAVA_PRIMARY = "Jobava London New Version.pgn";
const SOURCES = {
  3: {
    primary: [path.join(JOBAVA_DIR, JOBAVA_PRIMARY)],
    // "All Lines in One File", the per-variation files (3...c6, 3...e6, ...),
    // "Rare 3rd Moves" and "Typical Ideas for White". Every (fen, san) they
    // contain is already present in the primary file — verified — so they add
    // classification only, never new positions.
    secondary: fs
      .readdirSync(JOBAVA_DIR)
      .filter((f) => f.endsWith(".pgn") && f !== JOBAVA_PRIMARY)
      .map((f) => path.join(JOBAVA_DIR, f)),
  },
  2: {
    primary: [
      ...fs
        .readdirSync(ROOT)
        .filter((f) => /^caro_kann_chapter_.*\.pgn$/.test(f))
        .map((f) => path.join(ROOT, f)),
      path.join(ROOT, "src", "data", "caro_kann.pgn"),
      // Optional: a local copy of the Lichess study the repertoire was imported
      // from (https://lichess.org/api/study/BR22mPv3.pgn). Skipped when absent.
      path.join(ROOT, "caro_kann_study.pgn"),
    ],
    secondary: [],
  },
};

const normalizeFen = (fen) => fen.split(" ").slice(0, 4).join(" ");

function sql(query) {
  return execFileSync("sqlite3", [DB, query], { encoding: "utf-8", maxBuffer: 1 << 28 });
}

/** Tokenize one PGN game body into move / comment / paren tokens. */
function tokenize(moveText) {
  const tokens = [];
  let current = "";
  let inComment = false;
  for (const char of moveText) {
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
  return tokens.filter((t) => !/^\d+\.+$/.test(t) && t !== "*");
}

/**
 * Walk one game, recording the best classification seen for each (fen, san):
 * trunk wins over sideline, and the shallowest depth wins.
 */
function walkGame(pgnContent, out) {
  const fenMatch = pgnContent.match(/\[FEN "([^"]+)"\]/);
  const startFen = fenMatch
    ? fenMatch[1]
    : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const tokens = tokenize(pgnContent.replace(/\[.*?\]/g, "").trim());
  const stack = [{ chess: new Chess(startFen), trunk: true, fenBeforeLastMove: null }];

  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token === "(") {
      const from = top.fenBeforeLastMove ?? top.chess.fen();
      stack.push({ chess: new Chess(from), trunk: false, fenBeforeLastMove: null });
    } else if (token === ")") {
      stack.pop();
      // Tolerate the unbalanced ')' present in a couple of the hand-edited
      // Caro-Kann chapter files rather than aborting the whole game.
      if (stack.length === 0)
        stack.push({ chess: new Chess(startFen), trunk: true, fenBeforeLastMove: null });
    } else if (token.startsWith("{")) {
      // comment — no classification effect
    } else {
      const clean = token.replace(/[$]\d+$/, "").replace(/[!?]+$/, "");
      if (!clean || /^[$/]/.test(token)) continue;
      try {
        const fenBefore = top.chess.fen();
        const move = top.chess.move(clean);
        if (!move) continue;
        const key = `${normalizeFen(fenBefore)}|${move.san}`;
        const depth = stack.length - 1;
        const prev = out.get(key);
        if (!prev) out.set(key, { trunk: top.trunk, depth });
        else {
          prev.trunk = prev.trunk || top.trunk;
          prev.depth = Math.min(prev.depth, depth);
        }
        top.fenBeforeLastMove = fenBefore;
      } catch {
        /* illegal token / annotation — skip */
      }
    }
  }
}

function classifyFiles(files) {
  const out = new Map();
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.log(`  (skip, not present) ${path.basename(file)}`);
      continue;
    }
    const content = fs
      .readFileSync(file, "utf8")
      .replace(/^﻿/, "")
      .replace(/\r\n/g, "\n");
    const games = content.split(/\n\n(?=\[Event)/).filter((g) => g.trim());
    (games.length ? games : [content]).forEach((g) => walkGame(g, out));
    console.log(`  ${path.basename(file)}: ${games.length || 1} game(s)`);
  }
  return out;
}

function main() {
let grandTotal = 0;
for (const [repId, src] of Object.entries(SOURCES)) {
  console.log(`\n=== repertoire ${repId} ===`);
  const primary = classifyFiles(src.primary);
  const secondary = src.secondary.length ? classifyFiles(src.secondary) : new Map();
  console.log(
    `  primary: ${primary.size} (fen,san) pairs, ${[...primary.values()].filter((v) => v.trunk).length} on the main line`,
  );
  if (src.secondary.length)
    console.log(
      `  secondary: ${secondary.size} pairs, ${[...secondary.values()].filter((v) => v.trunk).length} on their own file's main line`,
    );

  const rows = sql(
    `SELECT id || '|' || fen || '|' || san || '|' || is_main_line || '|' || depth FROM positions WHERE repertoire_id = ${repId};`,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, fen, san, isMain, depth] = line.split("|");
      return { id: Number(id), fen, san, isMain: Number(isMain), depth: Number(depth) };
    });

  const byFen = new Map();
  for (const r of rows) {
    const key = normalizeFen(r.fen);
    if (!byFen.has(key)) byFen.set(key, []);
    byFen.get(key).push(r);
  }

  const setMain = [];
  const setDepth = [];
  let matched = 0;
  let secondaryFlagged = 0;
  let secondarySkipped = 0;
  for (const r of rows) {
    const key = `${normalizeFen(r.fen)}|${r.san}`;
    const info = primary.get(key);
    if (info) {
      matched++;
      if (info.trunk && r.isMain !== 1) setMain.push(r.id);
      if (info.depth !== r.depth) setDepth.push([r.id, info.depth]);
      if (info.trunk) continue; // primary already had its say
    }

    // Secondary evidence: flag only when it cannot demote a better-ranked move.
    const sec = secondary.get(key);
    if (!sec || !sec.trunk || r.isMain === 1) continue;
    const siblings = byFen.get(normalizeFen(r.fen)) ?? [r];
    const wouldOverride = siblings.some(
      (s) => s.id !== r.id && (s.isMain === 1 || s.depth < r.depth),
    );
    if (wouldOverride) {
      secondarySkipped++;
      continue;
    }
    if (!setMain.includes(r.id)) {
      setMain.push(r.id);
      secondaryFlagged++;
    }
  }
  console.log(
    `  db rows ${rows.length}, matched by primary PGN ${matched}, is_main_line to set ${setMain.length}` +
      `${src.secondary.length ? ` (${secondaryFlagged} from secondary files, ${secondarySkipped} secondary flags skipped as unsafe)` : ""}` +
      `, depth to correct ${setDepth.length}`,
  );
  grandTotal += setMain.length;

  if (APPLY && (setMain.length || setDepth.length)) {
    const stmts = ["BEGIN;"];
    for (let i = 0; i < setMain.length; i += 500)
      stmts.push(
        `UPDATE positions SET is_main_line = 1 WHERE id IN (${setMain.slice(i, i + 500).join(",")});`,
      );
    for (const [id, d] of setDepth)
      stmts.push(`UPDATE positions SET depth = ${d} WHERE id = ${id};`);
    stmts.push("COMMIT;");
    sql(stmts.join("\n"));
    console.log(`  applied.`);
  }
}

console.log(
  `\n${APPLY ? "Applied" : "Dry run"} — ${grandTotal} rows flagged as main line.` +
    (APPLY ? "" : " Re-run with --apply to write."),
);
}

if (require.main === module) main();

module.exports = { classifyFiles, normalizeFen, SOURCES, sql };
