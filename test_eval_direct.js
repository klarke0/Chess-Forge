import { Chess } from 'chess.js';

const chess = new Chess();
chess.load("rn1qkbnr/pp3ppp/4p3/3pN3/4b1P1/5Q2/PPPP1P1P/RNB1KB1R w KQkq - 1 7");

const turn = chess.turn();

// Let's pretend evaluateOnce returns { cp: null, mate: 1, pv: 'f3f7', bestMove: 'f3f7' }
const score = { cp: null, mate: 1, pv: 'f3f7', bestMove: 'f3f7' };

let normalizedEval = chess.turn() === 'w' ? (score.cp ?? 0) : -(score.cp ?? 0); 
if (score.mate !== null) {
   normalizedEval = score.mate > 0 
     ? (chess.turn() === 'w' ? 2000 : -2000)
     : (chess.turn() === 'w' ? -2000 : 2000);
}

console.log("normalizedEval:", normalizedEval);
