import { Database } from "bun:sqlite";

const db = new Database("server/chess_trainer.db");

try {
  console.log("Adding 'side' column to repertoires table...");
  db.run("ALTER TABLE repertoires ADD COLUMN side TEXT DEFAULT 'white'");
  console.log("Column added successfully.");
} catch (e: any) {
  if (e.toString().includes("duplicate column")) {
    console.log("Column 'side' already exists.");
  } else {
    console.error("Error adding column:", e);
  }
}

// Update existing repertoires
console.log("Updating repertoire sides...");
db.run("UPDATE repertoires SET side = 'white' WHERE name LIKE '%Jobava%'");
db.run("UPDATE repertoires SET side = 'black' WHERE name LIKE '%Caro%'");

const reps = db.query("SELECT id, name, side FROM repertoires").all();
console.log("Current Repertoires:", reps);
