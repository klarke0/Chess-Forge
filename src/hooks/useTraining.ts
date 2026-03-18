import { useCallback, useRef, useEffect, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { useTrainingStore } from '../stores/trainingStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useEngineStore } from '../stores/engineStore';
import { useCoachStore } from '../stores/coachStore';
import { useSound } from './useSound';
import * as api from '../services/api';

export function useTraining() {
  const trainingStatus = useTrainingStore(s => s.status);
  const topLines = useEngineStore(s => s.topLines);
  const engineObj = useEngineStore(s => s.engine);
  const evaluate = useEngineStore(s => s.evaluate);
  const showLines = useEngineStore(s => s.showLines);
  const showEvalBar = useEngineStore(s => s.showEvalBar);
  const { playSound } = useSound();

  const gameRef = useRef(new Chess());
  const [boardFen, setBoardFen] = useState(gameRef.current.fen());
  const lastEvalRef = useRef('0.0');
  const analyzedFensRef = useRef<Set<string>>(new Set());
  const sessionRef = useRef<number | null>(null);
  const statsRef = useRef({ drilled: 0, correct: 0, mistakes: 0 });

  const syncFen = useCallback(() => {
    setBoardFen(gameRef.current.fen());
  }, []);

  useEffect(() => {
    const bestLine = topLines[0];
    if (bestLine) {
      lastEvalRef.current = bestLine.mate
        ? `M${bestLine.mate}`
        : bestLine.cp !== null
          ? (bestLine.cp / 100).toFixed(1)
          : '0.0';
    }
  }, [topLines]);

  useEffect(() => {
    const engineEnabled = showLines || showEvalBar;
    if (engineObj && trainingStatus !== 'demo' && engineEnabled) {
      evaluate(boardFen);
    } else if (engineObj && !engineEnabled) {
      engineObj.stop();
    }
  }, [boardFen, engineObj, trainingStatus, showLines, showEvalBar, evaluate]);

  const getFen = useCallback(() => boardFen, [boardFen]);

  const showLearnArrow = useCallback((fen: string) => {
    const rs = useRepertoireStore.getState();
    const { moveHistory } = useTrainingStore.getState();
    const possibleMoves = rs.getCorrectMovesForChapter(fen, moveHistory);
    if (possibleMoves.length === 0) return;

    const targetSan = possibleMoves[0].san;

    try {
      const temp = new Chess(fen);
      const m = temp.move(targetSan);
      if (m) {
        useTrainingStore.getState().setArrows([[m.from as Square, m.to as Square, 'rgba(34,197,94,0.8)']]);
        useTrainingStore.getState().setMessage(`Play the highlighted move: ${targetSan}`);
      }
    } catch { /* ignore */ }
  }, []);

  const advanceStudy = useCallback(() => {
    const ts = useTrainingStore.getState();
    const rs = useRepertoireStore.getState();
    const chapterIdx = rs.selectedChapter;
    const chapter = chapterIdx !== null ? rs.chapters[chapterIdx] : null;
    
    if (!chapter || !chapter.startMoves || ts.studyStep >= chapter.startMoves.length) {
      ts.setStatus('complete');
      ts.setMessage('Guided study completed.');
      ts.setAwaitingNext(false);
      return;
    }

    const nextSan = chapter.startMoves[ts.studyStep];
    const currentFen = gameRef.current.fen();

    try {
      const g = new Chess(currentFen);
      const move = g.move(nextSan);
      if (move) {
        playSound(move.captured ? 'capture' : 'move');
        gameRef.current = g;
        syncFen();
        ts.addToHistory(move.san);
        
        const moves = rs.getCorrectMoves(currentFen);
        const repMove = moves.find(m => m.san === move.san);
        const comment = repMove?.comment;

        if (g.turn() === 'b') ts.addLedgerWhite({ san: move.san, eval: lastEvalRef.current, comment });
        else ts.updateLedgerBlack({ san: move.san, eval: lastEvalRef.current, comment });

        if (comment) {
          useCoachStore.getState().setInsight(comment);
          ts.setMessage(comment);
        } else {
          ts.setMessage(`${move.color === 'w' ? 'White' : 'Black'} played ${move.san}`);
        }

        const nextStep = ts.studyStep + 1;
        ts.setStudyStep(nextStep);
        ts.setAwaitingNext(true);
        
        if (nextStep >= chapter.startMoves.length) {
          ts.setStatus('complete');
        } else {
          ts.setStatus('training');
        }
      } else {
        console.error('[Study] Move was invalid:', nextSan, 'at FEN:', currentFen);
      }
    } catch (e) {
      console.error('[Study] Exception during move:', nextSan, e);
    }
  }, [playSound, syncFen]);

  const computerMove = useCallback((currentFen: string) => {
    const rs = useRepertoireStore.getState();
    const { moveHistory } = useTrainingStore.getState();
    const possibleMoves = rs.getCorrectMovesForChapter(currentFen, moveHistory);
    
    if (possibleMoves.length > 0) {
      const selectedMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
      const g = new Chess(currentFen);
      const move = g.move(selectedMove.san);
      if (move) {
        playSound(move.captured ? 'capture' : 'move');
        gameRef.current = g;
        syncFen();
        const ts = useTrainingStore.getState();
        ts.addToHistory(move.san);
        ts.updateLedgerBlack({ san: move.san, eval: lastEvalRef.current, comment: selectedMove.comment });
        ts.setStatus('training');
        ts.setHint(null);
        
        if (selectedMove.comment) {
          useCoachStore.getState().setInsight(selectedMove.comment);
        } else {
          useCoachStore.getState().setInsight(null);
        }

        if (ts.mode === 'learn') {
          if (ts.learnRunsCompleted === 0) {
            showLearnArrow(g.fen());
          } else if (ts.learnRunsCompleted === 1) {
            ts.setMessage(`Black played ${move.san}. Try to recall the move!`);
            ts.setArrows([]);
          } else {
            ts.setMessage(`Black played ${move.san}. No hints — get it right!`);
            ts.setArrows([]);
          }
        } else {
          ts.setMessage(`Black played ${move.san}. Your turn!`);
          ts.setArrows([]);
        }
      }
    } else {
      const ts = useTrainingStore.getState();
      playSound('check');

      if (ts.mode === 'learn') {
        const newRuns = ts.learnRunsCompleted + 1;
        ts.setLearnRunsCompleted(newRuns);
        ts.setStatus('complete');

        const rs2 = useRepertoireStore.getState();
        if (rs2.selectedChapter !== null && rs2.chapters[rs2.selectedChapter]) {
          const chapterId = rs2.chapters[rs2.selectedChapter].id;
          const currentStored = rs2.chapters[rs2.selectedChapter].learnRuns ?? 0;
          api.updateChapterLearnRuns(chapterId, newRuns).catch(() => {});
          if (newRuns > currentStored) {
            rs2.updateChapterLearnRuns(rs2.selectedChapter, newRuns);
          }
        }

        if (newRuns >= 3) {
          ts.setMessage(`Chapter Mastered! All 3 phases complete.`);
        } else {
          const nextPhase = newRuns === 1 ? 'Hint Phase' : 'Test Phase';
          ts.setMessage(`Phase ${newRuns}/3 complete! Press Proceed for the ${nextPhase}.`);
          ts.setAwaitingNext(true);
        }
      } else if (ts.mode === 'weak' || ts.mode === 'quiz') {
        ts.setStatus('complete');
        ts.setMessage(`${ts.mode === 'weak' ? 'Weak Spot' : 'Challenge'} resolved! Press Proceed for the next one.`);
        ts.setAwaitingNext(true);
      } else {
        ts.setStatus('complete');
        ts.setMessage('Excellent! Line completed according to the master repertoire.');
      }

      if (sessionRef.current) {
        const s = statsRef.current;
        api.endSession(sessionRef.current, {
          positionsDrilled: s.drilled,
          correctCount: s.correct,
          mistakeCount: s.mistakes,
        }).catch(() => {});
        sessionRef.current = null;
      }
    }
  }, [playSound, syncFen, showLearnArrow]);

  useEffect(() => {
    if (trainingStatus !== 'correct') return;
    const timer = setTimeout(() => {
      if (useTrainingStore.getState().status === 'correct') {
        computerMove(gameRef.current.fen());
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [trainingStatus, computerMove]);

  const startTraining = useCallback((chapterIdx?: number, preserveLearnProgress = false) => {
    try {
      const ts = useTrainingStore.getState();
      const rs = useRepertoireStore.getState();
      ts.resetSession();
      useCoachStore.getState().clearInsight();

      let currentLearnRuns = ts.learnRunsCompleted;
      if (ts.mode === 'learn' && !preserveLearnProgress) {
        const stored = (chapterIdx !== undefined && rs.chapters[chapterIdx])
          ? (rs.chapters[chapterIdx].learnRuns ?? 0)
          : 0;
        currentLearnRuns = stored >= 3 ? 0 : stored;
        ts.setLearnRunsCompleted(currentLearnRuns);
      }

      if (ts.mode === 'weak' || ts.mode === 'quiz') {
        const isWhiteRep = rs.repertoireSide === 'white';
        const allFens = Object.keys(rs.positions).filter(fen => 
          fen.includes(isWhiteRep ? ' w ' : ' b ')
        );
        let targetFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        
        if (allFens.length > 0) {
          if (ts.mode === 'weak') {
            const weakFens = Object.keys(rs.weakPositions).filter(fen => 
              fen.includes(isWhiteRep ? ' w ' : ' b ')
            );
            targetFen = weakFens.length > 0 
              ? weakFens[Math.floor(Math.random() * weakFens.length)]
              : allFens[Math.floor(Math.random() * allFens.length)];
          } else {
            targetFen = allFens[Math.floor(Math.random() * allFens.length)];
          }
        }

        const g = new Chess(targetFen);
        gameRef.current = g;
        syncFen();
        ts.setStatus('training');
        
        const modeName = ts.mode === 'weak' ? 'Weak Spot' : 'Random Challenge';
        const instruction = g.turn() === 'w' 
          ? 'Find the best move for White.' 
          : 'Wait for the opponent, then respond.';
        
        ts.setMessage(`${modeName} Loaded. ${instruction}`);
        ts.setAwaitingNext(false);
        
        if (g.turn() === 'b') {
          computerMove(targetFen);
        }
        return;
      }

      if (ts.mode === 'study') {
        const g = new Chess();
        gameRef.current = g;
        syncFen();
        ts.setStudyStep(0);
        ts.setStatus('training');
        
        let chapterName = 'Opening';
        if (chapterIdx !== undefined) {
          rs.selectChapter(chapterIdx);
          const chapter = rs.chapters[chapterIdx];
          if (chapter) {
            chapterName = chapter.name;
          }
        }
        
        ts.setMessage(`Guided Study: ${chapterName}. Press Proceed to start.`);
        ts.setAwaitingNext(true);
        rs.setShowChapters(false);
        return;
      }

      const g = new Chess();
      let moveList: string[] = [];

      if (chapterIdx !== undefined) {
        rs.selectChapter(chapterIdx);
        const chapter = rs.chapters[chapterIdx];
        if (chapter?.startMoves && chapter.startMoves.length > 0) {
          for (let i = 0; i < chapter.startMoves.length; i++) {
            try {
              const m = g.move(chapter.startMoves[i]);
              if (m) moveList.push(m.san);
            } catch { break; }
          }
        }
      }

      if (moveList.length === 0) {
        const first = (rs.repertoireSide === 'black') ? 'e4' : 'd4';
        try {
          const m = g.move(first);
          if (m) moveList.push(m.san);
        } catch { /* ignore */ }
      }
      
      gameRef.current = g;
      syncFen();

      ts.resetSession();
      let currentSetupFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      moveList.forEach((san, i) => {
        const movesAtThisFen = rs.getCorrectMoves(currentSetupFen);
        const setupMove = movesAtThisFen.find(m => m.san === san);
        const comment = setupMove?.comment;

        ts.addToHistory(san);
        if (i % 2 === 0) ts.addLedgerWhite({ san, eval: '0.0', comment });
        else ts.updateLedgerBlack({ san, eval: '0.0', comment });

        try {
          const tempG = new Chess(currentSetupFen);
          const m = tempG.move(san);
          if (m) currentSetupFen = tempG.fen();
        } catch { /* ignore */ }
      });

      ts.setStatus('training');
      
      const isUserTurn = (g.turn() === 'w' && rs.repertoireSide === 'white') || (g.turn() === 'b' && rs.repertoireSide === 'black');
      const lastMove = moveList.length > 0 ? moveList[moveList.length - 1] : '';

      if (isUserTurn) {
        if (ts.mode === 'learn') {
          if (currentLearnRuns === 0) {
            showLearnArrow(g.fen());
          } else if (currentLearnRuns === 1) {
            ts.setMessage('Hint phase — try to recall. Arrow shows on mistakes.');
          } else {
            ts.setMessage('Test phase — no hints! Get every move right.');
          }
        } else {
          ts.setMessage(lastMove ? `Line followed to ${lastMove}. Your turn!` : 'Board reset. Your turn!');
        }
        ts.setAwaitingNext(false);
      } else {
        const possibleMoves = rs.getCorrectMovesForChapter(g.fen(), ts.moveHistory);
        if (possibleMoves.length > 0) {
          ts.setMessage(lastMove ? `${lastMove} played. Press Proceed for opponent response.` : 'Press Proceed for opponent move.');
          ts.setAwaitingNext(true);
        } else {
          ts.setStatus('complete');
          ts.setMessage('Guided line completed.');
          ts.setAwaitingNext(false);
        }
      }

      rs.setShowChapters(false);
      playSound('move');

      statsRef.current = { drilled: 0, correct: 0, mistakes: 0 };
      api.startSession(rs.repertoireId).then(res => { sessionRef.current = res.id; }).catch(() => {});
    } catch (e) {
      console.error('[Training] Critical error in startTraining:', e);
    }
  }, [computerMove, playSound, showLearnArrow, syncFen]);

  const restartChapter = useCallback(() => {
    const rs = useRepertoireStore.getState();
    startTraining(rs.selectedChapter ?? undefined);
  }, [startTraining]);

  const stepBackward = useCallback(() => {
    const ts = useTrainingStore.getState();
    const { moveHistory, mode } = ts;
    if (moveHistory.length === 0) return;

    // In study/explore mode, we go back 1 move. In training, we go back 2 (user + cpu).
    const popCount = (mode === 'study' || mode === 'explore') ? 1 : 2;
    if (moveHistory.length < popCount) return;

    for (let i = 0; i < popCount; i++) {
      ts.undo();
    }

    const { moveHistory: newHistory } = useTrainingStore.getState();
    const tempGame = new Chess();
    for (const m of newHistory) tempGame.move(m);

    gameRef.current = tempGame;
    syncFen();
    useCoachStore.getState().setDemoLine([]);
  }, [syncFen]);

  const playRepertoireMove = useCallback((san: string) => {
    const ts = useTrainingStore.getState();
    if (ts.status === 'demo') return;
    try {
      const g = new Chess(gameRef.current.fen());
      const move = g.move(san);
      if (!move) return;
      playSound(move.captured ? 'capture' : 'move');
      gameRef.current = g;
      syncFen();
      ts.addToHistory(move.san);
      ts.setArrows([]);
      useCoachStore.getState().setInsight(null);
    } catch { /* ignore invalid moves */ }
  }, [playSound, syncFen]);

  const playMainline = useCallback(async () => {
    if (useTrainingStore.getState().status === 'demo') return;
    const rs = useRepertoireStore.getState();
    const line: string[] = [];
    const tempGame = new Chess(gameRef.current.fen());
    let safety = 0;
    while (safety < 60) {
      const moves = rs.getCorrectMoves(tempGame.fen());
      if (moves.length === 0) break;
      try {
        const m = tempGame.move(moves[0].san);
        if (!m) break;
        line.push(m.san);
      } catch { break; }
      safety++;
    }
    if (line.length === 0) return;

    const originalFen = gameRef.current.fen();
    const demoGame = new Chess(originalFen);
    useTrainingStore.getState().setStatus('demo');

    for (const moveSan of line) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      try {
        const m = demoGame.move(moveSan);
        if (m) {
          gameRef.current = new Chess(demoGame.fen());
          syncFen();
          playSound(m.captured ? 'capture' : 'move');
          useTrainingStore.getState().setArrows([
            [m.from as Square, m.to as Square, 'rgba(99,102,241,0.8)'],
          ]);
        }
      } catch (e) {
        console.error('Demo move failed:', moveSan, e);
        break;
      }
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    gameRef.current = new Chess(originalFen);
    syncFen();
    useTrainingStore.getState().setArrows([]);
    useTrainingStore.getState().setStatus('training');
  }, [playSound, syncFen]);

  const demoEngineLine = useCallback(async (pv: string) => {
    const ts = useTrainingStore.getState();
    if (ts.status === 'demo' || ts.status === 'simulating') return;
    
    const uciMoves = pv.split(' ').filter(Boolean);
    const sanMoves: string[] = [];
    const tempGame = new Chess(gameRef.current.fen());
    for (const uci of uciMoves) {
      if (uci.length < 4) break;
      try {
        const m = tempGame.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
        if (!m) break;
        sanMoves.push(m.san);
      } catch { break; }
    }
    if (sanMoves.length === 0) return;

    const originalFen = gameRef.current.fen();
    const demoGame = new Chess(originalFen);
    ts.setStatus('simulating');

    for (const moveSan of sanMoves) {
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
      try {
        const m = demoGame.move(moveSan);
        if (m) {
          gameRef.current = new Chess(demoGame.fen());
          syncFen();
          playSound(m.captured ? 'capture' : 'move');
          ts.setArrows([
            [m.from as Square, m.to as Square, 'rgba(234,179,8,0.8)'],
          ]);
        }
      } catch (e) {
        break;
      }
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    gameRef.current = new Chess(originalFen);
    syncFen();
    ts.setArrows([]);
    ts.setStatus('training');
  }, [playSound, syncFen]);

  const previewEngineLine = useCallback((pv: string) => {
    const ts = useTrainingStore.getState();
    if (ts.status === 'demo' || ts.status === 'simulating') return;

    const uciMove = pv.split(' ')[0];
    if (!uciMove || uciMove.length < 4) return;
    try {
      const tempGame = new Chess(gameRef.current.fen());
      const m = tempGame.move({ from: uciMove.slice(0, 2), to: uciMove.slice(2, 4), promotion: uciMove[4] || undefined });
      if (m) {
        setBoardFen(tempGame.fen());
        ts.setArrows([
          [m.from as Square, m.to as Square, 'rgba(234,179,8,0.6)'],
        ]);
      }
    } catch { /* ignore */ }
  }, []);

  const stopPreview = useCallback(() => {
    const ts = useTrainingStore.getState();
    if (ts.status === 'demo' || ts.status === 'simulating') return;
    setBoardFen(gameRef.current.fen());
    ts.setArrows([]);
  }, []);

  const handleNext = useCallback(() => {
    const ts = useTrainingStore.getState();
    if (ts.mode === 'learn' && ts.status === 'complete' && ts.learnRunsCompleted < 3) {
      const rs = useRepertoireStore.getState();
      startTraining(rs.selectedChapter ?? undefined, true);
      return;
    }
    
    if (ts.mode === 'learn' && ts.status === 'complete') return;

    if (ts.status === 'complete' && (ts.mode === 'weak' || ts.mode === 'quiz')) {
      startTraining();
      return;
    }

    if (ts.mode === 'study') {
      advanceStudy();
      return;
    }

    ts.setAwaitingNext(false);
    computerMove(gameRef.current.fen());
  }, [computerMove, startTraining, advanceStudy]);

  const onDrop = useCallback((sourceSquare: string, targetSquare: string): boolean => {
    const ts = useTrainingStore.getState();
    const { status, awaitingNext, mistakeCount } = ts;
    if (status === 'demo') return false;

    // Explore mode: allow any legal move freely, no validation, no computer response
    if (ts.mode === 'explore') {
      try {
        const g = new Chess(gameRef.current.fen());
        const move = g.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
        if (!move) return false;
        playSound(move.captured ? 'capture' : 'move');
        gameRef.current = g;
        syncFen();
        ts.addToHistory(move.san);
        ts.setArrows([]);
        useCoachStore.getState().setInsight(null);
        return true;
      } catch { return false; }
    }

    if (status === 'idle' || status === 'complete' || awaitingNext || status === 'correct' || ts.mode === 'study') return false;

    try {
      const g = new Chess(gameRef.current.fen());
      const move = g.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
      if (!move) return false;

      const currentFen = gameRef.current.fen();
      const possibleMoves = useRepertoireStore.getState().getCorrectMovesForChapter(currentFen, ts.moveHistory);
      const repertoireMove = possibleMoves.find((m) => m.san === move.san);

      if (repertoireMove) {
        playSound(move.captured ? 'capture' : 'move');
        gameRef.current = g;
        syncFen();
        ts.addToHistory(move.san);
        ts.addLedgerWhite({ san: move.san, eval: lastEvalRef.current, comment: repertoireMove.comment });
        ts.setStatus('correct');
        
        if (repertoireMove.comment) {
          ts.setMessage(repertoireMove.comment);
          useCoachStore.getState().setInsight(repertoireMove.comment);
        } else {
          ts.setMessage('Correct. Perfectly in line with the repertoire.');
          useCoachStore.getState().setInsight("No specific annotation for this move. Request 'Deep Analysis' for a strategic breakdown.");
        }
        ts.setArrows([]);

        statsRef.current.drilled++;
        statsRef.current.correct++;
        api.recordAttempt(useRepertoireStore.getState().repertoireId, { fen: currentFen, correct: true }).catch(() => {});
        return true;
      } else {
        if (ts.mode === 'learn') {
          playSound('wrong');
          ts.setStatus('wrong');
          if (ts.learnRunsCompleted < 2) {
            showLearnArrow(currentFen);
            if (ts.learnRunsCompleted === 1) {
              ts.setMessage('Not quite! Follow the arrow.');
            }
          } else {
            ts.setArrows([]);
            ts.setMessage('Wrong — no hints in test phase! Try again.');
          }
          return false;
        }

        const bestLine = useEngineStore.getState().topLines[0];
        const engineScore = bestLine?.cp || 0;
        const isActuallyGood = engineScore > 50;

        if (isActuallyGood && mistakeCount === 0) {
          ts.setStatus('novelty');
          ts.setMessage(
            `Interesting Novelty! ${move.san} is engine-approved, but the repertoire prefers something else.`
          );
          useCoachStore.getState().setInsight(
            'You found a strong alternative. Stockfish likes this, but the repertoire emphasizes different practical themes here.'
          );
          useRepertoireStore.getState().recordMistake(currentFen);
          return false;
        }

        playSound('wrong');
        ts.incrementMistake();
        useRepertoireStore.getState().recordMistake(currentFen);
        ts.setStatus('wrong');
        const repName = useRepertoireStore.getState().repertoireName;
        ts.setMessage(`Incorrect. ${move.san} deviates from the ${repName} line.`);

        statsRef.current.drilled++;
        statsRef.current.mistakes++;
        api.recordAttempt(useRepertoireStore.getState().repertoireId, { fen: currentFen, correct: false }).catch(() => {});

        if (mistakeCount >= 1) {
          const correct = possibleMoves[0];
          if (correct) {
            ts.setHint(`Repertoire move: ${correct.san}`);
          }
        }
        return false;
      }
    } catch {
      return false;
    }
  }, [playSound, syncFen, showLearnArrow]);

  const goBack = useCallback(() => {
    const ts = useTrainingStore.getState();
    const { moveHistory } = ts;
    if (moveHistory.length <= 1) return;

    const newHistory = moveHistory.slice(0, -2);
    const tempGame = new Chess();
    for (const m of newHistory) tempGame.move(m);

    gameRef.current = tempGame;
    syncFen();
    ts.popMoves();
    ts.setStatus('training');
    ts.setAwaitingNext(false);
    useCoachStore.getState().setDemoLine([]);
    ts.setArrows([]);
  }, [syncFen]);

  const playDemo = useCallback(async () => {
    const { demoLine } = useCoachStore.getState();
    if (demoLine.length === 0) return;

    const originalFen = gameRef.current.fen();
    const demoGame = new Chess(originalFen);
    const ts = useTrainingStore.getState();
    ts.setStatus('demo');

    for (const moveSan of demoLine) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const m = demoGame.move(moveSan);
        if (m) {
          gameRef.current = new Chess(demoGame.fen());
          syncFen();
          playSound(m.captured ? 'capture' : 'move');
          useTrainingStore.getState().setArrows([
            [m.from as Square, m.to as Square, 'rgba(99, 102, 241, 0.8)'],
          ]);
        }
      } catch (e) {
        console.error('Demo move failed:', moveSan, e);
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
    gameRef.current = new Chess(originalFen);
    syncFen();
    const ts2 = useTrainingStore.getState();
    ts2.setArrows([]);
    ts2.setStatus('training');
  }, [playSound, syncFen]);

  const handleDeepAnalysis = useCallback(async () => {
    const currentFen = gameRef.current.fen();
    if (analyzedFensRef.current.has(currentFen)) return;
    
    const { moveHistory } = useTrainingStore.getState();
    const lastMove = moveHistory[moveHistory.length - 1] || 'Start';
    const turn = gameRef.current.turn() === 'w' ? 'White' : 'Black';

    const rs = useRepertoireStore.getState();

    // Get the comment from the last move played
    const temp = new Chess(currentFen);
    const lastMoveObj = temp.undo();
    let repertoireComment = undefined;
    if (lastMoveObj) {
      const fenBefore = temp.fen();
      const moves = rs.getCorrectMoves(fenBefore);
      const repMove = moves.find(m => m.san === lastMoveObj.san);
      repertoireComment = repMove?.comment;
    }

    // Get the repertoire's correct next moves FROM the current position
    // so the AI can stay anchored to the repertoire rather than suggesting arbitrary engine lines
    const repertoireMoves = rs.getCorrectMoves(currentFen).map(m => m.san);

    const mode = useTrainingStore.getState().mode;
    const userColor = useRepertoireStore.getState().repertoireSide;
    
    analyzedFensRef.current.add(currentFen);
    await useCoachStore.getState().analyzePosition(currentFen, lastMove, turn, undefined, repertoireComment, userColor, mode, repertoireMoves);

    const { demoLine } = useCoachStore.getState();
    if (demoLine.length > 0) {
      try {
        const temp = new Chess(gameRef.current.fen());
        const first = temp.move(demoLine[0]);
        if (first) {
          useTrainingStore.getState().setArrows([
            [first.from as Square, first.to as Square, '#6366f1'],
          ]);
        }
      } catch { /* ignore */ }
    }
  }, []);

  const resetGame = useCallback(() => {
    gameRef.current = new Chess();
    syncFen();
    analyzedFensRef.current.clear();
    useTrainingStore.getState().reset();
    useCoachStore.getState().clearInsight();
  }, [syncFen]);

  const jumpToMove = useCallback((flatMoveIdx: number) => {
    const { moveHistory } = useTrainingStore.getState();
    const rs = useRepertoireStore.getState();
    const ts = useTrainingStore.getState();

    const movesToPlay = moveHistory.slice(0, flatMoveIdx + 1);
    const g = new Chess();
    for (const san of movesToPlay) {
      try { g.move(san); } catch { break; }
    }

    gameRef.current = g;
    syncFen();
    ts.setHint(null);
    ts.setArrows([]);

    const isUserTurn = (g.turn() === 'w' && rs.repertoireSide === 'white') ||
                       (g.turn() === 'b' && rs.repertoireSide === 'black');
    if (isUserTurn) {
      ts.setStatus('training');
      ts.setAwaitingNext(false);
      ts.setMessage('Position selected. Your turn!');
    } else {
      ts.setStatus('training');
      ts.setAwaitingNext(true);
      ts.setMessage('Position selected. Press Proceed for opponent response.');
    }
  }, [syncFen]);

  const jumpToPosition = useCallback((targetFen: string) => {
    try {
      const g = new Chess(targetFen);
      gameRef.current = g;
      syncFen();
      const ts = useTrainingStore.getState();
      ts.reset();
      
      ts.setStatus('training');
      ts.setMessage(`Training from selected position.`);
      ts.setAwaitingNext(false);
      
      if (g.turn() === 'b') {
        computerMove(targetFen);
      }
      
      playSound('move');
    } catch (e) {
      console.error('Failed to jump to position:', e);
    }
  }, [computerMove, playSound, syncFen]);

  const showSolution = useCallback(() => {
    const currentFen = gameRef.current.fen();
    const { moveHistory } = useTrainingStore.getState();
    const possibleMoves = useRepertoireStore.getState().getCorrectMovesForChapter(currentFen, moveHistory);
    if (possibleMoves.length > 0) {
      const solution = possibleMoves[0];
      const ts = useTrainingStore.getState();
      const temp = new Chess(currentFen);
      const move = temp.move(solution.san);
      if (move) {
        ts.setArrows([[move.from as Square, move.to as Square, 'rgba(245, 158, 11, 0.8)']]);
        ts.setHint(`Correct move: ${solution.san}`);
      }
    }
  }, []);

  const giveUp = useCallback(() => {
    const currentFen = gameRef.current.fen();
    const { moveHistory } = useTrainingStore.getState();
    const possibleMoves = useRepertoireStore.getState().getCorrectMovesForChapter(currentFen, moveHistory);
    if (possibleMoves.length > 0) {
      const solution = possibleMoves[0];
      const ts = useTrainingStore.getState();
      
      statsRef.current.drilled++;
      statsRef.current.mistakes++;
      api.recordAttempt(useRepertoireStore.getState().repertoireId, { fen: currentFen, correct: false }).catch(() => {});
      useRepertoireStore.getState().recordMistake(currentFen);

      const temp = new Chess(currentFen);
      const move = temp.move(solution.san);
      if (move) {
        ts.setArrows([[move.from as Square, move.to as Square, 'rgba(245, 158, 11, 0.8)']]);
        ts.setMessage(`Solution: ${solution.san}. Press Proceed to continue.`);
        ts.setAwaitingNext(true);
        ts.setStatus('wrong');
        
        gameRef.current = temp;
        syncFen();
        ts.addToHistory(solution.san);
        ts.addLedgerWhite({ san: solution.san, eval: '??' });
        playSound('move');
      }
    }
  }, [playSound, syncFen]);

  return {
    getFen,
    onDrop,
    handleNext,
    startTraining,
    goBack,
    playDemo,
    handleDeepAnalysis,
    resetGame,
    jumpToPosition,
    jumpToMove,
    showSolution,
    giveUp,
    restartChapter,
    stepBackward,
    playRepertoireMove,
    playMainline,
    demoEngineLine,
    previewEngineLine,
    stopPreview,
  };
}
