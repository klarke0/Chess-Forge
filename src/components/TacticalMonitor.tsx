import React from 'react';
import { CheckCircle2, Zap, AlertCircle, Bot } from 'lucide-react';
import { useTrainingStore } from '../stores/trainingStore';
import { cn } from '../utils/cn';

export const TacticalMonitor: React.FC = () => {
  const { status, message, hint } = useTrainingStore();

  return (
    <div className={cn(
      "p-6 border-b transition-all duration-700 relative overflow-hidden bg-white/[0.01]",
      status === 'correct' ? "border-emerald-500/30 bg-emerald-500/5 shadow-inner shadow-emerald-500/10" :
      status === 'novelty' ? "border-indigo-500/30 bg-indigo-500/5 shadow-inner shadow-indigo-500/10" :
      status === 'wrong' ? "border-rose-500/30 bg-rose-500/5 shadow-inner shadow-rose-500/10 animate-shake" : "border-white/5"
    )}>
      <div className="flex gap-4">
        <div className={cn(
          "w-12 h-12 rounded-2xl flex items-center justify-center shadow-xl shrink-0 transition-transform duration-500",
          status === 'correct' ? "bg-emerald-500 text-white scale-105" :
          status === 'novelty' ? "bg-indigo-500 text-white animate-pulse" :
          status === 'wrong' ? "bg-rose-500 text-white scale-105" : "bg-white/5 text-slate-500"
        )}>
          {status === 'correct' ? <CheckCircle2 size={24} /> :
           status === 'novelty' ? <Zap size={24} /> :
           status === 'wrong' ? <AlertCircle size={24} /> : <Bot size={24} />}
        </div>
        <div className="flex-1 py-0.5">
          <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-600 mb-1">Tactical Monitor</h2>
          <p className="text-lg font-bold leading-tight text-white mb-1.5">{message}</p>
          {hint && (
            <div className="text-[10px] font-black text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20 uppercase tracking-widest inline-block">
              Correction: {hint}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
