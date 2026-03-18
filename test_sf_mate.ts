import { StockfishEngine } from './src/services/engine.ts';
import { Chess } from 'chess.js';

// Wait, I can't easily run StockfishEngine in Node because it uses Worker.
// Let's mock the Worker.
