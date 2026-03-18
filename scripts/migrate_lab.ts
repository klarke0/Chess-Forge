import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(process.cwd(), "server", "chess_trainer.db");
const db = new Database(DB_PATH);

console.log("Migrating Game Lab tables...");

db.run(`
  CREATE TABLE IF NOT EXISTS game_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    fen TEXT,
    san TEXT, -- The move that reached this position (or null for start)
    FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_game_positions_fen ON game_positions(fen)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_game_positions_game_id ON game_positions(game_id)`);

console.log("Migration complete: 'game_positions' table created.");
