const { execSync } = require('child_process');
const out = execSync(`echo "position fen rn1qkbnr/pp3ppp/4p3/3pN3/4b1P1/5Q2/PPPP1P1P/RNB1KB1R w KQkq - 1 7\ngo depth 12\nquit" | npx stockfish`).toString();
console.log(out);
