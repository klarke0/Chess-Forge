import { ParsedGame, ParsedMove } from './pgn_parser';

export interface RepertoireImportData {
  name: string;
  chapters: Array<{
    name: string;
    startMoves: string[];
    firstFen: string;
  }>;
  positions: Record<string, Array<{ san: string; nextFen: string; comment?: string }>>;
}

export class RepertoireBuilder {
  static build(parsedGames: ParsedGame[], repertoireName: string): RepertoireImportData {
    const positions: RepertoireImportData['positions'] = {};
    const chapters: RepertoireImportData['chapters'] = [];

    parsedGames.forEach((game, index) => {
      // 1. Create Chapter
      const name = game.headers['Event'] && game.headers['Event'] !== '?' 
        ? game.headers['Event'] 
        : `Chapter ${index + 1}`;
      
      // Determine start moves (if any)
      // For simplicity, we assume the chapter starts at the root, but we could 
      // detect if it starts from a specific FEN in headers.
      let firstFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      if (game.headers['FEN']) {
        firstFen = game.headers['FEN'];
      }

      const startMoves = game.moves.map(m => m.san);

      chapters.push({
        name,
        startMoves,
        firstFen
      });

      // 2. Build Position Tree
      this.traverseMoves(game.moves, positions);
    });

    return { name: repertoireName, chapters, positions };
  }

  private static traverseMoves(moves: ParsedMove[], positions: Record<string, any[]>) {
    for (const move of moves) {
      const { fenBefore, san, fenAfter, comment, variations } = move;

      if (!positions[fenBefore]) {
        positions[fenBefore] = [];
      }

      // Avoid duplicates
      const existing = positions[fenBefore].find(m => m.san === san);
      if (!existing) {
        positions[fenBefore].push({
          san,
          nextFen: fenAfter,
          comment
        });
      } else if (comment && !existing.comment) {
        // Merge comment if existing didn't have one
        existing.comment = comment;
      }

      // Recurse into main line
      // (The parser structure is a flat list for main line, but variations are nested)
      // Wait, PgnParser structure: `moves` is an array of the main line sequence?
      // No, looking at PgnParser:
      // It returns a list of moves. If it's a linear game, it's [1.e4, 1...e5, 2.Nf3...]
      // So we don't "recurse" the main line array, we just iterate it.
      // BUT, we DO need to handle `variations` which are arrays of ParsedMove[].
      
      if (variations && variations.length > 0) {
        for (const variation of variations) {
          this.traverseMoves(variation, positions);
        }
      }
    }
  }
}
