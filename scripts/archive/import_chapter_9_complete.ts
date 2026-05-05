import { Database } from "bun:sqlite";
import fs from 'fs';
import path from 'path';
import { PgnParser, convertParsedGamesToRepertoire } from '../src/services/pgn_parser';

const db = new Database("server/chess_trainer.db");
const PGN_PATH = path.join(process.cwd(), "caro_kann_chapter_9_expanded.pgn");
const REPERTOIRE_ID = 2;

function normalizeFenKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

// Define the exact setup moves required to reach the start of each variation
// The book is for Black. The setup should end after White's move, so it is Black's turn to respond to the variation choice.
const SETUP_MOVES: Record<string, string[]> = {
  "BOOK: Ch 9 - Intro & Var A (6. Bxh6)": ["e4","c6","d4","d5","e5","c5","dxc5","e6","Be3","Nh6","Bxh6"],
  "BOOK: Ch 9 - Var C (6. Nf3)": ["e4","c6","d4","d5","e5","c5","dxc5","e6","Be3","Nh6","Nf3"],
  "BOOK: Ch 9 - Var B1 (9. Be2)": ["e4","c6","d4","d5","e5","c5","dxc5","e6","Be3","Nh6","c3","Nf5","Bd4","Nd7","Nf3","Nc6","Be2"],
  "BOOK: Ch 9 - Var B2 (9. Qd2)": ["e4","c6","d4","d5","e5","c5","dxc5","e6","Be3","Nh6","c3","Nf5","Bd4","Nd7","Nf3","Nc6","Qd2"],
  "BOOK: Ch 9 - Var B3 (9. a3)": ["e4","c6","d4","d5","e5","c5","dxc5","e6","Be3","Nh6","c3","Nf5","Bd4","Nd7","Nf3","Nc6","a3"]
};

// We will map the games from the PGN to our new structured titles
const PGN_MAPPING: Record<string, string> = {
  "Caro-Kann Chapter 9: Intro & Variation A (6. Bxh6)": "BOOK: Ch 9 - Intro & Var A (6. Bxh6)",
  "Caro-Kann Chapter 9: Variation B1 (9. Be2)": "BOOK: Ch 9 - Var B1 (9. Be2)",
  "Caro-Kann Chapter 9: Variation B2 (9. Qd2)": "BOOK: Ch 9 - Var B2 (9. Qd2)",
  "Caro-Kann Chapter 9: Variation B3 (9. a3)": "BOOK: Ch 9 - Var B3 (9. a3)",
  "Caro-Kann Chapter 9: Variation C (6. Nf3)": "BOOK: Ch 9 - Var C (6. Nf3)"
};

async function run() {
  console.log("Cleaning old Chapter 9 modules...");
  db.run("DELETE FROM chapters WHERE repertoire_id = ? AND name LIKE 'BOOK%'", [REPERTOIRE_ID]);
  db.run("DELETE FROM positions WHERE repertoire_id = ?", [REPERTOIRE_ID]);

  const pgnText = fs.readFileSync(PGN_PATH, 'utf8');
  const games = pgnText.split(/\[Event /g).filter(s => s.trim().length > 0).map(s => '[Event ' + s);
  const parsedGames = games.map(g => PgnParser.parse(g)[0]).filter(Boolean);

  let sortOrder = 0;
  const insertChapter = db.prepare("INSERT INTO chapters (repertoire_id, name, sort_order, start_moves, first_fen) VALUES (?, ?, ?, ?, ?)");
  const insertPosition = db.prepare("INSERT OR IGNORE INTO positions (repertoire_id, fen, san, next_fen, comment) VALUES (?, ?, ?, ?, ?)");

  db.transaction(() => {
    for (const parsedGame of parsedGames) {
      const originalName = parsedGame.headers['Event'];
      let newName = PGN_MAPPING[originalName];
      if (!newName) continue;

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

  console.log("Restructuring complete.");
}

run().catch(console.error);