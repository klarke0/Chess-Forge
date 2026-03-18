import { exec } from 'child_process';

const fen = "rn1qkbnr/pp3ppp/4p3/3pN3/4b1P1/5Q2/PPPP1P1P/RNB1KB1R w KQkq - 1 7";
const sf = exec('npx stockfish');
sf.stdout.on('data', data => {
  console.log(data);
});
sf.stdin.write(`position fen ${fen}\ngo depth 12\n`);
setTimeout(() => sf.stdin.write('quit\n'), 2000);
