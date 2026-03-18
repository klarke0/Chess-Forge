import React, { useEffect, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import {
  CalendarClock, CheckCircle2, AlertCircle, ChevronRight,
  RotateCcw, LifeBuoy, XCircle, Loader2, RefreshCw,
} from 'lucide-react';
import { cn } from '../utils/cn';
import { useSpacedRepetition } from '../hooks/useSpacedRepetition';
import { useRepertoireStore } from '../stores/repertoireStore';

interface ReviewTabProps {
  onClose: () => void;
}

export const ReviewTab: React.FC<ReviewTabProps> = ({ onClose }) => {
  const repertoireSide = useRepertoireStore(s => s.repertoireSide);
  const {
    duePositions,
    currentIndex,
    reviewFen,
    reviewStatus,
    reviewMistakeCount,
    reviewHint,
    reviewArrows,
    isLoading,
    isError,
    doneToday,
    currentPosition,
    onReviewDrop,
    giveUpReview,
    advanceToNext,
    reDrillAll,
    refetch,
  } = useSpacedRepetition();

  // ── Shake animation on wrong move ─────────────────────────────────────────
  const prevMistakeCountRef = useRef(0);
  const [isShaking, setIsShaking] = useState(false);

  useEffect(() => {
    if (reviewMistakeCount > prevMistakeCountRef.current) {
      setIsShaking(true);
      const t = window.setTimeout(() => setIsShaking(false), 500);
      prevMistakeCountRef.current = reviewMistakeCount;
      return () => window.clearTimeout(t);
    }
    prevMistakeCountRef.current = reviewMistakeCount;
  }, [reviewMistakeCount]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="absolute inset-0 bg-[#050507] flex flex-col items-center justify-center gap-4 z-20">
        <Loader2 className="text-indigo-400 animate-spin" size={40} />
        <p className="text-slate-400 text-sm font-semibold uppercase tracking-widest">Loading Review Queue</p>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="absolute inset-0 bg-[#050507] flex flex-col items-center justify-center gap-6 z-20">
        <AlertCircle className="text-rose-400" size={48} />
        <div>
          <p className="text-slate-300 text-lg font-bold text-center">Failed to load review queue</p>
          <p className="text-slate-500 text-sm text-center max-w-xs mt-1">
            Make sure the backend is running:<br />
            <code className="text-indigo-400 text-xs">cd server && bun run dev</code>
          </p>
        </div>
        <button
          onClick={refetch}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all"
        >
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    );
  }

  // ── Empty queue ───────────────────────────────────────────────────────────
  if (duePositions.length === 0) {
    return (
      <div className="absolute inset-0 bg-[#050507] flex flex-col items-center justify-center gap-6 z-20 text-center">
        <CheckCircle2 className="text-emerald-400" size={56} />
        <div>
          <p className="text-2xl font-black text-slate-100">All Clear!</p>
          <p className="text-slate-400 mt-2 text-sm">No positions are due for review today.</p>
          <p className="text-slate-500 mt-1 text-xs">Positions appear here after you drill them in Train mode.</p>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all"
        >
          Back to Training
        </button>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (doneToday) {
    return (
      <div className="absolute inset-0 bg-[#050507] flex flex-col items-center justify-center gap-6 z-20 text-center">
        <CheckCircle2 className="text-emerald-400" size={56} />
        <div>
          <p className="text-2xl font-black text-slate-100">Session Complete</p>
          <p className="text-slate-400 mt-2 text-sm">{duePositions.length} position{duePositions.length !== 1 ? 's' : ''} reviewed</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={reDrillAll}
            className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 text-slate-200 rounded-2xl font-bold transition-all border border-white/10"
          >
            <RotateCcw size={16} />
            Re-Drill All
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all"
          >
            Back to Training
          </button>
        </div>
      </div>
    );
  }

  // ── Active review ─────────────────────────────────────────────────────────
  const statusBorderClass = {
    awaiting_move: 'border-indigo-500/40',
    wrong: 'border-rose-500/40',
    awaiting_next: 'border-emerald-500/40',
    given_up: 'border-amber-500/40',
  }[reviewStatus];

  const statusMessage = {
    awaiting_move: 'Find the repertoire move',
    wrong: `Incorrect — try again${reviewMistakeCount > 1 ? ` (${reviewMistakeCount} attempts)` : ''}`,
    awaiting_next: 'Correct!',
    given_up: 'Answer revealed',
  }[reviewStatus];

  const statusIcon = {
    awaiting_move: <CalendarClock size={16} className="text-indigo-400" />,
    wrong: <XCircle size={16} className="text-rose-400" />,
    awaiting_next: <CheckCircle2 size={16} className="text-emerald-400" />,
    given_up: <LifeBuoy size={16} className="text-amber-400" />,
  }[reviewStatus];

  return (
    <div className="absolute inset-0 bg-[#050507] flex flex-col lg:flex-row z-20 overflow-hidden">
      {/* Left: Board */}
      <div className="flex-1 flex items-center justify-center p-4 lg:p-8">
        <div className="w-[min(85vmin,500px)] h-[min(85vmin,500px)]">
          <div className={cn(
            "w-full h-full rounded-[2rem] overflow-hidden border-[10px] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.6)] transition-colors duration-300",
            isShaking && "animate-shake",
            reviewStatus === 'wrong'        && "border-rose-500/70",
            reviewStatus === 'awaiting_next' && "border-emerald-500/50",
            reviewStatus === 'given_up'      && "border-amber-500/50",
            reviewStatus === 'awaiting_move' && "border-[#161b22]",
          )}>
            {reviewFen && (
              <Chessboard
                position={reviewFen}
                onPieceDrop={reviewStatus === 'awaiting_next' || reviewStatus === 'given_up' ? () => false : onReviewDrop}
                boardOrientation={currentPosition?.side || repertoireSide}
                customDarkSquareStyle={{ backgroundColor: '#1e293b' }}
                customLightSquareStyle={{ backgroundColor: '#475569' }}
                customArrows={reviewArrows as any}
                animationDuration={reviewStatus === 'awaiting_next' ? 0 : 250}
              />
            )}
          </div>
        </div>
      </div>

      {/* Right: Status Panel */}
      <div className="w-full lg:w-[380px] bg-[#0a0d14] border-t lg:border-t-0 lg:border-l border-white/5 flex flex-col p-5 gap-4 shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <CalendarClock size={18} className="text-rose-400" />
            <span className="font-black uppercase tracking-widest text-xs">Review</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors text-xs uppercase tracking-widest"
          >
            Exit
          </button>
        </div>

        {currentPosition?.repertoire_name && (
          <div className="bg-indigo-500/10 border border-indigo-500/20 px-3 py-2 rounded-xl text-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 block mb-0.5">Training Line</span>
            <span className="text-sm font-bold text-slate-200">{currentPosition.repertoire_name}</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-500"
              style={{ width: `${(currentIndex / duePositions.length) * 100}%` }}
            />
          </div>
          <p className="text-slate-500 text-xs">{currentIndex + 1} / {duePositions.length}</p>
        </div>

        {/* Status card */}
        <div className={cn('rounded-[2rem] border p-4 bg-white/[0.02] flex flex-col gap-3', statusBorderClass)}>
          <div className="flex items-center gap-2">
            {statusIcon}
            <span className="text-sm font-bold text-slate-200">{statusMessage}</span>
          </div>

          {reviewHint && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
              <p className="text-amber-300 text-xs font-semibold">{reviewHint}</p>
            </div>
          )}
        </div>

        {/* Position history */}
        {currentPosition && (
          <div className="rounded-[2rem] border border-white/5 p-4 bg-white/[0.02] flex flex-col gap-2">
            <p className="text-slate-500 text-[10px] uppercase tracking-widest font-bold">Position Stats</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-slate-200 font-bold text-lg">{currentPosition.total_attempts}</p>
                <p className="text-slate-500 text-[10px] uppercase tracking-wide">Seen</p>
              </div>
              <div>
                <p className="text-slate-200 font-bold text-lg">{currentPosition.streak}</p>
                <p className="text-slate-500 text-[10px] uppercase tracking-wide">Streak</p>
              </div>
              <div>
                <p className="text-slate-200 font-bold text-lg">
                  {(currentPosition.ease_factor ?? 2.5).toFixed(1)}
                </p>
                <p className="text-slate-500 text-[10px] uppercase tracking-wide">Ease</p>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col gap-2 mt-auto">
          {reviewStatus === 'awaiting_next' || reviewStatus === 'given_up' ? (
            <button
              onClick={advanceToNext}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all w-full"
            >
              <ChevronRight size={18} />
              Next Position
            </button>
          ) : (
            <button
              onClick={giveUpReview}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-2xl font-bold transition-all border border-white/10 w-full"
            >
              <LifeBuoy size={16} />
              {reviewStatus === 'wrong' ? 'Show Answer' : 'Skip / Give Up'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
