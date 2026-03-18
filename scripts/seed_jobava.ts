import { Database } from "bun:sqlite";
import fs from 'fs';
import path from 'path';

const db = new Database("server/chess_trainer.db");

// Load the clean JSON data
const jsonPath = path.join(process.cwd(), "src/data/jobava_full.json");
const jsonData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

console.log("Seeding Jobava London from clean JSON...");

// 1. Get or Create Repertoire
let repId = 1;
const existing = db.query("SELECT id FROM repertoires WHERE name = ?").get("Jobava London") as { id: number } | null;

if (existing) {
  repId = existing.id;
  console.log(`Updating existing repertoire ID ${repId}...`);
  // Clear existing data
  db.run("DELETE FROM chapters WHERE repertoire_id = ?", [repId]);
  db.run("DELETE FROM positions WHERE repertoire_id = ?", [repId]);
} else {
  const res = db.run("INSERT INTO repertoires (name, description) VALUES (?, ?)", ["Jobava London", "Bortnyk & Naroditsky's Jobava London System"]);
  repId = res.lastInsertRowid as number;
  console.log(`Created new repertoire ID ${repId}...`);
}

const insertChapter = db.prepare("INSERT INTO chapters (repertoire_id, name, sort_order, start_moves, first_fen) VALUES (?, ?, ?, ?, ?)");
const insertPosition = db.prepare("INSERT OR IGNORE INTO positions (repertoire_id, fen, san, next_fen, comment) VALUES (?, ?, ?, ?, ?)");

// 3. Insert Chapters
const transaction = db.transaction(() => {
  for (let i = 0; i < jsonData.chapters.length; i++) {
    const ch = jsonData.chapters[i];
    insertChapter.run(
      repId, 
      ch.name, 
      i, 
      JSON.stringify(ch.startMoves), 
      ch.firstFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    );
  }

  // 4. Insert Positions
  let moveCount = 0;
  for (const [fen, moves] of Object.entries(jsonData.positions)) {
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
