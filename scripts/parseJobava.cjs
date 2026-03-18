const { Chess } = require('chess.js');
const fs = require('fs');
const path = require('path');

const dirPath = path.join(__dirname, '../bortnyk-and-naroditsky-s-jobava-london/');
const files = fs.readdirSync(dirPath).filter(f =>
  f.endsWith('.pgn') &&
  f !== 'All Lines in One File .pgn' &&
  f !== 'Typical Ideas for White.pgn'
);

const repertoire = {
  chapters: [],
  positions: {}
};

/**
 * Normalize FEN to 4 fields (board + turn + castling + en-passant),
 * dropping halfmove clock and fullmove number.  Used as position map keys
 * so that transpositions (same position, different clock counters) resolve.
 */
function normalizeFen(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

function parseGame(pgnContent, chapterName, gameIndex) {
  // Extract FEN if present (some chapters start mid-game)
  const fenMatch = pgnContent.match(/\[FEN "([^"]+)"\]/);
  const startFen = fenMatch ? fenMatch[1] : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const name = gameIndex > 0 ? `${chapterName} #${gameIndex + 1}` : chapterName;

  const moveText = pgnContent.replace(/\[.*?\]/g, '').trim();
  const tokens = [];
  let current = '';
  let inComment = false;

  for (let i = 0; i < moveText.length; i++) {
    const char = moveText[i];
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

  const cleanTokens = tokens.filter(t => !/^\d+\.+$/.test(t) && t !== '*');

  // Stack of Chess instances: stack[0] = main line position, deeper = variations.
  const stack = [new Chess(startFen)];
  let lastMoveSan = null;
  let lastFen = null;

  // Track the full ordered main-line move sequence (SANs) so the trainer can
  // follow the guided line move-by-move for this chapter.
  const mainLineMoves = [];

  for (let i = 0; i < cleanTokens.length; i++) {
    const token = cleanTokens[i];
    const chess = stack[stack.length - 1];

    if (token === '(') {
      // Enter variation: create a copy of current position and undo the last move
      // so variations branch from the correct parent position.
      const variationChess = new Chess(chess.fen());
      variationChess.undo();
      stack.push(variationChess);
    } else if (token === ')') {
      stack.pop();
      if (stack.length === 0) stack.push(new Chess(startFen));
      lastFen = stack[stack.length - 1].fen();
    } else if (token.startsWith('{')) {
      // Comment: attach to the last move in the positions map
      const comment = token.slice(1, -1).trim();
      if (lastFen && lastMoveSan) {
        const normKey = normalizeFen(lastFen);
        const moves = repertoire.positions[normKey];
        if (moves) {
          const move = moves.find(m => m.san === lastMoveSan);
          if (move) {
            move.comment = move.comment ? move.comment + ' ' + comment : comment;
          }
        }
      }
    } else {
      // Move token
      try {
        const fenBefore = chess.fen();
        const normKey = normalizeFen(fenBefore);
        const cleanToken = token.replace(/[!?]+$/, '');
        const move = chess.move(cleanToken);
        if (move) {
          // Add position to map (normalized key)
          if (!repertoire.positions[normKey]) repertoire.positions[normKey] = [];
          if (!repertoire.positions[normKey].some(x => x.san === move.san)) {
            repertoire.positions[normKey].push({ san: move.san, nextFen: chess.fen() });
          }

          // Track main-line moves (stack.length === 1 means we're on the main line)
          if (stack.length === 1) {
            mainLineMoves.push(move.san);
          }

          lastFen = fenBefore;
          lastMoveSan = move.san;
        }
      } catch (e) {
        // Ignore illegal move tokens (result strings like "1-0", "1/2-1/2", etc.)
      }
    }
  }

  repertoire.chapters.push({
    name: name.replace('.pgn', ''),
    // Full ordered main-line move sequence for the guided-line feature.
    // The trainer uses this to know which move to highlight next.
    startMoves: mainLineMoves,
    // Keep full 6-field FEN so Chess.js can reconstruct the starting position.
    firstFen: startFen,
  });
}

files.forEach(file => {
  const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
  const games = content.split(/\n\n(?=\[Event)/).filter(g => g.trim().length > 0);

  if (games.length === 0) {
    parseGame(content, file, 0);
  } else {
    games.forEach((g, i) => parseGame(g, file, i));
  }
});

// Top-level start moves (moves available from the initial position)
const initialNorm = normalizeFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
repertoire.start = repertoire.positions[initialNorm] || [];

fs.writeFileSync(
  path.join(__dirname, '../src/data/jobava_full.json'),
  JSON.stringify(repertoire, null, 2)
);

console.log(`Parsed ${repertoire.chapters.length} chapters and ${Object.keys(repertoire.positions).length} positions.`);
