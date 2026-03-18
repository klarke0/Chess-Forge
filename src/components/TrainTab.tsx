import React, { useState } from 'react';
import {
  ChevronLeft, ChevronRight, RotateCw,
  GraduationCap, BookOpen, Play, Target, Brain,
  Layers, BarChart2, Cpu, Wand2, Compass,
} from 'lucide-react';
import { UniversalBoard } from './UniversalBoard';
import { TacticalMonitor } from './TacticalMonitor';
import { MoveLedger } from './MoveLedger';
import { CoachPanel } from './CoachPanel';
import { ExplorePanel } from './ExplorePanel';
import { ModeSelector } from './ModeSelector';
import { TrainingCoachWidget } from './TrainingCoachWidget';
import { useTrainingStore } from '../stores/trainingStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useEngineStore } from '../stores/engineStore';
import { useSettingsStore } from '../stores/settingsStore';
import { cn } from '../utils/cn';

type TrainingMode = 'study' | 'learn' | 'full' | 'weak' | 'quiz' | 'explore';

interface TrainTabProps {
  fen: string;
  onDrop: (source: string, target: string) => boolean;
  onProceed: () => void;
  onBack: () => void;
  onReset: () => void;
  onStartTraining: (chapterIdx?: number) => void;
  onDeepAnalysis: () => void;
  onPlayDemo: () => void;
  onShowSolution: () => void;
  onGiveUp: () => void;
  onJumpToMove: (flatIdx: number) => void;
  onPlayRepertoireMove: (san: string) => void;
  onPlayMainline: () => void;
  onDemoEngineLine: (pv: string) => void;
  onHighlightEngineLine: (pv: string) => void;
  onStopHighlight: () => void;
}

const MOBILE_MODES: { id: TrainingMode; label: string; icon: React.ElementType }[] = [
  { id: 'study',   label: 'Study',   icon: GraduationCap },
  { id: 'learn',   label: 'Learn',   icon: BookOpen },
  { id: 'full',    label: 'Full',    icon: Play },
  { id: 'weak',    label: 'Weak',    icon: Target },
  { id: 'quiz',    label: 'Quiz',    icon: Brain },
  { id: 'explore', label: 'Explore', icon: Compass },
];

