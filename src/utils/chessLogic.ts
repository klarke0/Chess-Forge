import { Chess, Square } from 'chess.js';

export type ControlMap = Record<Square, number>;

export const calculateControl = (fen: string): ControlMap => {
  const game = new Chess(fen);
  const squares: Square[] = [
    'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
    'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
    'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
    'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
    'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
    'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
    'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
    'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1',
  ];

  const control: ControlMap = {} as ControlMap;

  // Initialize
  squares.forEach(sq => control[sq] = 0);

  // We need to calculate attacks for both sides
  // chess.js doesn't expose "attackers()" for an arbitrary square easily in v0.12/v1.0-beta without iterating
  // But we can iterate all pieces and their moves.
  
  // Actually, chess.js move generation includes captures. 
  // We need pseudo-legal moves (including moves to friendly squares for defense).
  // Standard chess.js .moves() only gives legal moves.
  
  // Hacky but effective approach using chess.js internals if available, 
  // or just iterating board.
  
  const board = game.board();
  
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      
      const square = squares[r * 8 + c];
      
      // Get attacks FROM this square
      // We can use game.moves({ square, verbose: true }) but that limits to legal moves.
      // A piece "controls" a square even if it's pinned.
      // This is complex to do perfectly with just public chess.js API.
      
      // Simplified "Active Influence": Use legal moves as a proxy for control.
      // It's not perfect (misses X-ray defense) but good for a heatmap.
      const moves = game.moves({ square, verbose: true });
      
      const weight = piece.color === 'w' ? 1 : -1;
      
      moves.forEach(m => {
        // m.to is the target square
        if (control[m.to] !== undefined) {
           control[m.to] += weight;
        }
      });
      
      // Pawn captures (diagonal) are control, even if no piece there.
      // chess.js moves() includes pawn captures ONLY if there is a target.
      // We need to manually add pawn control squares.
      if (piece.type === 'p') {
         const fileIdx = square.charCodeAt(0) - 97;
         const rankIdx = parseInt(square[1]);
         const attackRank = piece.color === 'w' ? rankIdx + 1 : rankIdx - 1;
         
         if (attackRank >= 1 && attackRank <= 8) {
            // Left capture
            if (fileIdx > 0) {
               const target = (String.fromCharCode(97 + fileIdx - 1) + attackRank) as Square;
               // If it wasn't already covered by a legal capture move
               if (!moves.some(m => m.to === target)) {
                  control[target] += weight;
               }
            }
            // Right capture
            if (fileIdx < 7) {
               const target = (String.fromCharCode(97 + fileIdx + 1) + attackRank) as Square;
               if (!moves.some(m => m.to === target)) {
                  control[target] += weight;
               }
            }
         }
      }
    }
  }

  return control;
};

/**
 * Formats a UCI PV string into SAN with move numbers.
 * Example: "e2e4 e7e5" -> "1. e4 e5" or "1... e5"
 */
export const formatPV = (fen: string, pv: string, maxMoves = 6): string => {
  if (!pv) return '';
  
  try {
    const game = new Chess(fen);
    const moves = pv.split(' ').slice(0, maxMoves);
    const formatted: string[] = [];
    
    let moveNumber = parseInt(fen.split(' ')[5]);
    let turn = game.turn();
    
    moves.forEach((uci, i) => {
      const move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || undefined
      });
      
      if (!move) return;
      
      if (turn === 'w') {
        formatted.push(`${moveNumber}. ${move.san}`);
        turn = 'b';
      } else {
        if (i === 0) {
          formatted.push(`${moveNumber}... ${move.san}`);
        } else {
          formatted.push(move.san);
        }
        turn = 'w';
        moveNumber++;
      }
    });
    
    return formatted.join(' ');
  } catch (e) {
    return pv; // Fallback to raw UCI if parsing fails
  }
};
