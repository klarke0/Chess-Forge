import { Chess } from 'chess.js';

export interface ParsedMove {
  san: string;
  fenBefore: string;
  fenAfter: string;
  comment?: string;
  nag?: string;
  variations: ParsedMove[][];
  clockAfter?: number; // seconds remaining after this move, parsed from %clk
}

export interface ParsedGame {
  headers: Record<string, string>;
  moves: ParsedMove[];
}

/** Normalize FEN to 4 fields (board + turn + castling + en-passant). */
function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export class PgnParser {
  /**
   * Parses a PGN string into a structured format.
   * Handles multiple games, nested variations, and comments.
   */
  static parse(pgn: string): ParsedGame[] {
    const games = pgn.split(/\n\n(?=\[Event)/);
    return games.map(g => this.parseGame(g)).filter(g => g.moves.length > 0);
  }

  private static parseGame(gameText: string): ParsedGame {
    const headers: Record<string, string> = {};
    const headerRegex = /\[(\w+)\s+"(.*?)"\]/g;
    let match;
    while ((match = headerRegex.exec(gameText)) !== null) {
      headers[match[1]] = match[2];
    }

    const startFen = headers['FEN'] || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const moveText = gameText.replace(/\[.*?\]/g, '').trim();
    const tokens = this.tokenize(moveText);
    const { moves } = this.parseRecursive(tokens, new Chess(startFen));

    return { headers, moves };
  }

  private static tokenize(text: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inComment = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '{') {
        if (current) tokens.push(current);
        current = '{';
        inComment = true;
      } else if (char === '}') {
        current += '}';
        tokens.push(current);
        current = '';
        inComment = false;
      } else if (inComment) {
        current += char;
      } else if (char === '(' || char === ')') {
        if (current) tokens.push(current);
        tokens.push(char);
        current = '';
      } else if (/\s/.test(char)) {
        if (current) tokens.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    if (current) tokens.push(current);
    return tokens.filter(t => !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  }

  private static parseRecursive(tokens: string[], chess: Chess): { moves: ParsedMove[], remaining: string[] } {
    const moves: ParsedMove[] = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token === '(') {
        // Variation branches from the position BEFORE the last main-line move.
        // chess has already advanced past it, so use fenBefore from the last move.
        const parentFen = moves.length > 0 ? moves[moves.length - 1].fenBefore : chess.fen();
        const { moves: variation, remaining } = this.parseRecursive(
          tokens.slice(i + 1),
          new Chess(parentFen)
        );
        if (moves.length > 0) {
          moves[moves.length - 1].variations.push(variation);
        }
        tokens = remaining;
        i = 0;
        continue;
      }

      if (token === ')') {
        return { moves, remaining: tokens.slice(i + 1) };
      }

      if (token.startsWith('{')) {
        if (moves.length > 0) {
          const commentText = token.slice(1, -1).trim();
          moves[moves.length - 1].comment = commentText;
          // Parse %clk H:MM:SS.s or H:MM:SS → seconds
          const clkMatch = commentText.match(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/);
          if (clkMatch) {
            const hours = parseInt(clkMatch[1], 10);
            const minutes = parseInt(clkMatch[2], 10);
            const seconds = parseFloat(clkMatch[3]);
            moves[moves.length - 1].clockAfter = hours * 3600 + minutes * 60 + seconds;
          }
        }
        i++;
        continue;
      }

      if (token.startsWith('$')) {
        if (moves.length > 0) {
          moves[moves.length - 1].nag = token;
        }
        i++;
        continue;
      }

      // Treat as a SAN move
      try {
        const fenBefore = chess.fen();
        // Strip annotations like !, ?, !!, ??, !?, ?! before parsing
        const cleanToken = token.replace(/[!?]+$/, '');
        const m = chess.move(cleanToken);
        if (m) {
          moves.push({
            san: m.san,
            fenBefore,
            fenAfter: chess.fen(),
            variations: [],
          });
        }
      } catch (e) {
        // Skip invalid tokens (result strings etc.)
      }
      i++;
    }

    return { moves, remaining: [] };
  }
}

/**
 * Convert an array of ParsedGame objects into the positions+chapters format
 * expected by the /api/repertoires/import endpoint.
 *
 * All position keys are normalized to 4-field FENs so transpositions are
 * collapsed into a single entry.
 */
export function convertParsedGamesToRepertoire(
  games: ParsedGame[],
  repertoireName: string,
  side: 'white' | 'black' = 'white'
): { name: string; side: 'white' | 'black'; chapters: any[]; positions: Record<string, any[]> } {
  const positions: Record<string, any[]> = {};

  function addMove(fenBefore: string, san: string, fenAfter: string, comment?: string) {
    const key = normalizeFen(fenBefore);
    if (!positions[key]) positions[key] = [];
    if (!positions[key].some((m: any) => m.san === san)) {
      positions[key].push({ san, nextFen: fenAfter, ...(comment ? { comment } : {}) });
    }
  }

  function processVariation(parsedMoves: ParsedMove[]) {
    for (const move of parsedMoves) {
      addMove(move.fenBefore, move.san, move.fenAfter, move.comment);
      for (const variation of move.variations) {
        processVariation(variation);
      }
    }
  }

  const chapters = games.map((game, i) => {
    processVariation(game.moves);
    const startMoves = game.moves.map(m => m.san);
    const firstFen = game.headers['FEN'] ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const gameName = game.headers['White']
      ? `${game.headers['White']} vs ${game.headers['Black'] ?? '?'}`
      : (game.headers['Event'] ?? `Chapter ${i + 1}`);
    return { name: gameName, startMoves, firstFen };
  });

  return { name: repertoireName, side, chapters, positions };
}
