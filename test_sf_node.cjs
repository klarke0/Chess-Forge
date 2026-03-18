const { Worker } = require('worker_threads');
const path = require('path');

const worker = new Worker(path.resolve('./public/stockfish.js'));
worker.on('message', (msg) => {
  console.log('MSG:', msg);
  if (msg.startsWith('bestmove')) {
    process.exit(0);
  }
});
worker.postMessage('uci');
setTimeout(() => {
  worker.postMessage('position fen rn1qkbnr/pp3ppp/4p3/3pN3/4b1P1/5Q2/PPPP1P1P/RNB1KB1R w KQkq - 1 7');
  worker.postMessage('go depth 12');
}, 500);