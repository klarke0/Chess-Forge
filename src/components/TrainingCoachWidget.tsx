import React, { useMemo } from 'react';
import { Chess } from 'chess.js';
import { Bot, CheckCircle2, Zap, AlertCircle, LifeBuoy, Flag, Activity } from 'lucide-react';
import { useTrainingStore } from '../stores/trainingStore';
import { useCoachStore } from '../stores/coachStore';
import { useEngineStore } from '../stores/engineStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { cn } from '../utils/cn';

interface TrainingCoachWidgetProps {
  fen: string;
  onDeepAnalysis: () => void;
  onShowSolution: () => void;
  onGiveUp: () => void;
  coachActive?: boolean;
  onCoachActiveChange?: (active: boolean) => void;
  onPlayMove?: (san: string) => void;
  onPlayMainline?: () => void;
  onDemoEngineLine?: (pv: string) => void;
  onHighlightEngineLine?: (pv: string) => void;
  onStopHighlight?: () => void;
}

const MODE_LABELS: Record<string, string> = {
  study: 'Study',
  learn: 'Learn',
  full: 'Full Drill',
  weak: 'Weak Spots',
  quiz: 'Quiz',
};

const MODE_IDLE_TEXT: Record<string, string> = {
  study:  'Tap ▶ to step through the line. Tap the wizard for AI strategy.',
  learn:  'Follow along — arrows show the correct move. Tap the wizard to analyze.',
  full:   'Make your move! Tap the wizard for position insights.',
  weak:   'This is a position you\'ve struggled with. Tap the wizard for help.',
  quiz:   'Test yourself — no hints. Tap the wizard for a post-move debrief.',
};

