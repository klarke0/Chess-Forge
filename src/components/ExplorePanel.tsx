import React, { useMemo } from 'react';
import { Chess } from 'chess.js';
import { Compass, Play, Zap } from 'lucide-react';
import { useEngineStore } from '../stores/engineStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useTrainingStore } from '../stores/trainingStore';
import { cn } from '../utils/cn';

interface ExplorePanelProps {
  fen: string;
  onPlayMove: (san: string) => void;
  onPlayMainline: () => void;
  onDemoEngineLine: (pv: string) => void;
  onHighlightEngineLine: (pv: string) => void;
  onStopHighlight: () => void;
}

/** Convert the first move of a UCI pv string to SAN at the given FEN. Returns null on failure. */
function uciFirstMoveToSan(fen: string, pv: string): string | null {
  const uciMove = pv.split(' ')[0];
  if (!uciMove || uciMove.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uciMove.slice(0, 2),
      to: uciMove.slice(2, 4),
      promotion: uciMove[4] || undefined,
    });
    return move?.san ?? null;
  } catch { return null; }
}

/** Format a UCI pv as SAN move notation (e.g. "d4 Nf6 Nc3 d5") */
function formatPvSan(fen: string, pv: string, maxMoves = 5): string {
  const uciMoves = pv.split(' ').slice(0, maxMoves);
  const result: string[] = [];
  try {
    const chess = new Chess(fen);
    for (const uci of uciMoves) {
      if (uci.length < 4) break;
      try {
        const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
        if (!m) break;
        result.push(m.san);
      } catch { break; }
    }
  } catch { /* invalid FEN — return empty */ }
  return result.join(' ');
}

export const ExplorePanel: React.FC<ExplorePanelProps> = ({
  fen,
  onPlayMove,
  onPlayMainline,
  onDemoEngineLine,
  onHighlightEngineLine,
  onStopHighlight,
}) => {
  const { topLines, showLines } = useEngineStore();
  const { status } = useTrainingStore();
  const getCorrectMoves = useRepertoireStore(s => s.getCorrectMoves);
  const positions = useRepertoireStore(s => s.positions);

  const repertoireMoves = useMemo(() => getCorrectMoves(fen), [getCorrectMoves, fen, positions]);

  // Map each SAN to its engine rank (1=best) among the top 3 PV first moves
  const engineRankBySan = useMemo(() => {
    const map = new Map<string, number>();
    if (!showLines) return map;
    topLines.slice(0, 3).forEach((line, i) => {
      const san = uciFirstMoveToSan(fen, line.pv);
      if (san) map.set(san, i + 1);
    });
    return map;
  }, [topLines, fen, showLines]);

  const isDemo = status === 'demo';

  return (
    <div className="flex flex-col gap-5 p-6 overflow-y-auto custom-scrollbar flex-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-500 flex items-center gap-2">
          <Compass size={14} /> Opening Explorer
        </h3>
        {repertoireMoves.length > 0 && (
          <button
            onClick={onPlayMainline}
            disabled={isDemo}
            className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-30 active:scale-95"
          >
            <Play size={10} /> Mainline
          </button>
        )}
      </div>

      {/* Repertoire moves */}
      <div>
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-2.5">
          {repertoireMoves.length > 0 ? 'Repertoire Lines' : 'Off Book'}
        </p>
        {repertoireMoves.length === 0 ? (
          <p className="text-slate-600 text-xs italic leading-relaxed">
            No repertoire moves from this position — you're exploring off-book territory.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {repertoireMoves.map((move) => {
              const rank = engineRankBySan.get(move.san);
              return (
                <button
                  key={move.san}
                  onClick={() => onPlayMove(move.san)}
                  disabled={isDemo}
                  className={cn(
                    'flex items-start gap-3 w-full text-left px-3 py-2.5 rounded-xl border transition-all active:scale-[0.98] disabled:opacity-30',
                    rank
                      ? 'bg-indigo-600/10 border-indigo-500/30 hover:bg-indigo-600/20'
                      : 'bg-white/[0.03] border-white/5 hover:bg-white/5',
                  )}
                >
                  <span className={cn(
                    'text-sm font-black font-mono shrink-0 mt-0.5',
                    rank ? 'text-white' : 'text-slate-400',
                  )}>
                    {move.san}
                  </span>
                  <div className="flex-1 min-w-0">
                    {move.comment && (
                      <p className="text-[10px] text-slate-500 leading-snug line-clamp-2">{move.comment}</p>
                    )}
                  </div>
                  {rank && (
                    <span className={cn(
                      'text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 border',
                      rank === 1 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                      rank === 2 ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' :
                                   'bg-slate-500/20 text-slate-400 border-slate-500/30',
                    )}>
                      Engine #{rank}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Clickable engine lines — only when showLines */}
      {showLines && topLines.length > 0 && (
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-2.5">Engine Lines</p>
          <div className="flex flex-col gap-1.5">
            {topLines.slice(0, 3).map((line, i) => {
              const scoreStr = line.mate !== null
                ? `M${Math.abs(line.mate)}`
                : line.cp !== null
                  ? `${line.cp > 0 ? '+' : ''}${(line.cp / 100).toFixed(1)}`
                  : '—';
              const formattedLine = formatPvSan(fen, line.pv, 6);
              return (
                <button
                  key={i}
                  onMouseEnter={() => onHighlightEngineLine(line.pv)}
                  onMouseLeave={onStopHighlight}
                  onClick={() => onDemoEngineLine(line.pv)}
                  disabled={isDemo}
                  className="flex items-baseline gap-3 w-full text-left px-3 py-2 rounded-xl bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10 hover:border-amber-500/20 transition-all disabled:opacity-30 active:scale-[0.98]"
                >
                  <span className="font-mono text-amber-400 w-10 shrink-0 text-right text-xs">{scoreStr}</span>
                  <span className="text-slate-400 font-mono text-xs truncate">{formattedLine}</span>
                  <Zap size={10} className="text-amber-400/40 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
