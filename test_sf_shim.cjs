const path = require('path');
const fs = require('fs');

// We need to run the stockfish.js file in a Web Worker environment.
// Since we don't have a real Web Worker, we can use 'worker_threads', but stockfish.js expects the browser 'Worker' API.
// Alternatively, we can just load the WASM by running it in a JSDOM or similar, or just require it if it supports Node.
// But we saw it throws "onmessage is not defined".

// Let's create a minimal shim.
global.onmessage = null;
global.postMessage = function(msg) {
  console.log("FROM SF:", msg);
};

const sfPath = path.resolve('./public/stockfish.js');
const sfCode = fs.readFileSync(sfPath, 'utf8');

// We will eval the code in this context.
try {
  eval(sfCode);
  console.log("Stockfish loaded.");
  
  global.onmessage({ data: 'uci' });
  setTimeout(() => {
    global.onmessage({ data: 'position fen rn1qkbnr/pp3ppp/4p3/3pN3/4b1P1/5Q2/PPPP1P1P/RNB1KB1R w KQkq - 1 7' });
    global.onmessage({ data: 'go depth 12' });
  }, 500);

} catch (e) {
  console.error(e);
}
