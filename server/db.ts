import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "chess_trainer.db");

let db: Database;

export function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.query("PRAGMA journal_mode = WAL").run();
    db.query("PRAGMA foreign_keys = ON").run();
    runMigrations(db);
  }
  return db;
}

function runMigrations(db: Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS repertoires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      start_moves TEXT NOT NULL DEFAULT '[]',
      first_fen TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      fen TEXT NOT NULL,
      san TEXT NOT NULL,
      next_fen TEXT NOT NULL,
      comment TEXT,
      UNIQUE(repertoire_id, fen, san)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_positions_fen ON positions(repertoire_id, fen)`,
    `CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      fen TEXT NOT NULL,
      total_attempts INTEGER NOT NULL DEFAULT 0,
      correct_attempts INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      interval_days REAL NOT NULL DEFAULT 0,
      next_review TEXT,
      last_reviewed TEXT,
      UNIQUE(repertoire_id, fen)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_progress_review ON progress(repertoire_id, next_review)`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      positions_drilled INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      mistake_count INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE,
      white_username TEXT,
      black_username TEXT,
      user_color TEXT,
      result TEXT,
      pgn TEXT,
      opening_class TEXT,
      opening_name TEXT,
      eco TEXT,
      analysis_json TEXT,
      date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS game_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
      fen TEXT,
      fen_before TEXT,
      san TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_game_positions_fen ON game_positions(fen)`,
    `CREATE INDEX IF NOT EXISTS idx_game_positions_fen_before ON game_positions(fen_before)`,
    `CREATE TABLE IF NOT EXISTS deviations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      repertoire_id INTEGER NOT NULL REFERENCES repertoires(id) ON DELETE CASCADE,
      fen TEXT NOT NULL,
      expected_san TEXT NOT NULL,
      played_san TEXT NOT NULL,
      move_number INTEGER NOT NULL,
      eval_diff REAL,
      notes TEXT
    )`,
  ];

  for (const sql of statements) {
    db.query(sql).run();
  }

  // Runtime migrations (add columns to existing tables without losing data)
  const addCol = (table: string, col: string, type: string) => {
    try {
      const info = db.query(`PRAGMA table_info(${table})`).all() as any[];
      if (!info.some(c => c.name === col)) {
        db.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
        console.log(`Migrated: Added ${col} to ${table}`);
      }
    } catch (e) {
      console.warn(`Migration failed for ${table}.${col}:`, e);
    }
  };

  addCol("repertoires", "side", "TEXT DEFAULT 'white'");
  addCol("games", "white_result", "TEXT");
  addCol("games", "black_result", "TEXT");
  addCol("games", "time_control", "TEXT");
  addCol("games", "time_class", "TEXT");
  addCol("games", "eco", "TEXT");
  addCol("games", "opening_name", "TEXT");
  addCol("chapters", "learn_runs", "INTEGER NOT NULL DEFAULT 0");
  addCol("games", "termination", "TEXT");
  addCol("games", "game_shape", "TEXT");

  db.query(`CREATE TABLE IF NOT EXISTS pattern_reports (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    games_hash TEXT,
    report_json TEXT NOT NULL
  )`).run();
}

export function seedJobavaLondon(db: Database) {
  // Check if already seeded
  const existing = db.query("SELECT id FROM repertoires WHERE name = ?").get("Jobava London");
  if (existing) return;

  const dataPath = join(import.meta.dir, "..", "src", "data", "jobava_full.json");
  const raw = readFileSync(dataPath, "utf-8");
  const data = JSON.parse(raw) as {
    chapters: Array<{ name: string; startMoves: string[]; firstFen: string }>;
    positions: Record<string, Array<{ san: string; nextFen: string; comment?: string }>>;
  };

  const insertRepertoire = db.prepare(
    "INSERT INTO repertoires (name, description) VALUES (?, ?)"
  );
  const insertChapter = db.prepare(
    "INSERT INTO chapters (repertoire_id, name, sort_order, start_moves, first_fen) VALUES (?, ?, ?, ?, ?)"
  );
  const insertPosition = db.prepare(
    "INSERT OR IGNORE INTO positions (repertoire_id, fen, san, next_fen, comment) VALUES (?, ?, ?, ?, ?)"
  );

  db.transaction(() => {
    const result = insertRepertoire.run("Jobava London", "Bortnyk & Naroditsky's Jobava London System");
    const repertoireId = Number(result.lastInsertRowid);

    for (let i = 0; i < data.chapters.length; i++) {
      const ch = data.chapters[i];
      insertChapter.run(
        repertoireId,
        ch.name,
        i,
        JSON.stringify(ch.startMoves),
        ch.firstFen
      );
    }

    for (const [fen, moves] of Object.entries(data.positions)) {
      for (const move of moves) {
        insertPosition.run(repertoireId, fen, move.san, move.nextFen, move.comment ?? null);
      }
    }
  })();

  console.log("Seeded Jobava London repertoire");
}

// Initialize on import
const database = getDb();
seedJobavaLondon(database);

export default database;
