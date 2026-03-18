const { Chess } = require('chess.js');

const chess = new Chess();
// play until before e6
chess.move('e4'); chess.move('c6'); chess.move('Nf3'); chess.move('d5'); chess.move('exd5'); chess.move('cxd5'); chess.move('Ne5'); chess.move('Bf5'); chess.move('Qf3');
console.log('Before e6:', chess.fen(), 'Turn:', chess.turn());

chess.move('e6');
console.log('After e6:', chess.fen(), 'Turn:', chess.turn());
