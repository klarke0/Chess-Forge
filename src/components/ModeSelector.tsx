import React from 'react';
import { Play, Target, Brain, BookOpen, GraduationCap, Compass } from 'lucide-react';
import { useTrainingStore, TrainingMode } from '../stores/trainingStore';
import { cn } from '../utils/cn';

interface ModeSelectorProps {
  onSelect?: () => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({ onSelect }) => {
  const { mode, setMode, status, learnRunsCompleted } = useTrainingStore();

  const modes: { id: TrainingMode; label: string; icon: any; desc: string }[] = [
    { id: 'study',   label: 'Study',     icon: GraduationCap, desc: 'Guided walkthrough: plays moves and shows annotations' },
    { id: 'learn',   label: 'Learn',     icon: BookOpen, desc: 'Step-by-step: move is shown, repeat 3× to master' },
    { id: 'full',    label: 'Full Line', icon: Play,     desc: 'Master sequences from start to finish' },
    { id: 'weak',    label: 'Weak Spot', icon: Target,   desc: 'Drill positions you previously missed' },
    { id: 'quiz',    label: 'Quiz',      icon: Brain,    desc: 'Random mid-game position challenges' },
    { id: 'explore', label: 'Explore',   icon: Compass,  desc: 'Free exploration: browse repertoire lines, compare engine suggestions, play out the mainline' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Training Mode</h3>
        {mode === 'learn' ? (
          <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
            {learnRunsCompleted}/3 runs
          </span>
        ) : (
          <span className="text-[9px] font-bold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded-full border border-orange-500/20">
            {modes.find(m => m.id === mode)?.label}
          </span>
        )}
      </div>
      
      <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 gap-1">
        {modes.map((m) => (
          <button
            key={m.id}
            disabled={status === 'demo'}
            onClick={() => {
              setMode(m.id);
              if (onSelect) onSelect();
            }}
            className={cn(
              "flex-1 flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl transition-all relative group",
              mode === m.id ? "bg-orange-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300 hover:bg-white/5",
              status === 'demo' && "opacity-50 cursor-not-allowed"
            )}
          >
            <m.icon size={16} className={cn(mode === m.id ? "text-white" : "text-slate-600")} />
            <span className="text-[8px] font-black uppercase tracking-wider">{m.label}</span>
          </button>
        ))}
      </div>
      
      <p className="text-[10px] text-slate-500 px-1 leading-relaxed italic">
        {modes.find(m => m.id === mode)?.desc}
      </p>
    </div>
  );
};
