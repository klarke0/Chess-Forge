/**
 * Strip the halfmove-clock and fullmove-number fields from a FEN string,
 * leaving only the position-defining segments (board, side-to-move, castling,
 * en-passant). Lookups against the `progress`, `positions`, `deviations`, and
 * `dismissed_positions` tables all key off this normalized form so the same
 * position from different game contexts hashes to the same row.
 *
 * Mirrors `src/utils/normalizeFen.ts` for client-side use; both must stay in
 * lockstep so a FEN normalized on the client matches the same row written by
 * the server (and vice versa).
 */
export function normalizeFen(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}
