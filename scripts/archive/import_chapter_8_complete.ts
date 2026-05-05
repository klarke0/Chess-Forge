import { Database } from "bun:sqlite";
import fs from 'fs';
import path from 'path';
import { PgnParser, convertParsedGamesToRepertoire } from '../src/services/pgn_parser';

const db = new Database("server/chess_trainer.db");
const PGN_PATH = path.join(process.cwd(), "caro_kann_chapter_8_complete.pgn");
const REPERTOIRE_ID = 2;

function normalizeFenKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

const SETUP_MOVES: Record<string, string[]> = {
  "BOOK: Ch 8 - Var A (6. h3)": ["e4","c6","d4","d5","exd5","cxd5","Bd3","Nc6","c3","Qc7","h3"],
  "BOOK: Ch 8 - Var B (6. Bg5)": ["e4","c6","d4","d5","exd5","cxd5","Bd3","Nc6","c3","Qc7","Bg5"],
  "BOOK: Ch 8 - Var C (6. Ne2 / 6. Qe2)": ["e4","c6","d4","d5","exd5","cxd5","Bd3","Nc6","c3","Qc7","Ne2"]
};

const PGN_MAPPING: Record<string, string> = {
  "BOOK: Ch 8 - Var A (6. h3)": "BOOK: Ch 8 - Var A (6. h3)",
  "BOOK: Ch 8 - Var B (6. Bg5)": "BOOK: Ch 8 - Var B (6. Bg5)",
  "BOOK: Ch 8 - Var C (6. Ne2 / 6. Qe2)": "BOOK: Ch 8 - Var C (6. Ne2 / 6. Qe2)"
};

async function run() {
  console.log("Cleaning old Chapter 8 modules...");
  // We only delete chapters matching BOOK: Ch 8
  db.run("DELETE FROM chapters WHERE repertoire_id = ? AND name LIKE 'BOOK: Ch 8%'", [REPERTOIRE_ID]);
  // We don't delete all positions because they might be shared, but the importer will INSERT OR IGNORE
  
  const pgnText = fs.readFileSync(PGN_PATH, 'utf8');
  const games = pgnText.split(/\[Event /g).filter(s => s.trim().length > 0).map(s => '[Event ' + s);
  const parsedGames = games.map(g => PgnParser.parse(g)[0]).filter(Boolean);

  let sortOrder = 100; // After Chapter 9 if possible, or just some high number
  const insertChapter = db.prepare("INSERT INTO chapters (repertoire_id, name, sort_order, start_moves, first_fen) VALUES (?, ?, ?, ?, ?)");
  const insertPosition = db.prepare("INSERT OR IGNORE INTO positions (repertoire_id, fen, san, next_fen, comment) VALUES (?, ?, ?, ?, ?)");

  db.transaction(() => {
    for (const parsedGame of parsedGames) {
      const originalName = parsedGame.headers['Event'];
      let newName = PGN_MAPPING[originalName];
      if (!newName) {
          console.log(`Skipping unknown variation: ${originalName}`);
          continue;
      }

      console.log(`Adding chapter: ${newName}`);
      insertChapter.run(
        REPERTOIRE_ID,
        newName,
        sortOrder++,
        JSON.stringify(SETUP_MOVES[newName] || []),
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
      );

      // Import all positions from this game tree
      const repData = convertParsedGamesToRepertoire([parsedGame], "Temp", "black");
      for (const [fen, moves] of Object.entries(repData.positions)) {
        const normalizedFen = normalizeFenKey(fen);
        for (const m of (moves as any[])) {
          insertPosition.run(REPERTOIRE_ID, normalizedFen, m.san, m.nextFen, m.comment || null);
        }
      }
    }
  })();

  console.log("Chapter 8 import complete.");
}

run().catch(console.error);
