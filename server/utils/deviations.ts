import db from "../db";
import { Chess } from "chess.js";

/**
 * Normalize a FEN to 4 fields (board, turn, castling, en-passant).
 */
function normalizeFen(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

/**
 * After analysis is saved for a game, compute deviations from all repertoires
 * and persist them to the `deviations` table.
 *
 * @param gameId - The game's DB id
 * @param analysis - The analysis array (same shape as games.analysis_json)
 */
export function computeAndPersistDeviations(
  gameId: number,
  analysis: Array<{ san?: string; fen?: string; grade?: string; cpLoss?: number }>,
): void {
  // 1. Load the game to get PGN and user_color
  const game = db.query("SELECT pgn, user_color FROM games WHERE id = ?").get(gameId) as {
    pgn: string;
    user_color: string;
  } | null;
  if (!game?.pgn) return;

  // 2. Replay the game to get FEN-before for each move
  const chess = new Chess();
  try {
    chess.loadPgn(game.pgn);
  } catch {
    return;
  }
  const verboseHistory = chess.history({ verbose: true });

  // Rebuild FEN-before list by replaying
  const fensBefore: string[] = [];
  const replay = new Chess();
  for (const move of verboseHistory) {
    fensBefore.push(replay.fen());
    replay.move(move);
  }

  // 3. Load all repertoires and their position trees
  const repertoires = db.query("SELECT id, side FROM repertoires").all() as {
    id: number;
    side: string | null;
  }[];

  const insertDeviation = db.prepare(
    `INSERT INTO deviations (game_id, repertoire_id, fen, expected_san, played_san, move_number, eval_diff, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Clear any existing deviations for this game (idempotent re-analysis)
  db.prepare("DELETE FROM deviations WHERE game_id = ?").run(gameId);

  for (const rep of repertoires) {
    const playerColor = rep.side ?? "white";
    // Only check deviations for the side the user played
    if (game.user_color !== playerColor) continue;

    // Load the position tree for this repertoire
    const posRows = db.query(
      "SELECT fen, san, next_fen FROM positions WHERE repertoire_id = ?",
    ).all(rep.id) as { fen: string; san: string; next_fen: string }[];

    // Build a FEN -> moves map
    const positionTree: Record<string, { san: string; nextFen: string }[]> = {};
    for (const row of posRows) {
      const nFen = normalizeFen(row.fen);
      if (!positionTree[nFen]) positionTree[nFen] = [];
      positionTree[nFen].push({ san: row.san, nextFen: row.next_fen });
    }

    // 4. Walk through the game moves and detect deviations
    for (let i = 0; i < verboseHistory.length; i++) {
      const moveSan = verboseHistory[i].san;
      const fenBefore = normalizeFen(fensBefore[i]);
      const isWhiteMove = i % 2 === 0;
      const isPlayerMove = (playerColor === "white") === isWhiteMove;

      const repertoireMoves = positionTree[fenBefore];
      if (!repertoireMoves || repertoireMoves.length === 0) continue;

      const match = repertoireMoves.find((m) => m.san === moveSan);
      if (!match) {
        const moveNumber = Math.floor(i / 2) + 1;
        // cpLoss from analysis_json is in centipawns; store as pawns for consistency
        const rawCpLoss = analysis[i]?.cpLoss;
        const evalDiff = rawCpLoss != null ? rawCpLoss / 100 : null;
        const side = isPlayerMove ? "player" : "opponent";

        insertDeviation.run(
          gameId,
          rep.id,
          fenBefore,
          repertoireMoves[0].san,
          moveSan,
          moveNumber,
          evalDiff,
          side,
        );
      }
    }
  }
}
