// src/components/MoveTickerStrip.tsx
import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../utils/cn';

const GRADE_TEXT: Record<string, string> = {
  blunder:    'text-rose-400',
  mistake:    'text-orange-400',
  inaccuracy: 'text-yellow-300',
  excellent:  'text-cyan-400',
  best:       'text-green-400',
  good:       'text-slate-300',
};

const GRADE_LABEL: Record<string, string> = {
  blunder: '??', mistake: '?', inaccuracy: '?!', excellent: '!', best: '✓',
};

export interface TickerMove {
  idx: number;
  san: string;
  grade?: string;
  moveNumber: number;
  isWhite: boolean;
}

interface MoveTickerStripProps {
  moves: TickerMove[];
  currentIdx: number; // -1 = start position
  onSelect: (idx: number) => void;
  onPrev: () => void;
  onNext: () => void;
  accentColor?: string; // Tailwind active bg class, defaults to indigo
}

export const MoveTickerStrip: React.FC<MoveTickerStripProps> = ({
  moves,
  currentIdx,
  onSelect,
  onPrev,
  onNext,
  accentColor = 'bg-indigo-500/30 ring-indigo-500/50 text-white',
}) => {
  const atStart = currentIdx <= -1;
  const atEnd = currentIdx >= moves.length - 1;

  const activeRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Scroll active chip to center — uses manual scrollLeft to avoid page-level scroll
  useEffect(() => {
    if (activeRef.current && stripRef.current) {
      const strip = stripRef.current;
      const active = activeRef.current;
      const targetLeft =
        active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2;
      strip.scrollTo({ left: targetLeft, behavior: 'smooth' });
    }
  }, [currentIdx]);

  return (
    <div className="shrink-0 flex items-center h-12 bg-[#0a0d14] border-t border-white/5 px-1 gap-1">
      {/* Prev arrow */}
      <button
        onClick={onPrev}
        disabled={atStart}
        className="shrink-0 p-2 rounded-lg text-slate-500 hover:text-white active:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="Previous move"
      >
        <ChevronLeft size={18} />
      </button>

      {/* Scrollable strip */}
      <div
        ref={stripRef}
        className="flex-1 overflow-x-auto flex items-center gap-0.5 scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {moves.length === 0 ? (
          <span className="text-[11px] text-slate-600 px-2 italic">No moves yet</span>
        ) : (
          moves.map((m) => {
            const isActive = currentIdx === m.idx;
            const gradeText = GRADE_TEXT[m.grade ?? ''] ?? 'text-slate-300';
            const gradeLabel = GRADE_LABEL[m.grade ?? ''] ?? '';
            return (
              <React.Fragment key={m.idx}>
                {m.isWhite && (
                  <span className="text-[10px] font-mono text-slate-600 shrink-0 px-0.5 select-none">
                    {m.moveNumber}.
                  </span>
                )}
                <button
                  ref={isActive ? activeRef : undefined}
                  onClick={() => onSelect(m.idx)}
                  className={cn(
                    'shrink-0 px-1.5 py-0.5 rounded text-[12px] font-medium transition-all whitespace-nowrap',
                    isActive
                      ? cn('ring-1 font-bold', accentColor)
                      : cn('hover:bg-white/5', gradeText),
                  )}
                >
                  {m.san}
                  {gradeLabel && (
                    <span className="text-[10px] font-black opacity-80 ml-0.5">{gradeLabel}</span>
                  )}
                </button>
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* Next arrow */}
      <button
        onClick={onNext}
        disabled={atEnd}
        className="shrink-0 p-2 rounded-lg text-slate-500 hover:text-white active:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="Next move"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
};
