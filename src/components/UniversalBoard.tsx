import React, { useState, useMemo, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import { RotateCw, Layers, Cpu, Wand2, ChevronRight, ChevronLeft, Eye, BarChart2, ShieldAlert, Activity } from 'lucide-react';
import { useTrainingStore } from '../stores/trainingStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useEngineStore } from '../stores/engineStore';
import { useCoachStore } from '../stores/coachStore';
import { EvalBar } from './EvalBar';
import { VisionOverlay } from './VisionOverlay';
import { calculateControl, formatPV } from '../utils/chessLogic';
import { cn } from '../utils/cn';

interface UniversalBoardProps {
  fen: string;
  onDrop?: (source: string, target: string) => boolean;
  onProceed?: () => void;
  onBack?: () => void;
  onReset?: () => void;
  /** Override board orientation (for review/analysis modes) */
  orientation?: 'white' | 'black';
  /** The side the player is playing (for heatmap colors) */
  playerColor?: 'white' | 'black';
  /** Override the proceed overlay (defaults to trainingStore.awaitingNext) */
  showProceedOverlay?: boolean;
  /** Custom text for the proceed button */
  proceedText?: string;
  /** Override arrows (defaults to trainingStore.arrows) */
  arrows?: [string, string, string?][];
  /** Disable piece dragging */
  readonly?: boolean;
  /** Show the threats toggle in toolbar */
  showThreatsControl?: boolean;
  /** Mobile: size board as w-full aspect-square instead of min(95vw,60vh) */
  mobileSquare?: boolean;
  /** Mobile: hide internal toolbar, study nav, and engine lines (caller provides them) */
  mobileControls?: boolean;
  /** Callback to trigger deep analysis from internal coach button */
  onDeepAnalysis?: () => void;
  /** Callback to demo/simulate a line */
  onDemoLine?: (pv: string) => void;
}

export const UniversalBoard: React.FC<UniversalBoardProps> = ({
  fen,
  onDrop,
  onProceed,
  onBack,
  onReset,
  orientation: orientationProp,
  playerColor: playerColorProp,
  showProceedOverlay,
  proceedText,
  arrows: arrowsProp,
  readonly = false,
  showThreatsControl = false,
  mobileSquare: _mobileSquare = false,
  mobileControls = false,
  onDeepAnalysis,
  onDemoLine,
}) => {
  const awaitingNext = useTrainingStore(s => s.awaitingNext);
  const status = useTrainingStore(s => s.status);
  const mode = useTrainingStore(s => s.mode);
  const studyStep = useTrainingStore(s => s.studyStep);
  const moveHistory = useTrainingStore(s => s.moveHistory);
  const storeArrows = useTrainingStore(s => s.arrows);
  const repertoireSide = useRepertoireStore(s => s.repertoireSide);
  const selectedChapterIdx = useRepertoireStore(s => s.selectedChapter);
  const chapters = useRepertoireStore(s => s.chapters);
  
  const currentChapter = selectedChapterIdx !== null ? chapters[selectedChapterIdx] : null;
  const totalStudySteps = currentChapter?.startMoves?.length ?? 0;

  const { training, analysis, toggleTrainingVision, toggleAnalysisThreats } = useSettingsStore();
  const isTraining = mode === 'study' || mode === 'learn' || mode === 'full' || mode === 'weak' || mode === 'quiz';
  const showVision = isTraining ? training.showVision : analysis.showVision;
  const showThreats = analysis.showThreats;
  
  const showLines = useEngineStore(s => s.showLines);
  const toggleLines = useEngineStore(s => s.toggleLines);
  const showEvalBar = useEngineStore(s => s.showEvalBar);
  const toggleEvalBar = useEngineStore(s => s.toggleEvalBar);
  const topLines = useEngineStore(s => s.topLines);
  const { currentInsight, isAnalyzing: isCoachAnalyzing } = useCoachStore();

  const [orientation, setOrientation] = useState<'white' | 'black'>(
    orientationProp ?? repertoireSide
  );
  const [showCoach, setShowCoach] = useState(false);

  useEffect(() => {
    if (orientationProp) setOrientation(orientationProp);
    else setOrientation(repertoireSide);
  }, [orientationProp, repertoireSide]);

  // Auto-analyze when opening coach OR FEN changes while coach is open
  useEffect(() => {
    if (showCoach && onDeepAnalysis) {
      onDeepAnalysis();
    }
  }, [showCoach, onDeepAnalysis, fen]);

  const controlMap = useMemo(() => {
    if (!showVision) return {} as ReturnType<typeof calculateControl>;
    return calculateControl(fen);
  }, [fen, showVision]);

  const engineArrow = useMemo(() => {
    if (!showLines || topLines.length === 0) return null;
    const firstPv = topLines[0].pv;
    if (!firstPv) return null;
    const bestMove = firstPv.split(' ')[0];
    if (bestMove.length < 4) return null;
    return [bestMove.slice(0, 2), bestMove.slice(2, 4), 'rgba(255, 170, 0, 0.8)'] as [string, string, string];
  }, [showLines, topLines]);

  const threatArrow = useMemo(() => {
    if (!showThreats || topLines.length === 0) return null;
    return null; 
  }, [showThreats, topLines]);

  const arrows = useMemo(() => {
    const base = (arrowsProp ?? storeArrows) as [string, string, string?][];
    const result = [...base];
    if (engineArrow) result.push(engineArrow);
    if (threatArrow) result.push(threatArrow);
    return result;
  }, [arrowsProp, storeArrows, engineArrow, threatArrow]);

  const shouldShowProceed = mode !== 'study' && (showProceedOverlay !== undefined ? showProceedOverlay : awaitingNext);

  const defaultProceedText = (status === 'complete' && (mode === 'weak' || mode === 'quiz'))
    ? 'Next Challenge'
    : 'Proceed';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (shouldShowProceed && (e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        onProceed?.();
        return;
      }
      if (mode === 'study') {
        if (e.key === 'ArrowRight' && !e.repeat) { e.preventDefault(); onProceed?.(); }
        if (e.key === 'ArrowLeft' && !e.repeat && moveHistory.length > 0) { e.preventDefault(); onBack?.(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shouldShowProceed, mode, moveHistory.length, onProceed, onBack]);

  const buttonText = proceedText ?? defaultProceedText;

  return (
    <div className="flex flex-col items-center justify-center w-full max-h-full">
      <div className="flex flex-col items-center justify-center relative w-full px-1 py-1 gap-2">
        <div className="flex items-center justify-center relative w-full max-w-full">
          {showEvalBar && (
            <div className="w-2.5 mr-2 shrink-0 relative overflow-hidden flex flex-col-reverse rounded-full bg-slate-800 border border-black/50"
                 style={{ height: '100%' }}>
              <EvalBar />
            </div>
          )}

          <div className={cn(
            "relative shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] rounded-xl overflow-hidden border-[4px] border-[#161b22] bg-[#161b22] shrink-0",
            "w-full aspect-square",
          )}>
            <Chessboard
              position={fen}
              onPieceDrop={readonly ? () => false : onDrop}
              boardOrientation={orientation}
              customArrows={arrows as any}
              customDarkSquareStyle={{ backgroundColor: '#1e293b' }}
              customLightSquareStyle={{ backgroundColor: '#475569' }}
              animationDuration={150}
              arePiecesDraggable={!readonly}
            />

            {showVision && (
              <div className="absolute inset-0 z-10 pointer-events-none">
                <VisionOverlay 
                  control={controlMap} 
                  orientation={orientation} 
                  playerColor={playerColorProp ?? (repertoireSide as 'white' | 'black')} 
                />
              </div>
            )}

            {(status === 'demo' || status === 'simulating') && (
              <div className="absolute top-2 left-2 z-30 bg-indigo-600 text-white px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest shadow-xl flex items-center gap-1.5 animate-pulse border border-indigo-400/30">
                <Eye size={10} /> {status === 'simulating' ? 'Simulating Line' : 'Coach Demo'}
              </div>
            )}

            {shouldShowProceed && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center animate-in fade-in duration-300">
                <button
                  onClick={onProceed}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-black uppercase tracking-[0.2em] shadow-2xl shadow-indigo-600/50 flex items-center gap-2 active:scale-95 transition-all border border-indigo-400/20 cursor-pointer pointer-events-auto text-xs"
                >
                  {buttonText} <ChevronRight size={18} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={cn("flex flex-row gap-1.5 shrink-0 justify-center flex-wrap", mobileControls && "hidden")}>
          {onReset && (
            <button
              onClick={onReset}
              className="p-2.5 rounded-xl bg-rose-600/10 border border-rose-500/20 text-rose-400 hover:bg-rose-600/20 hover:text-rose-300 transition-all shadow-lg"
              title="Reset Line"
            >
              <RotateCw size={14} />
            </button>
          )}
          <div className="w-full h-[1px] bg-white/5 my-0.5" />
          <button
            onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
            className="p-2.5 rounded-xl bg-[#0d1117] border border-white/10 text-slate-400 hover:text-white transition-all shadow-lg"
            title="Flip Board"
          >
            <RotateCw size={14} />
          </button>
          <button
            onClick={toggleTrainingVision}
            className={cn(
              "p-2.5 rounded-xl border transition-all shadow-lg",
              showVision
                ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/30"
                : "bg-[#0d1117] border-white/10 text-slate-400 hover:text-white"
            )}
            title="Vision Heatmap"
          >
            <Layers size={14} />
          </button>
          <button
            onClick={toggleEvalBar}
            className={cn(
              "p-2.5 rounded-xl border transition-all shadow-lg",
              showEvalBar
                ? "bg-amber-600/20 text-amber-400 border-amber-500/30"
                : "bg-[#0d1117] border-white/10 text-slate-400 hover:text-white"
            )}
            title="Evaluation Bar"
          >
            <BarChart2 size={14} />
          </button>
          {showThreatsControl && (
            <button
              onClick={toggleAnalysisThreats}
              className={cn(
                "p-2.5 rounded-xl border transition-all shadow-lg",
                showThreats
                  ? "bg-rose-600/20 text-rose-400 border-rose-500/30"
                  : "bg-[#0d1117] border-white/10 text-slate-400 hover:text-white"
              )}
              title="Opponent Threats"
            >
              <ShieldAlert size={14} />
            </button>
          )}
          <button
            onClick={toggleLines}
            className={cn(
              "p-2.5 rounded-xl border transition-all shadow-lg",
              showLines
                ? "bg-indigo-600/20 text-indigo-400 border-indigo-500/30"
                : "bg-[#0d1117] border-white/10 text-slate-400 hover:text-white"
            )}
            title="Engine Lines"
          >
            <Cpu size={14} />
          </button>
          {!mobileControls && (
            <div className="relative group/coach">
              <button
                onClick={() => setShowCoach(c => !c)}
                className={cn(
                  "p-2.5 rounded-xl border transition-all shadow-lg",
                  showCoach
                    ? "bg-violet-600/20 text-violet-400 border-violet-500/30"
                    : "bg-[#0d1117] border-white/10 text-slate-400 hover:text-white"
                )}
                title="AI Coach"
              >
                <Wand2 size={14} />
              </button>
              
              {showCoach && (
                <div className="absolute bottom-0 right-full mr-4 w-72 bg-[#0d1117] border border-white/10 rounded-2xl p-4 shadow-2xl z-50 animate-in slide-in-from-right-2 fade-in duration-200">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl select-none">🧙</span>
                    <div className="flex-1 text-left">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-violet-400">AI Coach</p>
                        {isCoachAnalyzing && <Activity size={10} className="animate-spin text-violet-400" />}
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed">
                        {isCoachAnalyzing 
                          ? 'The Wizard is contemplating...' 
                          : (currentInsight || 'The Wizard is ready. Request a Deep Analysis to begin.')}
                      </p>
                      {!currentInsight && !isCoachAnalyzing && onDeepAnalysis && (
                        <button
                          onClick={onDeepAnalysis}
                          className="mt-3 w-full py-2 bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg"
                        >
                          Analyze Position
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {mode === 'study' && (
        <div className={cn(
          "flex items-center gap-4 mb-6 bg-[#0d1117] px-6 py-3 rounded-2xl border border-white/10 shadow-2xl animate-in slide-in-from-bottom-4 duration-500 shrink-0",
          mobileControls && "hidden"
        )}>
           <button 
             onClick={onBack}
             disabled={moveHistory.length === 0}
             className="p-2 hover:bg-white/5 rounded-xl disabled:opacity-20 transition-all text-slate-400 hover:text-white"
             title="Previous Move"
           >
             <ChevronLeft size={24} />
           </button>
           
           <div className="flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Study Progress</span>
              <span className="text-xs font-mono text-indigo-400 font-bold tracking-widest">
                {studyStep} <span className="text-slate-600 mx-1">/</span> {totalStudySteps}
              </span>
           </div>

           <button 
             onClick={onProceed}
             disabled={studyStep >= totalStudySteps && !awaitingNext}
             className={cn(
               "p-2 rounded-xl transition-all",
               awaitingNext 
                 ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 scale-110" 
                 : "hover:bg-white/5 text-slate-400 hover:text-white disabled:opacity-20"
             )}
             title="Next Move"
           >
             <ChevronRight size={24} />
           </button>
        </div>
      )}

      {showLines && topLines.length > 0 && mode !== 'explore' && (
        <div className={cn("mb-6 px-4 w-full max-w-2xl shrink-0", mobileControls && "hidden")}>
          <div className="bg-[#0d1117]/60 backdrop-blur-sm border border-white/5 rounded-xl p-3 flex flex-col gap-1.5">
            {topLines.slice(0, 3).map((line, i) => {
              const scoreStr = line.mate !== null
                ? `M${Math.abs(line.mate)}`
                : line.cp !== null
                  ? `${line.cp > 0 ? '+' : ''}${(line.cp / 100).toFixed(1)}`
                  : '—';
              const formattedLine = formatPV(fen, line.pv, 6);
              return (
                <button 
                  key={i} 
                  onClick={() => onDemoLine?.(line.pv)}
                  className="flex items-baseline gap-3 text-xs w-full hover:bg-white/5 p-1 rounded transition-colors text-left"
                >
                  <span className="font-mono text-indigo-400 w-10 shrink-0 text-right">{scoreStr}</span>
                  <span className="text-slate-400 font-mono truncate">{formattedLine}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
