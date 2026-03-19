import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { ArrowLeft, Check, X, Eye, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useRepertoireStore } from '@/stores/repertoireStore';
import { request } from '@/services/api';
import { BlunderExplanation } from './BlunderExplanation';

type SessionState = 'idle' | 'loading' | 'queued' | 'drilling' | 'explanation' | 'complete';

interface TrainPosition {
  id: string;
  fen: string;
  correctSan: string;
  context?: string;
  cpLoss?: number;
  phase?: string;
}

interface SessionStats {
  total: number;
  correct: number;
  revealed: number;
}

interface TrainNowScreenProps {
  onBack: () => void;
}

// Strip check/capture noise for loose SAN comparison
function looseSan(san: string) {
  return san.replace(/[+#x]/g, '').trim();
}


export const TrainNowScreen: React.FC<TrainNowScreenProps> = ({ onBack }) => {
  const repertoireId = useRepertoireStore(s => s.repertoireId);

  const [state, setState] = useState<SessionState>('idle');
  const [positions, setPositions] = useState<TrainPosition[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [mistakes, setMistakes] = useState(0);
  const [wrongMove, setWrongMove] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [stats, setStats] = useState<SessionStats>({ total: 0, correct: 0, revealed: 0 });

  const chessRef = useRef(new Chess());
  const currentPosition = positions[currentIdx] ?? null;

  // Board orientation follows whose turn it is in the FEN
  const boardOrientation = (fen.split(' ')[1] ?? 'w') === 'w' ? 'white' : 'black';

  useEffect(() => {
    loadSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSession() {
    setState('loading');
    try {
      const data = await request<{ positions: TrainPosition[] }>(
        `/v2/train-now?repertoireId=${repertoireId}`
      );
      if (data.positions.length === 0) {
        setState('complete');
        setStats({ total: 0, correct: 0, revealed: 0 });
        return;
      }
      setPositions(data.positions);
      setStats({ total: data.positions.length, correct: 0, revealed: 0 });
      setState('queued');
    } catch {
      setState('complete');
      setStats({ total: 0, correct: 0, revealed: 0 });
    }
  }

  function startDrilling() {
    if (positions.length === 0) return;
    // Find first drillable position
    const first = positions.findIndex(p => p.correctSan && p.correctSan.trim());
    if (first === -1) { setState('complete'); return; }
    setCurrentIdx(first);
    setupPosition(positions[first]);
    setState('drilling');
  }

  function setupPosition(pos: TrainPosition) {
    chessRef.current = new Chess(pos.fen);
    setFen(pos.fen);
    setMistakes(0);
    setWrongMove(null);
    setRevealed(false);
  }

const onDrop = useCallback((source: string, target: string) => {
    if (state !== 'drilling' || !currentPosition) return false;

    const chess = new Chess(fen);
    let move;
    try {
      move = chess.move({ from: source, to: target, promotion: 'q' });
    } catch {
      return false;
    }
    if (!move) return false;

    // Compare by from/to squares — avoids notation mismatches (+, #, x, disambiguation)
    let isCorrect = false;
    try {
      const refChess = new Chess(currentPosition.fen);
      const refMove = refChess.move(currentPosition.correctSan);
      if (refMove) {
        isCorrect = move.from === refMove.from && move.to === refMove.to;
      }
    } catch {
      // Fallback: loose SAN comparison
      isCorrect = looseSan(move.san) === looseSan(currentPosition.correctSan);
    }

    if (isCorrect) {
      setFen(chess.fen());
      if (mistakes === 0) {
        setStats(s => ({ ...s, correct: s.correct + 1 }));
      }
      setWrongMove(null);
      recordAttempt(currentPosition.fen, true, mistakes === 0 ? 5 : 3);
      setState('explanation');
      return true;
    }

    // Wrong move
    setWrongMove(move.san);
    const newMistakes = mistakes + 1;
    setMistakes(newMistakes);

    // Shake feedback
    setShaking(true);
    setTimeout(() => setShaking(false), 500);

    if (newMistakes >= 2) {
      // Reveal after 2nd miss
      recordAttempt(currentPosition.fen, false, 1);
      setRevealed(true);
      setStats(s => ({ ...s, revealed: s.revealed + 1 }));
      setState('explanation');
    }

    return false;
  }, [state, currentPosition, fen, mistakes]);

  function recordAttempt(positionFen: string, correct: boolean, grade: number) {
    if (!repertoireId) return;
    request('/progress/record', {
      method: 'POST',
      body: JSON.stringify({ repertoireId, fen: positionFen, correct, grade }),
    }).catch(() => {}); // fire-and-forget
  }

  function handleNext() {
    // Find next drillable position (skip any with missing correctSan)
    let nextIdx = currentIdx + 1;
    while (nextIdx < positions.length && (!positions[nextIdx].correctSan || !positions[nextIdx].correctSan.trim())) {
      nextIdx++;
    }
    if (nextIdx >= positions.length) {
      setState('complete');
      return;
    }
    setCurrentIdx(nextIdx);
    setupPosition(positions[nextIdx]);
    setState('drilling');
  }

  function handleReveal() {
    if (currentPosition) {
      recordAttempt(currentPosition.fen, false, 1);
      // Play the correct move so the board shows where the piece goes
      try {
        const chess = new Chess(currentPosition.fen);
        const move = chess.move(currentPosition.correctSan);
        if (move) setFen(chess.fen());
      } catch { /* ignore parse errors */ }
    }
    setRevealed(true);
    setStats(s => ({ ...s, revealed: s.revealed + 1 }));
    setState('explanation');
  }

  const accuracy = stats.total > 0
    ? Math.round((stats.correct / stats.total) * 100)
    : 0;

  // Estimated time: ~1.5 min per position
  const estMinutes = Math.max(1, Math.round(positions.length * 1.5));

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-base)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#0a0d14] border-b border-white/5 shrink-0">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-xl text-slate-400 hover:text-white transition-all active:scale-95"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-black text-slate-200 uppercase tracking-wider">
            {state === 'complete' ? 'Session Complete' : 'Training'}
          </h2>
          {state === 'drilling' && positions.length > 0 && (
            <p className="text-[10px] text-slate-500 font-semibold">
              {currentIdx + 1} / {positions.length}
            </p>
          )}
        </div>
        {state === 'drilling' && (
          <div className="flex gap-1">
            {positions.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'w-1.5 h-1.5 rounded-full transition-all',
                  i < currentIdx ? 'bg-emerald-500' :
                  i === currentIdx ? 'bg-indigo-400 w-3' :
                  'bg-white/10',
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">

        {/* LOADING state */}
        {state === 'loading' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <Loader2 size={32} className="text-indigo-400 animate-spin" />
            <p className="text-sm text-slate-400 font-semibold animate-pulse">
              Building your session...
            </p>
          </div>
        )}

        {/* QUEUED state */}
        {state === 'queued' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
            <div className="text-center">
              <p className="text-3xl font-black text-slate-100">
                {positions.length} positions
              </p>
              <p className="text-sm text-slate-500 mt-1">
                ~{estMinutes} min
              </p>
            </div>
            <button
              onClick={startDrilling}
              className={cn(
                'w-full max-w-xs flex items-center justify-center gap-3',
                'bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]',
                'text-white font-black text-lg uppercase tracking-widest',
                'py-5 rounded-2xl transition-all',
                'shadow-xl shadow-indigo-600/30',
                'border border-indigo-400/20',
              )}
            >
              Start
            </button>
          </div>
        )}

        {/* DRILLING state */}
        {state === 'drilling' && currentPosition && (
          <>
            {/* Context line */}
            {currentPosition.context && (
              <p className="text-xs text-slate-500 px-4 py-2 bg-[#0a0d14] border-b border-white/5">
                {currentPosition.context}
              </p>
            )}

            {/* Board */}
            <div className={cn(
              'flex-1 flex items-center justify-center p-4',
              shaking && 'animate-shake',
            )}>
              <div className="w-full max-w-[90vw] aspect-square max-h-[60vh] rounded-xl overflow-hidden border-[6px] border-[#161b22] bg-[#161b22] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)]">
                <Chessboard
                  position={fen}
                  onPieceDrop={onDrop}
                  boardOrientation={boardOrientation}
                  animationDuration={150}
                  customDarkSquareStyle={{ backgroundColor: '#1e293b' }}
                  customLightSquareStyle={{ backgroundColor: '#475569' }}
                />
              </div>
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between px-6 py-3 bg-[#0a0d14] border-t border-white/5 shrink-0">
              {mistakes > 0 && !revealed && (
                <div className="flex items-center gap-2 text-sm">
                  <X size={14} className="text-rose-400" />
                  <span className="text-rose-400 font-semibold">
                    {mistakes === 1 ? 'Try again — 1 more attempt' : ''}
                  </span>
                </div>
              )}
              {mistakes === 0 && (
                <p className="text-xs text-slate-500">Find the best move</p>
              )}
              <button
                onClick={handleReveal}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-all ml-auto"
              >
                <Eye size={14} />
                <span className="font-semibold">Show</span>
              </button>
            </div>
          </>
        )}

        {/* EXPLANATION state */}
        {state === 'explanation' && currentPosition && (
          <>
            {/* Board (static) */}
            <div className="flex items-center justify-center p-4">
              <div className="w-full max-w-[70vw] aspect-square max-h-[40vh] rounded-xl overflow-hidden border-[6px] border-[#161b22] bg-[#161b22]">
                <Chessboard
                  position={fen}
                  boardOrientation={boardOrientation}
                  arePiecesDraggable={false}
                  animationDuration={0}
                  customDarkSquareStyle={{ backgroundColor: '#1e293b' }}
                  customLightSquareStyle={{ backgroundColor: '#475569' }}
                />
              </div>
            </div>

            {/* Correct indicator */}
            {!revealed && (
              <div className="flex items-center gap-2 px-6 py-2 text-emerald-400">
                <Check size={18} />
                <span className="text-sm font-black uppercase tracking-wider">Correct</span>
              </div>
            )}
            {revealed && (
              <div className="flex items-center gap-2 px-6 py-2 text-amber-400">
                <Eye size={18} />
                <span className="text-sm font-black uppercase tracking-wider">
                  Answer: {currentPosition.correctSan}
                </span>
              </div>
            )}

            <BlunderExplanation
              fen={currentPosition.fen}
              wrongMove={wrongMove}
              correctMove={currentPosition.correctSan}
              cpLoss={currentPosition.cpLoss ?? null}
              phase={currentPosition.phase}
              revealed={revealed}
              onNext={handleNext}
            />
          </>
        )}

        {/* COMPLETE state */}
        {state === 'complete' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 pb-24">
            {stats.total === 0 ? (
              <>
                <p className="text-xl font-black text-slate-300">Nothing to train</p>
                <p className="text-sm text-slate-500 text-center">
                  Import some games or wait for positions to become due.
                </p>
              </>
            ) : (
              <>
                <div className="text-center">
                  <p className="text-4xl font-black text-slate-100 mb-1">{accuracy}%</p>
                  <p className="text-sm text-slate-500">accuracy</p>
                </div>

                <div className="grid grid-cols-3 gap-6 text-center">
                  <div>
                    <p className="text-2xl font-black text-slate-200">{stats.total}</p>
                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">drilled</p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-emerald-400">{stats.correct}</p>
                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">correct</p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-amber-400">{stats.revealed}</p>
                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">revealed</p>
                  </div>
                </div>

                <p className="text-lg font-black text-slate-300 mt-4">Great work</p>
              </>
            )}

            <button
              onClick={onBack}
              className={cn(
                'px-8 py-3 rounded-xl',
                'bg-white/5 border border-white/10',
                'text-slate-300 font-semibold text-sm',
                'hover:bg-white/10 transition-all active:scale-[0.98]',
              )}
            >
              Back to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