export const TrainTab: React.FC<TrainTabProps> = ({
  fen,
  onDrop,
  onProceed,
  onBack,
  onReset,
  onStartTraining,
  onDeepAnalysis,
  onPlayDemo,
  onShowSolution,
  onGiveUp,
  onJumpToMove,
  onPlayRepertoireMove,
  onPlayMainline,
  onDemoEngineLine,
  onHighlightEngineLine,
  onStopHighlight,
}) => {
  const ledger = useTrainingStore(s => s.ledger);
  const moveHistory = useTrainingStore(s => s.moveHistory);
  const mode = useTrainingStore(s => s.mode);
  const setMode = useTrainingStore(s => s.setMode);
  const status = useTrainingStore(s => s.status);
  const awaitingNext = useTrainingStore(s => s.awaitingNext);

  const repertoireSide = useRepertoireStore(s => s.repertoireSide);
  const selectedChapterIdx = useRepertoireStore(s => s.selectedChapter);
  const chapters = useRepertoireStore(s => s.chapters);
  const studyStep = useTrainingStore(s => s.studyStep);

  const currentChapter = selectedChapterIdx !== null ? chapters[selectedChapterIdx] : null;
  const totalStudySteps = currentChapter?.startMoves?.length ?? 0;

  const { training, toggleTrainingVision } = useSettingsStore();
  const { showLines, toggleLines, showEvalBar, toggleEvalBar } = useEngineStore();

  // Mobile-only: local board flip (doesn't affect desktop orientation in UniversalBoard)
  const [mobileFlipped, setMobileFlipped] = useState(false);
  // Mobile-only: coach mode toggle (auto-analyzes each position when on)
  const [coachActive, setCoachActive] = useState(false);
  const analyzedFensRef = React.useRef<Set<string>>(new Set());

  // Auto-analyze when coach is active and FEN changes
  React.useEffect(() => {
    if (coachActive && !analyzedFensRef.current.has(fen) && status !== 'idle' && status !== 'demo') {
      const timer = setTimeout(() => {
        onDeepAnalysis();
        analyzedFensRef.current.add(fen);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (!coachActive) {
      analyzedFensRef.current.clear();
    }
  }, [fen, coachActive, onDeepAnalysis, status]);

  const mobileOrientation: 'white' | 'black' = mobileFlipped
    ? (repertoireSide === 'white' ? 'black' : 'white')
    : repertoireSide;

  return (
    <div className="flex flex-col lg:flex-row h-full w-full overflow-hidden">

      {/* ── MOBILE ONLY: Compact Mode Strip ───────────────────────────────── */}
      <div className="lg:hidden flex shrink-0 border-b border-white/5 bg-[#0a0d14]">
        {MOBILE_MODES.map((m) => (
          <button
            key={m.id}
            disabled={status === 'demo'}
            onClick={() => { setMode(m.id as any); onStartTraining(); }}
            className={cn(
              'flex-1 flex flex-col items-center gap-0.5 py-2 transition-all',
              mode === m.id
                ? 'text-indigo-400 bg-indigo-500/10 border-b-2 border-indigo-500'
                : 'text-slate-600 hover:text-slate-400',
              status === 'demo' && 'opacity-40 cursor-not-allowed',
            )}
          >
            <m.icon size={14} />
            <span className="text-[8px] font-black uppercase tracking-wider">{m.label}</span>
          </button>
        ))}
      </div>

      {/* ── Board Area ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative flex items-stretch justify-center bg-[#0d1117]/20 overflow-hidden">
        <UniversalBoard
          fen={fen}
          onDrop={onDrop}
          onProceed={onProceed}
          onBack={onBack}
          onReset={onReset}
          orientation={mobileOrientation}
          mobileSquare
          mobileControls
          onDemoLine={onDemoEngineLine}
        />
      </div>

      {/* ── MOBILE ONLY: Toolbar Row ───────────────────────────────────────── */}
      <div className="lg:hidden flex items-center gap-1 px-3 py-2 bg-[#0a0d14] border-t border-white/5 shrink-0">
        {/* Navigation: back | reset | proceed */}
        <button
          onClick={onBack}
          disabled={moveHistory.length === 0}
          className="p-2 rounded-xl bg-[#0d1117] border border-white/10 text-slate-400 hover:text-white disabled:opacity-20 transition-all active:scale-95"
          aria-label="Back"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={onReset}
          className="p-2 rounded-xl bg-rose-600/10 border border-rose-500/20 text-rose-400 hover:bg-rose-600/20 transition-all active:scale-95"
          aria-label="Reset"
        >
          <RotateCw size={14} />
        </button>
        <button
          onClick={onProceed}
          disabled={mode === 'study' ? (studyStep >= totalStudySteps && !awaitingNext) : (status === 'idle' && !awaitingNext)}
          className={cn(
            'p-2 rounded-xl border transition-all active:scale-95',
            awaitingNext
              ? 'bg-indigo-600 border-indigo-500/50 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white disabled:opacity-20',
          )}
          aria-label="Proceed"
        >
          <ChevronRight size={16} />
        </button>

        <div className="h-6 w-px bg-white/10 mx-1 shrink-0" />

        {/* Board flip */}
        <button
          onClick={() => setMobileFlipped(f => !f)}
          className={cn(
            'p-2 rounded-xl border transition-all active:scale-95',
            mobileFlipped
              ? 'bg-slate-600/20 text-slate-300 border-slate-500/30'
              : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
          )}
          aria-label="Flip Board"
        >
          <RotateCw size={14} />
        </button>

        {/* Vision heatmap */}
        <button
          onClick={toggleTrainingVision}
          className={cn(
            'p-2 rounded-xl border transition-all active:scale-95',
            training.showVision
              ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
              : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
          )}
          aria-label="Vision Heatmap"
        >
          <Layers size={14} />
        </button>

        {/* Eval bar */}
        <button
          onClick={toggleEvalBar}
          className={cn(
            'p-2 rounded-xl border transition-all active:scale-95',
            showEvalBar
              ? 'bg-amber-600/20 text-amber-400 border-amber-500/30'
              : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
          )}
          aria-label="Eval Bar"
        >
          <BarChart2 size={14} />
        </button>

        {/* Engine lines */}
        <button
          onClick={toggleLines}
          className={cn(
            'p-2 rounded-xl border transition-all active:scale-95',
            showLines
              ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30'
              : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
          )}
          aria-label="Engine Lines"
        >
          <Cpu size={14} />
        </button>

        {/* Wand — toggles persistent coach analysis mode */}
        <button
          onClick={() => {
            const next = !coachActive;
            setCoachActive(next);
            if (next) onDeepAnalysis();
          }}
          className={cn(
            'p-2 rounded-xl border transition-all active:scale-95 ml-auto',
            coachActive
              ? 'bg-violet-600/20 text-violet-400 border-violet-500/30'
              : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-violet-400',
          )}
          aria-label="Coach Analysis"
        >
          <Wand2 size={14} />
        </button>
      </div>

      {/* ── MOBILE ONLY: Merged Coach Widget ──────────────────────────────── */}
      <div className="lg:hidden shrink-0">
        <TrainingCoachWidget
          fen={fen}
          onDeepAnalysis={onDeepAnalysis}
          onShowSolution={onShowSolution}
          onGiveUp={onGiveUp}
          coachActive={coachActive}
          onCoachActiveChange={setCoachActive}
          onPlayMove={onPlayRepertoireMove}
          onPlayMainline={onPlayMainline}
          onDemoEngineLine={onDemoEngineLine}
          onHighlightEngineLine={onHighlightEngineLine}
          onStopHighlight={onStopHighlight}
        />
      </div>

      {/* ── DESKTOP ONLY: Right Sidebar (completely unchanged) ────────────── */}
      <div className="hidden lg:flex w-full lg:w-[420px] bg-[#0a0d14] border-t border-b-0 lg:border-t-0 lg:border-l border-white/5 flex-col z-20 shrink-0 lg:h-full overflow-hidden">
        <div className="p-3 lg:p-6 border-b border-white/5 bg-white/[0.02]">
          <ModeSelector onSelect={() => onStartTraining()} />
        </div>
        {mode !== 'explore' && <TacticalMonitor />}
        <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
            <MoveLedger
              ledger={ledger}
              activeMoveIdx={moveHistory.length - 1}
              onMoveClick={onJumpToMove}
            />
          </div>
        </div>
        {mode === 'explore' ? (
          <ExplorePanel
            fen={fen}
            onPlayMove={onPlayRepertoireMove}
            onPlayMainline={onPlayMainline}
            onDemoEngineLine={onDemoEngineLine}
            onHighlightEngineLine={onHighlightEngineLine}
            onStopHighlight={onStopHighlight}
          />
        ) : (
          <CoachPanel
            fen={fen}
            onDeepAnalysis={onDeepAnalysis}
            onPlayDemo={onPlayDemo}
            onShowSolution={onShowSolution}
            onGiveUp={onGiveUp}
          />
        )}
      </div>

    </div>
  );
};
