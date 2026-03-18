import React, { useEffect } from 'react';
import { Bot, Activity, Eye, LifeBuoy, Flag, BookOpen, Brain, Repeat2 } from 'lucide-react';
import { useCoachStore } from '../stores/coachStore';
import { useLichessMasters } from '../hooks/useLichessMasters';
import { useTrainingStore } from '../stores/trainingStore';

interface CoachPanelProps {
  fen: string;
  onDeepAnalysis: () => void;
  onPlayDemo: () => void;
  onShowSolution: () => void;
  onGiveUp: () => void;
}

const MODE_PROMPTS: Record<string, { label: string; icon: React.ElementType; placeholder: string }> = {
  study: {
    label: 'Study Mode',
    icon: BookOpen,
    placeholder: 'Step through the line with ▶, then request analysis to understand the ideas behind each move.',
  },
  learn: {
    label: 'Learn Mode',
    icon: Repeat2,
    placeholder: 'Complete all 3 runs, then ask for analysis to lock in the key patterns.',
  },
  full: {
    label: 'Full Drill',
    icon: Bot,
    placeholder: 'Make your move, then request a deep analysis to understand any mistakes or ideas.',
  },
  weak: {
    label: 'Weak Spots',
    icon: Brain,
    placeholder: 'These are positions you\'ve struggled with. Request analysis to understand what to watch for.',
  },
  quiz: {
    label: 'Quiz Mode',
    icon: Brain,
    placeholder: 'After making your move, request analysis for a post-move debrief.',
  },
};

const LEARN_PHASE: Record<number, string> = {
  0: 'Run 1 of 3 — Guided (arrows shown)',
  1: 'Run 2 of 3 — Hints (arrows on mistakes)',
  2: 'Run 3 of 3 — Recall (no hints)',
};

export const CoachPanel: React.FC<CoachPanelProps> = ({
  fen,
  onDeepAnalysis,
  onPlayDemo,
  onShowSolution,
  onGiveUp
}) => {
  const { currentInsight, demoLine, isAnalyzing, isError } = useCoachStore();
  const { status, moveHistory, awaitingNext, mode, learnRunsCompleted } = useTrainingStore();

  const setMastersData = useCoachStore(s => s.setMastersData);
  const { data: mastersData, loading: mastersLoading } = useLichessMasters(fen);

  useEffect(() => {
    setMastersData(mastersData);
  }, [mastersData, setMastersData]);

  const modeConfig = MODE_PROMPTS[mode] ?? MODE_PROMPTS.full;
  const ModeIcon = modeConfig.icon;

  const canAnalyze = !isAnalyzing && moveHistory.length > 0 && status !== 'demo';

  return (
    <div className="flex-1 bg-indigo-600/[0.03] rounded-[3.5rem] border border-white/5 flex flex-col p-8 relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition-opacity">
        <Bot size={120} />
      </div>

      {/* Header */}
      <div className="flex justify-between items-center mb-4 relative z-10">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-500 flex items-center gap-2">
            <Bot size={16} /> Grandmaster Coach
          </h3>
          <div className="flex items-center gap-2">
            <ModeIcon size={11} className="text-slate-600" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{modeConfig.label}</span>
            {mode === 'learn' && status !== 'idle' && (
              <span className="text-[9px] font-black uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-px rounded-full ml-1">
                {LEARN_PHASE[learnRunsCompleted] ?? 'Run 3 of 3'}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {demoLine.length > 0 && (
            <button
              onClick={onPlayDemo}
              disabled={status === 'demo'}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20"
            >
              <Eye size={14} /> Play Demo
            </button>
          )}
          <button
            onClick={onDeepAnalysis}
            disabled={!canAnalyze}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-20 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            {isAnalyzing
              ? <><Activity size={14} className="animate-spin" /> Analyzing...</>
              : <><Bot size={14} /> Deep Analysis</>
            }
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10 mb-6">
        {isError ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-rose-400 text-xs font-bold leading-relaxed">{currentInsight}</p>
            <button
              onClick={onDeepAnalysis}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 uppercase tracking-widest font-black transition-colors"
            >
              Retry
            </button>
          </div>
        ) : currentInsight ? (
          <div className="text-slate-300 text-sm leading-relaxed font-medium italic animate-in fade-in duration-1000">
            "{currentInsight}"
          </div>
        ) : isAnalyzing ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <Activity size={20} className="text-violet-400 animate-spin" />
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-400">
              Grandmaster is thinking...
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-2">
            <ModeIcon size={24} className="text-slate-700" />
            <p className="text-slate-600 font-semibold text-xs leading-relaxed">
              {modeConfig.placeholder}
            </p>
          </div>
        )}
      </div>

      {/* Masters Database widget */}
      {(mastersLoading || (mastersData && mastersData.moves.length > 0)) && (
        <div className="relative z-10 mb-4">
          <div className="border border-white/5 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-white/[0.02] border-b border-white/5">
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">
                Masters Database
              </span>
              {mastersData && (
                <span className="text-[9px] font-bold text-slate-600">
                  {(mastersData.white + mastersData.draws + mastersData.black).toLocaleString()} games
                </span>
              )}
            </div>

            {/* Rows */}
            <div className="divide-y divide-white/[0.03]">
              {mastersLoading && !mastersData ? (
                [0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 animate-pulse">
                    <div className="w-8 h-2.5 bg-white/5 rounded" />
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full" />
                    <div className="w-6 h-2.5 bg-white/5 rounded" />
                  </div>
                ))
              ) : (
                mastersData?.moves.slice(0, 3).map((move) => {
                  const totalGames = mastersData.white + mastersData.draws + mastersData.black;
                  const moveTotal = move.white + move.draws + move.black;
                  const pct = Math.round((moveTotal / totalGames) * 100);
                  const maxTotal = mastersData.moves[0]
                    ? mastersData.moves[0].white + mastersData.moves[0].draws + mastersData.moves[0].black
                    : 1;
                  const barWidth = Math.round((moveTotal / maxTotal) * 100);
                  const wPct = Math.round((move.white / moveTotal) * 100);
                  const dPct = Math.round((move.draws / moveTotal) * 100);
                  const lPct = 100 - wPct - dPct;

                  return (
                    <div key={move.san} className="flex items-center gap-2.5 px-3 py-2">
                      <span className="text-[11px] font-black text-slate-300 w-8 shrink-0">{move.san}</span>
                      <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500/60 rounded-full"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 w-7 text-right shrink-0">{pct}%</span>
                      <span className="text-[9px] font-mono text-slate-600 shrink-0">
                        W{wPct} D{dPct} L{lPct}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Training Actions */}
      <div className="flex gap-3 relative z-10 pt-6 border-t border-white/5">
        <button
          onClick={onShowSolution}
          disabled={status === 'idle' || status === 'complete' || status === 'demo' || awaitingNext}
          className="flex-1 px-4 py-3 bg-white/5 hover:bg-amber-600/20 hover:text-amber-400 disabled:opacity-10 text-slate-400 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 border border-white/5 hover:border-amber-500/30"
        >
          <LifeBuoy size={14} /> Show Solution
        </button>
        <button
          onClick={onGiveUp}
          disabled={status === 'idle' || status === 'complete' || status === 'demo' || awaitingNext}
          className="flex-1 px-4 py-3 bg-white/5 hover:bg-rose-600/20 hover:text-rose-400 disabled:opacity-10 text-slate-400 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 border border-white/5 hover:border-rose-500/30"
        >
          <Flag size={14} /> Give Up
        </button>
      </div>
    </div>
  );
};
