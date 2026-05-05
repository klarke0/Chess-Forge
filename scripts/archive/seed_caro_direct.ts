import { Database } from "bun:sqlite";
import fs from 'fs';
import path from 'path';
import { PgnParser } from '../src/services/pgn_parser';
import { RepertoireBuilder } from '../src/services/repertoire_builder';

const db = new Database("server/chess_trainer.db");
const PGN_PATH = path.join(process.cwd(), "src/data/caro_kann.pgn");

console.log("Seeding Caro-Kann (Direct DB)...");

// 1. Get or Create Repertoire
let repId = 2; // Assuming 2 for Caro
const existing = db.query("SELECT id FROM repertoires WHERE name LIKE '%Caro%'").get() as { id: number } | null;

if (existing) {
  repId = existing.id;
  console.log(`Updating existing repertoire ID ${repId}...`);
  // Update side to black just in case
  db.run("UPDATE repertoires SET side = 'black' WHERE id = ?", [repId]);
  
  // Clear existing data
  db.run("DELETE FROM chapters WHERE repertoire_id = ?", [repId]);
  db.run("DELETE FROM positions WHERE repertoire_id = ?", [repId]);
} else {
  const res = db.run("INSERT INTO repertoires (name, description, side) VALUES (?, ?, ?)", ["Caro-Kann Repertoire", "Black repertoire vs e4", "black"]);
  repId = res.lastInsertRowid as number;
  console.log(`Created new repertoire ID ${repId}...`);
}

// 2. Parse PGN
const pgnText = fs.readFileSync(PGN_PATH, 'utf8');
const parsedGames = PgnParser.parse(pgnText);
const importData = RepertoireBuilder.build(parsedGames, "Caro-Kann Repertoire");

// 3. Insert Data
const insertChapter = db.prepare("INSERT INTO chapters (repertoire_id, name, sort_order, start_moves, first_fen) VALUES (?, ?, ?, ?, ?)");
const insertPosition = db.prepare("INSERT OR IGNORE INTO positions (repertoire_id, fen, san, next_fen, comment) VALUES (?, ?, ?, ?, ?)");

const transaction = db.transaction(() => {
  // Chapters
  if (importData.chapters) {
    for (let i = 0; i < importData.chapters.length; i++) {
      const ch = importData.chapters[i];
      insertChapter.run(
        repId,
        ch.name,
        i,
        JSON.stringify(ch.startMoves || []),
        ch.firstFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
      );
    }
  }

  // Positions
  let moveCount = 0;
  for (const [fen, moves] of Object.entries(importData.positions)) {
    for (const m of (moves as any[])) {
      insertPosition.run(
        repId,
        fen,
        m.san,
        m.nextFen,
        m.comment || null
      );
      moveCount++;
    }
  }
  console.log(`Seeded ${moveCount} moves.`);
});

transaction();
console.log("Done.");
