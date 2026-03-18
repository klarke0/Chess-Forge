import * as api from './api';
import { PgnParser } from './pgn_parser';
import { StockfishEngine } from './engine';
import { Chess } from 'chess.js';
import { useBackgroundStore } from '../stores/backgroundStore';
import { useRepertoireStore } from '../stores/repertoireStore';

export class BackgroundAnalysisQueue {
  private static isRunning = false;
  private static isProcessing = false;
  private static engine: StockfishEngine | null = null;
  private static stopRequested = false;

  static async start() {
    // Start the interval if not already running
    if (!this.isRunning) {
      this.isRunning = true;
      // Periodically check for new games and analyze them
      // Every 2 hours is a good balance between fresh data and CPU/API usage
      setInterval(() => this.processQueue(), 7200000);
    }
    
    // Trigger an immediate check
    this.processQueue();
  }

  static stop() {
    this.stopRequested = true;
    // Update UI immediately so the button changes back
    useBackgroundStore.getState().setAnalyzing(false);
    useBackgroundStore.getState().setStatus(null, 0, 0);
  }

  private static async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.stopRequested = false;

    try {
      // 1. Check for new games on Chess.com first (Auto-Sync)
      const username = useRepertoireStore.getState().chessComUsername;
      if (username && !this.stopRequested) {
        console.log(`[BackgroundAnalysis] Auto-syncing games for ${username}...`);
        try {
          await api.syncGamesFromChessCom(username);
        } catch (e) {
          console.warn('[BackgroundAnalysis] Auto-sync failed:', e);
        }
      }

      // 2. Process all unanalyzed games in the database
      while (!this.stopRequested) {
        // Fetch only unanalyzed games
        const unanalyzed = await api.listGames(100, 0, true);

        if (unanalyzed.length === 0) {
          break;
        }

        // Only set analyzing true if we haven't been stopped since we started this batch
        if (!this.stopRequested) {
          useBackgroundStore.getState().setAnalyzing(true);
        }
        
        let count = 0;
        for (const gameInfo of unanalyzed) {
          if (this.stopRequested) break;

          useBackgroundStore.getState().setStatus(
            `${gameInfo.white_username} vs ${gameInfo.black_username}`,
            count + 1,
            unanalyzed.length
          );
          
          await this.analyzeSingleGame(gameInfo);
          count++;

          // Cool-down: small pause between games
          if (!this.stopRequested) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        if (unanalyzed.length < 100) break; // Finished everything
      }
    } catch (e) {
      console.error('[BackgroundAnalysis] Queue error:', e);
    } finally {
      this.isProcessing = false;
      this.stopRequested = false;
      useBackgroundStore.getState().setAnalyzing(false);
      useBackgroundStore.getState().setStatus(null, 0, 0);
    }
  }

  private static async analyzeSingleGame(gameInfo: api.GameRecord) {
    try {
      // Fetch full PGN
      const game = await api.getGame(gameInfo.id);
      if (!game.pgn) return;

      const parsed = PgnParser.parse(game.pgn)[0];
      if (!parsed) return;

      if (!this.engine) {
        this.engine = new StockfishEngine();
        await this.engine.waitUntilReady();
      }

      const results = [];
      const chess = new Chess();
      let prevEval = 20;

      for (const move of parsed.moves) {
        // Check stop flag inside the move loop for instant stopping
        if (this.stopRequested) return;

        const turn = chess.turn();
        chess.move(move.san);
        const fen = chess.fen();

        // Terminal position: skip engine, assign directly
        if (chess.isGameOver()) {
          const terminalEval = chess.isCheckmate() ? (turn === 'w' ? 2000 : -2000) : 0;
          results.push({ san: move.san, fen, eval: terminalEval, cpLoss: 0, grade: 'best' });
          prevEval = terminalEval;
          continue;
        }

        // Background scan bumped to Depth 12 for high quality without being too slow
        const score = await this.engine.evaluateOnce(fen, 12);

        let normalizedEval = chess.turn() === 'w' ? (score.cp ?? 0) : -(score.cp ?? 0);
        if (score.mate !== null) {
           normalizedEval = score.mate > 0
             ? (chess.turn() === 'w' ? 2000 : -2000)
             : (chess.turn() === 'w' ? -2000 : 2000);
        }

        const sideMoved = turn;
        let cpLoss = sideMoved === 'w'
          ? Math.max(0, prevEval - normalizedEval)
          : Math.max(0, normalizedEval - prevEval);

        results.push({
          san: move.san,
          fen,
          eval: normalizedEval,
          cpLoss: cpLoss,
          grade: this.getGrade(prevEval, normalizedEval, sideMoved)
        });

        prevEval = normalizedEval;
      }

      await api.saveGameAnalysis(gameInfo.id, results);
    } catch (e) {
      console.error(`[BackgroundAnalysis] Failed to analyze game ${gameInfo.id}:`, e);
    }
  }

  private static winPct(cp: number): number {
    return 1 / (1 + Math.exp(-cp / 300));
  }

  private static getGrade(prevEval: number, normalizedEval: number, turn: 'w' | 'b'): string {
    const winDelta = turn === 'w'
      ? this.winPct(prevEval) - this.winPct(normalizedEval)
      : this.winPct(normalizedEval) - this.winPct(prevEval);
    if (winDelta <= 0.015) return 'best';
    if (winDelta <= 0.025) return 'excellent';
    if (winDelta <= 0.065) return 'good';
    if (winDelta <= 0.125) return 'inaccuracy';
    if (winDelta <= 0.235) return 'mistake';
    return 'blunder';
  }
}