export const TrainingCoachWidget: React.FC<TrainingCoachWidgetProps> = ({
  fen,
  onDeepAnalysis,
  onShowSolution,
  onGiveUp,
  coachActive = false,
  onCoachActiveChange,
  onPlayMove,
  onPlayMainline,
  onDemoEngineLine,
  onHighlightEngineLine,
  onStopHighlight,
}) => {
  const { status, message, hint, awaitingNext, mode, learnRunsCompleted } = useTrainingStore();
  const { currentInsight, isAnalyzing } = useCoachStore();
  const { topLines, showLines } = useEngineStore();
  const getCorrectMoves = useRepertoireStore(s => s.getCorrectMoves);
  const positions = useRepertoireStore(s => s.positions);

  // Sync local display mode with coachActive prop
  const widgetMode = coachActive ? 'analysis' : 'status';

  const handleAvatarTap = () => {
    const next = !coachActive;
    onCoachActiveChange?.(next);
    if (next) onDeepAnalysis();
  };

  const avatarBg =
    status === 'correct' ? 'bg-emerald-500 shadow-emerald-500/30' :
    status === 'wrong'   ? 'bg-rose-500 shadow-rose-500/30' :
    status === 'novelty' ? 'bg-indigo-500 shadow-indigo-500/30' :
    widgetMode === 'analysis' ? 'bg-violet-600 shadow-violet-600/30' :
    'bg-slate-700 shadow-black/20';

  const borderColor =
    status === 'correct' ? 'border-emerald-500/30 bg-emerald-500/5' :
    status === 'wrong'   ? 'border-rose-500/30 bg-rose-500/5' :
    status === 'novelty' ? 'border-indigo-500/30 bg-indigo-500/5' :
    'border-white/5 bg-white/[0.02]';

  const AvatarIcon =
    status === 'correct' ? CheckCircle2 :
    status === 'wrong'   ? AlertCircle :
    status === 'novelty' ? Zap : Bot;

  const showActions =
    status !== 'idle' && status !== 'complete' && status !== 'demo' && !awaitingNext;

  // Build the text to display
  const idleText = MODE_IDLE_TEXT[mode] ?? 'Tap the wizard to analyze this position.';
  const displayText =
    widgetMode === 'analysis'
      ? (isAnalyzing
          ? (message || 'The Wizard is contemplating...')
          : (currentInsight || 'I have no insights for this position yet. Tap the wizard above to ask for a strategic breakdown.'))
      : (message || idleText);

  // Learn mode run badge: "Run 2 / 3"
  const learnBadge = mode === 'learn' && status !== 'idle'
    ? `Run ${learnRunsCompleted + 1} / 3`
    : null;

  // Study mode: show which run phase we're on for learn
  const learnPhaseLabel =
    learnRunsCompleted === 0 ? 'Guided' :
    learnRunsCompleted === 1 ? 'Hints' :
    'Recall';

  const isExplore = mode === 'explore';

  const repertoireMoves = useMemo(
    () => (isExplore ? getCorrectMoves(fen) : []),
    [isExplore, getCorrectMoves, fen, positions]
  );

  const engineRankBySan = useMemo(() => {
    const map = new Map<string, number>();
    if (!isExplore || !showLines) return map;
    topLines.slice(0, 3).forEach((line, i) => {
      const uciMove = line.pv.split(' ')[0];
      if (!uciMove || uciMove.length < 4) return;
      try {
        const chess = new Chess(fen);
        const m = chess.move({ from: uciMove.slice(0, 2), to: uciMove.slice(2, 4), promotion: uciMove[4] || undefined });
        if (m) map.set(m.san, i + 1);
      } catch { /* ignore */ }
    });
    return map;
  }, [isExplore, showLines, topLines, fen]);

  return (
    <div className={cn(
      'flex items-start gap-3 px-4 py-3 border-t transition-all duration-500 shrink-0',
      borderColor,
    )}>
      {/* Avatar — toggles analysis mode or triggers it if already on */}
      <button
        onClick={handleAvatarTap}
        className={cn(
          'w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg shrink-0 mt-0.5',
          'transition-all duration-500 active:scale-95',
          avatarBg,
          isAnalyzing && widgetMode === 'analysis' && 'animate-pulse',
        )}
        aria-label={widgetMode === 'analysis' ? 'Refresh analysis' : 'Ask coach for analysis'}
      >
        <AvatarIcon size={18} className="text-white" />
      </button>

      {/* Text area — explore mode shows move chips; other modes show message */}
      {isExplore ? (
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
              {repertoireMoves.length > 0 ? 'Book Moves' : 'Off Book'}
            </span>
            {repertoireMoves.length > 0 && (
              <button
                onClick={onPlayMainline}
                disabled={status === 'demo'}
                className="text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:text-emerald-300 disabled:opacity-30 flex items-center gap-1 transition-colors"
              >
                ▶ Mainline
              </button>
            )}
          </div>
          {repertoireMoves.length === 0 ? (
            <p className="text-slate-600 text-xs italic">No repertoire moves — off book.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {repertoireMoves.map((move) => {
                const rank = engineRankBySan.get(move.san);
                return (
                  <button
                    key={move.san}
                    onClick={() => onPlayMove?.(move.san)}
                    disabled={status === 'demo'}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-black font-mono border transition-all active:scale-95 disabled:opacity-30',
                      rank
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-white'
                        : 'bg-white/5 border-white/10 text-slate-400',
                    )}
                  >
                    {move.san}
                    {rank && showLines && (
                      <span className="ml-1 text-[8px] text-indigo-400">#{rank}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {/* Tappable engine lines */}
          {showLines && topLines.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {topLines.slice(0, 3).map((line, i) => {
                const scoreStr = line.mate !== null
                  ? `M${Math.abs(line.mate)}`
                  : line.cp !== null
                    ? `${line.cp > 0 ? '+' : ''}${(line.cp / 100).toFixed(1)}`
                    : '—';
                return (
                  <button
                    key={i}
                    onMouseEnter={() => onHighlightEngineLine?.(line.pv)}
                    onMouseLeave={onStopHighlight}
                    onClick={() => onDemoEngineLine?.(line.pv)}
                    disabled={status === 'demo'}
                    className="flex items-center gap-2 text-left px-2 py-1 rounded-lg bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10 transition-all active:scale-95 disabled:opacity-30"
                  >
                    <span className="text-[10px] font-mono text-amber-400 w-8 shrink-0 text-right">{scoreStr}</span>
                    <span className="text-[10px] font-mono text-slate-500 truncate">{line.pv.split(' ').slice(0, 5).join(' ')}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-w-0">
          {widgetMode === 'analysis' && isAnalyzing ? (
            <div className="flex items-center gap-2 text-violet-400 mt-1">
              <Activity size={12} className="animate-spin shrink-0" />
              <span className="text-[11px] font-black uppercase tracking-widest">Grandmaster thinking...</span>
            </div>
          ) : (
            <>
              {/* Mode label + learn badge */}
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                  {MODE_LABELS[mode] ?? mode}
                </span>
                {learnBadge && (
                  <span className="text-[9px] font-black uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-px rounded-full">
                    {learnBadge} · {learnPhaseLabel}
                  </span>
                )}
                {widgetMode === 'analysis' && !isAnalyzing && currentInsight && (
                  <span className="text-[9px] font-black uppercase tracking-wider text-violet-400">
                    AI Coach
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-white leading-snug">
                {displayText}
              </p>
              {widgetMode === 'analysis' && !currentInsight && !isAnalyzing && (
                <button 
                  onClick={(e) => { e.stopPropagation(); onDeepAnalysis(); }}
                  className="mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-violet-600/20 flex items-center gap-2"
                >
                  <Bot size={12} /> Deep Analysis
                </button>
              )}
              {widgetMode === 'status' && hint && (
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-0.5">
                  Correction: {hint}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Show Solution + Give Up — only in status mode when game is active and not explore */}
      {!isExplore && showActions && widgetMode === 'status' && (
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          <button
            onClick={onShowSolution}
            className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all active:scale-95"
            aria-label="Show Solution"
          >
            <LifeBuoy size={14} />
          </button>
          <button
            onClick={onGiveUp}
            className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all active:scale-95"
            aria-label="Give Up"
          >
            <Flag size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
