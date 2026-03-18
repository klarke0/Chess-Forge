import { Database } from "bun:sqlite";

const db = new Database("server/chess_trainer.db");

console.log("Cleaning up orphaned training data...");

// 1. Delete progress for positions that no longer exist in the 'positions' table
const result = db.run(`
  DELETE FROM progress 
  WHERE fen NOT IN (SELECT fen FROM positions)
`);

console.log(`Removed ${result.changes} orphaned progress records.`);

// 2. Also clean up sessions that might reference deleted repertoires (though we kept rep ID 1)
// But we might want to reset stats if they are skewed?
// For now, just cleaning orphans is safer than a full wipe.

console.log("Cleanup complete.");
