import React from 'react';
import { Bot, Activity, Cpu, PlayCircle } from 'lucide-react';
import { useCoachStore } from '../stores/coachStore';
import { useEngineStore } from '../stores/engineStore';
import { cn } from '../utils/cn';

interface AnalysisCoachWidgetProps {
  coachActive: boolean;
  onCoachActiveChange: (active: boolean) => void;
  onDeepAnalysis: (force?: boolean) => void;
  onDemoEngineLine?: (pv: string) => void;
  onHighlightEngineLine?: (pv: string) => void;
  onStopHighlight?: () => void;
  userColor?: 'white' | 'black';
}

export const AnalysisCoachWidget: React.FC<AnalysisCoachWidgetProps> = ({
  coachActive,
  onCoachActiveChange,
  onDeepAnalysis,
  onDemoEngineLine,
  onHighlightEngineLine,
  onStopHighlight,
}) => {
  const { currentInsight, isAnalyzing } = useCoachStore();
  const { topLines, showLines } = useEngineStore();

  // We rely on the parent GameAnalysis to trigger handleAnalysisRequest via its own useEffect
  // which now respects coachActive. This avoids the feedback loop here.

  const handleAvatarTap = () => {
    const next = !coachActive;
    onCoachActiveChange(next);
    if (next) onDeepAnalysis(true);
  };

  return (
    <div className={cn(
      'flex flex-col border-t transition-all duration-500 shrink-0 bg-[#0a0d14]',
      coachActive ? 'border-violet-500/20 bg-violet-500/5' : 'border-white/5'
    )}>
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Avatar */}
        <button
          onClick={handleAvatarTap}
          className={cn(
            'w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg shrink-0 mt-0.5',
            'transition-all duration-500 active:scale-95',
            coachActive ? 'bg-violet-600 shadow-violet-600/30' : 'bg-slate-700 shadow-black/20',
            isAnalyzing && coachActive && 'animate-pulse',
          )}
        >
          <Bot size={18} className="text-white" />
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {!coachActive ? (
            <div className="py-2">
              <p className="text-sm font-semibold text-slate-400">
                Tap the wizard to enable AI strategy coaching.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-widest text-violet-400">
                  AI Coach Insight
                </span>
                {isAnalyzing && (
                  <div className="flex items-center gap-1.5 text-violet-400">
                    <Activity size={10} className="animate-spin" />
                    <span className="text-[8px] font-black uppercase tracking-widest">Thinking...</span>
                  </div>
                )}
              </div>
              
              <p className="text-sm font-semibold text-white leading-snug">
                {isAnalyzing 
                  ? 'The Wizard is contemplating the position...' 
                  : (currentInsight || 'I am ready. Move the pieces or tap the button below for a deep dive.')}
              </p>

              {!currentInsight && !isAnalyzing && (
                <button 
                  onClick={() => onDeepAnalysis(true)}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg"
                >
                  Analyze Position
                </button>
              )}

              {/* Engine Lines in the widget on mobile when active */}
              {showLines && topLines.length > 0 && (
                <div className="pt-2 border-t border-white/5 space-y-1">
                   {topLines.slice(0, 2).map((line, i) => {
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
                        className="w-full flex items-center gap-2 text-left px-2 py-1 rounded-lg bg-white/5 border border-white/5 active:scale-95 transition-all"
                      >
                        <Cpu size={10} className="text-indigo-400" />
                        <span className="text-[10px] font-mono text-indigo-400 w-8 shrink-0 text-right">{scoreStr}</span>
                        <span className="text-[10px] font-mono text-slate-400 truncate flex-1">{line.pv.split(' ').slice(0, 4).join(' ')}</span>
                        <PlayCircle size={10} className="text-slate-600" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
