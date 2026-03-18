/**
 * Normalize a FEN string to 4 fields (board, turn, castling, en-passant),
 * dropping the halfmove clock and fullmove number.
 */
export function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}
