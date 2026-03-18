import { ParsedGame } from '../services/pgn_parser';
import { Deviation } from '../components/GameAnalysis';
import { normalizeFen } from './normalizeFen';

type PositionTree = Record<string, { san: string; nextFen: string }[]>;

export function computeDeviations(
  parsedGame: ParsedGame,
  positions: PositionTree,
  playerColor: 'white' | 'black',
): Deviation[] {
  const deviations: Deviation[] = [];

  for (let i = 0; i < parsedGame.moves.length; i++) {
    const move = parsedGame.moves[i];
    const isWhiteMove = i % 2 === 0;
    const isPlayerMove = (playerColor === 'white') === isWhiteMove;

    const repertoireMoves = positions[normalizeFen(move.fenBefore)] || [];
    if (repertoireMoves.length === 0) continue; // position not in repertoire

    const repertoireMatch = repertoireMoves.find(m => m.san === move.san);
    if (!repertoireMatch) {
      deviations.push({
        moveNumber: Math.floor(i / 2) + 1,
        fen: normalizeFen(move.fenBefore),
        playedSan: move.san,
        repertoireSan: repertoireMoves[0].san,
        evalDiff: 0,
        side: isPlayerMove ? 'player' : 'opponent',
      });
    }
  }

  return deviations;
}
