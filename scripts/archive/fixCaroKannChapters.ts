/**
 * Fix Caro-Kann chapter start_moves and first_fen.
 *
 * Each chapter name encodes the line, e.g.:
 *   "Advance Variation: e4 c6 d4 d5 e5 Bf5 Bd3"
 *   "Two Knights - Karpov Line - e4 c6 Nf3 d5 Nc3 dxe4 Nxe4 Nd7"
 *
 * We parse SANs out of the name, play them through chess.js until one
 * fails (typo / annotation stub), then persist the valid prefix as
 * start_moves and first_fen.
 *
 * Usage: bun run scripts/fixCaroKannChapters.ts
 */

import { Database } from "bun:sqlite";
import { Chess } from "chess.js";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const REPERTOIRE_ID = 2;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(scriptDir, "../server/chess_trainer.db");

if (!existsSync(dbFile)) {
  console.error(`DB not found at ${dbFile}`);
  process.exit(1);
}

const db = new Database(dbFile);

/** Strip trailing chess annotation symbols and move numbers from a token. */
function stripAnnotations(token: string): string {
  return token
    .replace(/\d+\.+/g, "")       // "12." "12..."
    .replace(/[!?+#]+$/g, "")      // "!?", "!", "?", "+", "#"
    .trim();
}

/** Return true if a token looks like it could be a SAN move. */
function looksLikeMove(token: string): boolean {
  if (!token) return false;
  // Starts with a piece letter or file letter, no stray punctuation
  return /^[a-hNBRQKO]/.test(token);
}

/**
 * Extract the move-sequence portion from a chapter name.
 * Handles formats:
 *   "Variation Name: e4 c6 d4 ..."
 *   "Variation Name - Subline - e4 c6 ..."
 *   "Variation Name e4 c6 ..."  (no separator)
 */
function extractMovePart(name: string): string {
  // After the last ": " or " - " separator, take everything after
  const colonIdx = name.lastIndexOf(": ");
  const dashIdx = name.lastIndexOf(" - ");

  let movePart: string;
  if (colonIdx > -1 && (dashIdx === -1 || colonIdx > dashIdx)) {
    movePart = name.slice(colonIdx + 2);
  } else if (dashIdx > -1) {
    movePart = name.slice(dashIdx + 3);
  } else {
    movePart = name;
  }

  return movePart.trim();
}

/**
 * Play SAN tokens through chess.js until one fails.
 * Returns the list of successfully played SANs and the resulting FEN.
 */
function parseMoves(tokens: string[]): { moves: string[]; fen: string } {
  const chess = new Chess();
  const moves: string[] = [];

  for (const raw of tokens) {
    const san = stripAnnotations(raw);
    if (!san || !looksLikeMove(san)) continue;

    try {
      const result = chess.move(san);
      if (result) {
        moves.push(result.san);
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  return { moves, fen: chess.fen() };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const chapters = db
  .query("SELECT id, name FROM chapters WHERE repertoire_id = ? ORDER BY sort_order")
  .all(REPERTOIRE_ID) as { id: number; name: string }[];

console.log(`Found ${chapters.length} chapters to process.\n`);

const updateStmt = db.prepare(
  "UPDATE chapters SET start_moves = ?, first_fen = ? WHERE id = ?"
);

const results = { updated: 0, skipped: 0 };
const skipped: string[] = [];

db.transaction(() => {
  for (const chapter of chapters) {
    const movePart = extractMovePart(chapter.name);
    const tokens = movePart.split(/\s+/);
    const { moves, fen } = parseMoves(tokens);

    // Need at least 2 moves (e.g. "e4 c6") to be meaningful
    if (moves.length < 2) {
      skipped.push(`${chapter.id}: "${chapter.name}" → only ${moves.length} valid moves`);
      results.skipped++;
      continue;
    }

    updateStmt.run(JSON.stringify(moves), fen, chapter.id);
    results.updated++;

    const fenShort = fen.split(" ").slice(0, 4).join(" ");
    console.log(`✓ [${chapter.id}] ${moves.join(" ")}`);
    console.log(`       FEN: ${fenShort}\n`);
  }
})();

console.log(`\n── Summary ─────────────────────────────────────`);
console.log(`   Updated : ${results.updated}`);
console.log(`   Skipped : ${results.skipped}`);

if (skipped.length > 0) {
  console.log(`\nSkipped chapters:`);
  skipped.forEach((s) => console.log("  -", s));
}

db.close();
console.log("\nDone.");
