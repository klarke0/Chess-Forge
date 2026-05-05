import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(process.cwd(), "server", "chess_trainer.db");
const db = new Database(DB_PATH);

console.log("Migrating database...");

// Force drop to ensure clean schema with all columns
db.run(`DROP TABLE IF EXISTS games`);

db.run(`
  CREATE TABLE games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE,
    white_username TEXT,
    black_username TEXT,
    user_color TEXT,
    result TEXT,
    pgn TEXT,
    opening_class TEXT,
    date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_games_user_color ON games(user_color)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_games_opening_class ON games(opening_class)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_games_result ON games(result)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_games_date ON games(date)`);

console.log("Migration complete: 'games' table reset.");
