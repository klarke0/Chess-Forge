// One-off re-seed: emits SQL to stdout that wipes & re-inserts Jobava London
// positions and chapters from src/data/jobava_full.json. Pipe into sqlite3.
//
//   node scripts/reseed_jobava.cjs | sqlite3 server/chess_trainer.db
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
lines.push(`DELETE FROM positions WHERE repertoire_id = ${repertoireId};`);
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
lines.push("COMMIT;");
process.stderr.write(
  `Reseed: rep=${repertoireId} chapters=${data.chapters.length} main=${nMain} alt=${nAlt}\n`,
);
console.log(lines.join("\n"));
