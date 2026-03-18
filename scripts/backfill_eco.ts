import { Database } from "bun:sqlite";
import { Chess } from "chess.js";

const db = new Database("server/chess_trainer.db");

console.log("Backfilling ECO and Opening Names...");

const games = db.query("SELECT id, pgn FROM games").all() as { id: number; pgn: string }[];

const updateStmt = db.prepare("UPDATE games SET eco = ?, opening_name = ? WHERE id = ?");

let updated = 0;
const transaction = db.transaction(() => {
  for (const game of games) {
    try {
      const chess = new Chess();
      chess.loadPgn(game.pgn);
      const headers = chess.header();
      const eco = headers['ECO'] || null;
      const opening = headers['Opening'] || null;
      updateStmt.run(eco, opening, game.id);
      updated++;
    } catch (e) {
      console.warn(`Failed to parse game ${game.id}`);
    }
  }
});

transaction();

console.log(`Successfully updated ${updated} games.`);
