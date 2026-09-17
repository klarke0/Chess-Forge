// Re-seed: emits SQL to stdout that re-inserts Jobava London positions and
// chapters from src/data/jobava_full.json. Pipe into sqlite3.
//
//   node scripts/reseed_jobava.cjs | sqlite3 server/chess_trainer.db
//
// ============================================================================
// THIS SCRIPT MUST STAY NON-DESTRUCTIVE TO USER STATE.
// ----------------------------------------------------------------------------
// The JSON is the source of truth for the *book*, not for anything the user has
// built on top of it. Two kinds of user state live in these tables and are NOT
// recoverable from jobava_full.json:
//
//   1. positions rows with comment = 'challenge-corrected' — moves the user
//      corrected by hand. They are excluded from the DELETE, and the reseed's
//      INSERT OR IGNORE then skips any (fen, san) they already occupy.
//   2. chapters.learn_runs — the user's learn-phase progress per chapter. It is
//      snapshotted by chapter name before the DELETE and restored afterwards.
//
// If you add another user-owned column or row class to `positions`/`chapters`,
// add it to the preservation logic below before running this again.
// ============================================================================
//
// We assume repertoire id can be looked up by name via a SELECT in the same
// transaction; sqlite3 CLI supports CTE-style scripting so we just emit a
// .parameter approach by hardcoding the id after a probe.

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const dbPath = path.join(__dirname, "..", "server", "chess_trainer.db");
const jsonPath = path.join(__dirname, "..", "src", "data", "jobava_full.json");

const repertoireId = parseInt(
  execSync(
    `sqlite3 "${dbPath}" "SELECT id FROM repertoires WHERE name='Jobava London'"`,
  )
    .toString()
    .trim(),
  10,
);
if (!repertoireId) {
  console.error("Jobava London repertoire not found.");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

const esc = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

const lines = [];
lines.push("BEGIN;");

// Snapshot per-chapter learn progress so it survives the chapter rebuild.
// Chapters are re-created with fresh ids, so the carry-over matches on name.
lines.push(
  `CREATE TEMP TABLE _chapter_runs AS SELECT name, learn_runs FROM chapters WHERE repertoire_id = ${repertoireId};`,
);

// Keep hand-corrected positions. INSERT OR IGNORE below will not overwrite the
// (repertoire_id, fen, san) rows they still occupy.
// depth = -1 marks a challenge-promoted EXISTING book row (its original
// comment is preserved, so the comment filter alone would not spare it).
lines.push(
  `DELETE FROM positions WHERE repertoire_id = ${repertoireId} AND (comment IS NULL OR comment <> 'challenge-corrected') AND depth <> -1;`,
);
lines.push(`DELETE FROM chapters WHERE repertoire_id = ${repertoireId};`);

data.chapters.forEach((ch, i) => {
  lines.push(
    `INSERT INTO chapters (repertoire_id, name, sort_order, start_moves, first_fen) VALUES (${repertoireId}, ${esc(ch.name)}, ${i}, ${esc(JSON.stringify(ch.startMoves))}, ${esc(ch.firstFen)});`,
  );
});

let nMain = 0,
  nAlt = 0;
for (const [fen, moves] of Object.entries(data.positions)) {
  for (const m of moves) {
    lines.push(
      `INSERT OR IGNORE INTO positions (repertoire_id, fen, san, next_fen, comment, is_main_line, depth) VALUES (${repertoireId}, ${esc(fen)}, ${esc(m.san)}, ${esc(m.nextFen)}, ${esc(m.comment ?? null)}, ${m.is_main_line ? 1 : 0}, ${typeof m.depth === "number" ? m.depth : 0});`,
    );
    if (m.is_main_line) nMain++;
    else nAlt++;
  }
}
// Restore learn progress onto the freshly inserted chapters, matched by name.
// Chapters that were renamed or are new simply keep the default 0.
lines.push(
  `UPDATE chapters SET learn_runs = COALESCE((SELECT r.learn_runs FROM _chapter_runs r WHERE r.name = chapters.name), 0) WHERE repertoire_id = ${repertoireId};`,
);
lines.push("DROP TABLE _chapter_runs;");
lines.push("COMMIT;");
process.stderr.write(
  `Reseed: rep=${repertoireId} chapters=${data.chapters.length} main=${nMain} alt=${nAlt}\n`,
);
console.log(lines.join("\n"));
