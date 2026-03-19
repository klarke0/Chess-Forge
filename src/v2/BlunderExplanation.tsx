import React, { useEffect, useState } from 'react';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/utils/cn';
import { request } from '@/services/api';

interface BlunderExplanationProps {
  fen: string;
  wrongMove: string | null;
  correctMove: string;
  cpLoss: number | null;
  phase?: string;
  onNext: () => void;
}

interface BlunderAnalysis {
  concept: string;
  analysis: string;
}

export const BlunderExplanation: React.FC<BlunderExplanationProps> = ({
  fen,
  wrongMove,
  correctMove,
  cpLoss,
  phase,
  onNext,
}) => {
  const [analysis, setAnalysis] = useState<BlunderAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    setAnalysis(null);

    request<BlunderAnalysis>('/analyze/blunder', {
      method: 'POST',
      body: JSON.stringify({ fen, wrongMove, correctMove, cpLoss, phase }),
    })
      .then(setAnalysis)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [fen, wrongMove, correctMove, cpLoss, phase]);

  return (
    <div className="flex flex-col gap-4 p-6 bg-[#0d1117] border-t border-white/5">
      {/* Move comparison */}
      <div className="flex items-center gap-3 text-sm">
        {wrongMove && (
          <span className="flex items-center gap-1.5 text-rose-400 font-mono font-bold">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            {wrongMove}
          </span>
        )}
        <ChevronRight size={14} className="text-slate-600" />
        <span className="flex items-center gap-1.5 text-emerald-400 font-mono font-bold">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          {correctMove}
        </span>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-6 w-32 bg-white/5 rounded-full" />
          <div className="h-4 w-full bg-white/5 rounded-full" />
          <div className="h-4 w-3/4 bg-white/5 rounded-full" />
        </div>
      )}

      {/* Analysis content */}
      {!loading && analysis && (
        <>
          {analysis.concept && (
            <span className={cn(
              'inline-flex self-start px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider',
              'bg-amber-500/10 text-amber-400 border border-amber-500/20',
            )}>
              {analysis.concept}
            </span>
          )}
          <p className="text-sm text-slate-300 leading-relaxed">
            {analysis.analysis}
          </p>
        </>
      )}

      {/* Error fallback */}
      {!loading && error && (
        <div className="flex items-start gap-2 text-sm text-slate-400">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
          <p>
            {cpLoss !== null && (
              <span className="text-rose-400 font-semibold">
                -{Math.abs(cpLoss).toFixed(1)} pawns.{' '}
              </span>
            )}
            Engine recommends <span className="text-emerald-400 font-mono font-bold">{correctMove}</span>
          </p>
        </div>
      )}

      {/* CP Loss indicator — cpLoss is in pawn units (e.g. 1.5 = one and a half pawns) */}
      {cpLoss !== null && cpLoss > 0 && !loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <div className={cn(
            'h-1.5 rounded-full',
            cpLoss > 2 ? 'bg-rose-500' : cpLoss > 1 ? 'bg-amber-500' : 'bg-slate-600',
          )} style={{ width: `${Math.min(100, Math.abs(cpLoss) * 20)}%` }} />
          <span>-{Math.abs(cpLoss).toFixed(1)} pawns</span>
        </div>
      )}

      {/* Next button */}
      <button
        onClick={onNext}
        className={cn(
          'w-full flex items-center justify-center gap-2',
          'bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]',
          'text-white font-black uppercase tracking-widest text-sm',
          'py-4 rounded-xl transition-all mt-2',
          'border border-indigo-400/20',
        )}
      >
        Next <ChevronRight size={18} />
      </button>
    </div>
  );
};
