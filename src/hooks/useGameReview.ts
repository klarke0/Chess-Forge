import { useState, useRef, useCallback, useEffect } from 'react';
import { StockfishEngine } from '../services/engine';
import { ParsedGame } from '../services/pgn_parser';
import { Chess } from 'chess.js';
import * as api from '../services/api';

export interface ReviewedMove {
  san: string;
  fen: string;
  eval: number; // Always white perspective
  cpLoss: number;
  grade: 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
  bestMove?: string;        // engine's best move (UCI) for the position BEFORE this move was played
  timeSpent?: number;       // seconds this side spent on this move
  clockRemaining?: number;  // seconds left on clock after move
  underPressure?: boolean;  // clock < 10% of initial or < 30s
}

const getLSKey = (gameId?: string) => `game-analysis-${gameId || 'last'}`;

export function useGameReview(gameId?: string, initialAnalysis?: string | null) {
  const [reviewedMoves, setReviewedMoves] = useState<ReviewedMove[]>(() => {
    try {
      if (initialAnalysis) return JSON.parse(initialAnalysis);
      const saved = localStorage.getItem(getLSKey(gameId));
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  
  const engineRef = useRef<StockfishEngine | null>(null);
  const abortRef = useRef(false);

  // Persistence: Keep engine alive between scans, quit only on unmount
  useEffect(() => {
    return () => {
      if (engineRef.current) {
        engineRef.current.quit();
        engineRef.current = null;
      }
    };
  }, []);

  // Sync results when gameId changes
  useEffect(() => {
    try {
      // 0. Priority: Use passed initial analysis if available
      if (initialAnalysis) {
        const results = JSON.parse(initialAnalysis);
        setReviewedMoves(results);
        setIsAnalyzing(false);
        setProgress({ current: 0, total: 0 });
        setError(null);
        return;
      }

      // 1. Next: Check local state for immediate response
      const saved = localStorage.getItem(getLSKey(gameId));
      if (saved) {
        setReviewedMoves(JSON.parse(saved));
        setIsAnalyzing(false);
        setProgress({ current: 0, total: 0 });
        return;
      }

      // 2. Fallback: Check if analysis exists in the global games list
      // (This avoids an extra API call if we already have it in listGames)
      // Note: GamesTab already has this data in the 'games' state if it loaded the list.
      // But here we can also just fetch it if needed.
      api.getGame(Number(gameId)).then(game => {
        if (game.analysis_json) {
          const results = JSON.parse(game.analysis_json);
          setReviewedMoves(results);
          // Also save to localStorage for faster future access
          localStorage.setItem(getLSKey(gameId), game.analysis_json);
        } else {
          setReviewedMoves([]);
        }
      }).catch(() => setReviewedMoves([]));

      setIsAnalyzing(false);
      setProgress({ current: 0, total: 0 });
      setError(null);
    } catch {
      setReviewedMoves([]);
    }
  }, [gameId, initialAnalysis]);

  const winPct = (cp: number) => 1 / (1 + Math.exp(-cp / 300));

  const getGrade = (prevEval: number, nextEval: number, turn: 'w' | 'b'): ReviewedMove['grade'] => {
    const winDelta = turn === 'w'
      ? winPct(prevEval) - winPct(nextEval)
      : winPct(nextEval) - winPct(prevEval);
    if (winDelta <= 0.015) return 'best';
    if (winDelta <= 0.025) return 'excellent';
    if (winDelta <= 0.065) return 'good';
    if (winDelta <= 0.125) return 'inaccuracy';
    if (winDelta <= 0.235) return 'mistake';
    return 'blunder';
  };

  const analyzeGame = useCallback(async (parsedGame: ParsedGame) => {
    if (!parsedGame.moves.length) return;

    setIsAnalyzing(true);
    setReviewedMoves([]);
    setError(null);
    abortRef.current = false;
    setProgress({ current: 0, total: parsedGame.moves.length });

    if (!engineRef.current) {
      engineRef.current = new StockfishEngine();
    }
    
    // Ensure engine is ready and not busy
    await engineRef.current.waitUntilReady();
    engineRef.current.stop();

    const game = new Chess();
    const moves = parsedGame.moves;
    const results: ReviewedMove[] = [];
    
    // Centipawns — normalized to White perspective
    let prevEval = 20;
    // Engine's best move (UCI) from the previous position — this is the best
    // move for the side that is about to move in the current iteration.
    let prevBestMove = '';

    // Seed prevBestMove from the starting position so move 1 has a bestMove
    try {
      const startScore = await engineRef.current.evaluateOnce(game.fen(), 10);
      prevBestMove = startScore.bestMove;
    } catch { /* proceed without it */ }

    // Parse initial time from TimeControl header (strip increment: "180+2" → 180)
    const tcRaw = parsedGame.headers['TimeControl'] ?? '';
    const initialTime = parseInt(tcRaw.split('+')[0], 10) || null;
    const pressureThreshold = initialTime ? Math.max(30, initialTime * 0.10) : 30;

    let prevClockWhite: number | null = initialTime;
    let prevClockBlack: number | null = initialTime;

    try {
      for (let i = 0; i < moves.length; i++) {
        if (abortRef.current) break;

        const moveSan = moves[i].san;
        const turn = game.turn(); // 'w' or 'b' BEFORE move
        
        game.move(moveSan);
        const fen = game.fen();

        // Time data
        const clockAfter = moves[i].clockAfter ?? null;
        let timeSpent: number | undefined;
        let clockRemaining: number | undefined;
        let underPressure: boolean | undefined;

        if (clockAfter !== null && clockAfter !== undefined) {
          const prevClock = turn === 'w' ? prevClockWhite : prevClockBlack;
          if (prevClock !== null) {
            timeSpent = Math.max(0, prevClock - clockAfter);
          }
          clockRemaining = clockAfter;
          underPressure = clockAfter < pressureThreshold;
          if (turn === 'w') prevClockWhite = clockAfter;
          else prevClockBlack = clockAfter;
        }

        // Terminal position: checkmate/stalemate/draw — Stockfish returns no eval lines
        if (game.isGameOver()) {
          const terminalEval = game.isCheckmate()
            ? (turn === 'w' ? 2000 : -2000)
            : 0;
          results.push({ san: moveSan, fen, eval: terminalEval, cpLoss: 0, grade: 'best', timeSpent, clockRemaining, underPressure });
          prevEval = terminalEval;
          if (i % 5 === 0 || i === moves.length - 1) {
            setReviewedMoves([...results]);
            setProgress({ current: i + 1, total: parsedGame.moves.length });
          }
          continue;
        }

        // 1. Fast Pass - Depth 10 is still very fast but catches more than depth 8
        const score = await engineRef.current.evaluateOnce(fen, 10);
        // bestMove from the PREVIOUS position = what engine recommended for
        // the side that just moved. Capture it before we overwrite prevBestMove.
        const bestMoveForThisMove = prevBestMove;

        let normalizedEval = game.turn() === 'w' ? (score.cp ?? 0) : -(score.cp ?? 0);
        if (score.mate !== null) {
           normalizedEval = score.mate > 0
             ? (game.turn() === 'w' ? 2000 : -2000)
             : (game.turn() === 'w' ? -2000 : 2000);
        }

        const sideMoved = turn;
        let cpLoss = sideMoved === 'w'
          ? Math.max(0, prevEval - normalizedEval)
          : Math.max(0, normalizedEval - prevEval);

        console.log(`[Review] Move ${i+1} (${sideMoved}): ${moveSan}, Eval: ${normalizedEval}, Prev: ${prevEval}, Loss: ${cpLoss}`);

        // Update prevBestMove for the next iteration (use fast pass by default)
        prevBestMove = score.bestMove;

        // 2. Adaptive Depth: Confirmation Scan
        // Higher threshold for "deep think" during full scan - only blunders (> 150)
        if (cpLoss > 150 || score.cp === null) {
          const deepScore = await engineRef.current.evaluateOnce(fen, 13);
          let deepEval = game.turn() === 'w' ? (deepScore.cp ?? 0) : -(deepScore.cp ?? 0);
          if (deepScore.mate !== null) {
            deepEval = deepScore.mate > 0
              ? (game.turn() === 'w' ? 2000 : -2000)
              : (game.turn() === 'w' ? -2000 : 2000);
          }

          normalizedEval = deepEval;
          cpLoss = sideMoved === 'w'
            ? Math.max(0, prevEval - normalizedEval)
            : Math.max(0, normalizedEval - prevEval);
          // Deep scan gives a more accurate bestMove — use it for next iteration
          prevBestMove = deepScore.bestMove;
        }

        if (Math.abs(prevEval) > 1500 && Math.abs(normalizedEval) > 1500) cpLoss = 0;

        results.push({
          san: moveSan,
          fen,
          eval: normalizedEval,
          cpLoss: cpLoss,
          grade: getGrade(prevEval, normalizedEval, sideMoved),
          bestMove: bestMoveForThisMove || undefined,
          timeSpent,
          clockRemaining,
          underPressure,
        });

        prevEval = normalizedEval;

        // BATCHING: Only update React state every 5 moves to keep UI responsive
        if (i % 5 === 0 || i === moves.length - 1) {
          setReviewedMoves([...results]);
          setProgress({ current: i + 1, total: parsedGame.moves.length });
        }
      }
    } catch (e) {
      console.error(e);
      setError("Analysis failed. Engine error.");
    } finally {
      setIsAnalyzing(false);
      // Persist results so they survive page refresh
      if (results.length > 0) {
        try { 
          const json = JSON.stringify(results);
          localStorage.setItem(getLSKey(gameId), json); 
          // Persist to server database too
          if (gameId) {
            api.saveGameAnalysis(Number(gameId), results).catch(console.warn);
          }
        } catch { /* storage full */ }
      }
    }
  }, [gameId]);

  const cancelAnalysis = useCallback(() => {
    abortRef.current = true;
    if (engineRef.current) engineRef.current.stop();
  }, []);

  const reset = useCallback(() => {
    setReviewedMoves([]);
    setIsAnalyzing(false);
    setProgress({ current: 0, total: 0 });
    setError(null);
    try { localStorage.removeItem(getLSKey(gameId)); } catch { /* ignore */ }
  }, [gameId]);

  return {
    reviewedMoves,
    isAnalyzing,
    progress,
    error,
    analyzeGame,
    cancelAnalysis,
    reset
  };
}
