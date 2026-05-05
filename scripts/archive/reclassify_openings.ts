import { Database } from "bun:sqlite";
import { Chess } from "chess.js";

const db = new Database("server/chess_trainer.db");

console.log("Re-classifying Openings with Jobava London support...");

function classifyOpening(history: string[], pgnHeaders?: Record<string, string>): string {
  // 1. Check PGN Header first
  const headerOpening = pgnHeaders?.['Opening'] || '';
  if (headerOpening.toLowerCase().includes('jobava')) return 'Jobava London';

  if (history.length === 0) return 'Other';
  const h = history;
  
  if (h[0] === 'e4') {
    if (h[1] === 'c5') return 'Sicilian';
    if (h[1] === 'e5') {
      if (h[2] === 'Nf3') {
        if (h[3] === 'Nc6') {
          if (h[4] === 'Bb5') return 'Ruy Lopez';
          if (h[4] === 'Bc4') return 'Italian Game';
          if (h[4] === 'd4') return 'Scotch Game';
        }
        if (h[3] === 'Nf6') return 'Petrov Defense';
      }
      return 'Open Game';
    }
    if (h[1] === 'c6') return 'Caro-Kann';
    if (h[1] === 'e6') return 'French Defense';
    if (h[1] === 'd6') return 'Pirc Defense';
    if (h[1] === 'g6') return 'Modern Defense';
    if (h[1] === 'Nf6') return 'Alekhine Defense';
    if (h[1] === 'd5') return 'Scandinavian';
  }

  if (h[0] === 'd4') {
    // Detect Jobava London (1. d4 ... 2. Nc3 ... 3. Bf4)
    const whiteMoves = [h[0], h[2], h[4]];
    if (whiteMoves[1] === 'Nc3' && whiteMoves[2] === 'Bf4') return 'Jobava London';

    if (h[1] === 'd5') {
      if (h[2] === 'c4') {
        if (h[3] === 'e6') return "Queen's Gambit Declined";
        if (h[3] === 'c6') return "Slav Defense";
        return "Queen's Gambit";
      }
      if (h[2] === 'Bf4' || (h[2] === 'Nf3' && h[3] !== 'Nc3' && h[4] === 'Bf4')) return 'London System';
    }
    if (h[1] === 'Nf6') {
      if (h[2] === 'c4') {
        if (h[3] === 'e6') return 'Nimzo / Queen\'s Indian';
        if (h[3] === 'g6') return 'King\'s Indian / Grünfeld';
        if (h[3] === 'c5') return 'Benoni Defense';
      }
      if (h[2] === 'Nf3' && h[3] === 'e6' && h[4] === 'Bf4') return 'London System';
    }
  }

  if (h[0] === 'c4') return 'English Opening';
  if (h[0] === 'Nf3') return 'Réti Opening';
  
  return 'Other';
}

const games = db.query("SELECT id, pgn FROM games").all() as { id: number; pgn: string }[];

const updateStmt = db.prepare("UPDATE games SET opening_class = ? WHERE id = ?");

let updated = 0;
const transaction = db.transaction(() => {
  for (const game of games) {
    try {
      const chess = new Chess();
      chess.loadPgn(game.pgn);
      const openingClass = classifyOpening(chess.history(), chess.header());
      updateStmt.run(openingClass, game.id);
      updated++;
    } catch (e) {
      console.warn(`Failed to re-classify game ${game.id}`);
    }
  }
});

transaction();

console.log(`Successfully re-classified ${updated} games.`);
