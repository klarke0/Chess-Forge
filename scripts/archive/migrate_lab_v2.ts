import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(process.cwd(), "server", "chess_trainer.db");
const db = new Database(DB_PATH);

console.log("Upgrading Game Lab tables...");

// Drop and recreate to keep it clean for this dev cycle
db.run(`DROP TABLE IF EXISTS game_positions`);

db.run(`
  CREATE TABLE game_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    fen TEXT,
    fen_before TEXT,
    san TEXT,
    FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_game_positions_fen ON game_positions(fen)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_game_positions_fen_before ON game_positions(fen_before)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_game_positions_game_id ON game_positions(game_id)`);

console.log("Migration complete: 'game_positions' table upgraded.");
