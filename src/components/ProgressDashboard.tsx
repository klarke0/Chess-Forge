import React, { useState, useEffect } from 'react';
import { Target, TrendingUp, AlertTriangle, Play, CheckCircle2, CalendarClock } from 'lucide-react';
import { cn } from '../utils/cn';
import { useRepertoireStore } from '../stores/repertoireStore';

interface ProgressDashboardProps {
  onClose: () => void;
  onSelectChapter: (idx: number) => void;
  onDrillWeak: () => void;
  totalPositions: number;
}

export const ProgressDashboard: React.FC<ProgressDashboardProps> = ({
  onClose,
  onSelectChapter,
  onDrillWeak,
  totalPositions
}) => {
  const { weakPositions, chapters, getChapterMastery } = useRepertoireStore();
  const weakCount = Object.keys(weakPositions).length;

  const [stats, setStats] = useState<{
    totalTracked: number; mastered: number; dueToday: number;
    weeklyAccuracy: number; streak: number;
  } | null>(null);

  useEffect(() => {
    const id = useRepertoireStore.getState().repertoireId;
    if (!id) return;
    fetch(`/api/progress/${id}/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <div className="absolute inset-0 z-40 p-12 bg-[#080a0f] overflow-y-auto animate-in fade-in zoom-in-95 duration-500">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-end mb-12 border-b border-white/10 pb-8">
          <div>
            <h2 className="text-5xl font-black text-white uppercase italic tracking-tighter font-outfit">Performance Hub</h2>
            <p className="text-slate-400 font-bold uppercase tracking-[0.3em] mt-2 text-[10px]">Personal Mastery Analytics</p>
          </div>
          <button onClick={onClose} className="px-8 py-3 bg-[#1a1f26] hover:bg-[#252b35] text-slate-200 font-black uppercase tracking-widest text-xs rounded-xl border border-white/10 transition-all">
            Return to Board
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-4">
          {[
            { label: 'Weekly Accuracy', value: stats ? `${Math.round((stats.weeklyAccuracy || 0) * 100)}%` : '—', icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10', onClick: undefined },
            { label: 'Positions Mastered', value: stats?.mastered ?? '—', icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', onClick: undefined },
            { label: 'Due Today', value: stats?.dueToday ?? '—', icon: CalendarClock, color: 'text-amber-400', bg: 'bg-amber-500/10', onClick: undefined },
            { label: 'Weak Points', value: weakCount, icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-500/10', onClick: weakCount > 0 ? onDrillWeak : undefined },
          ].map((stat, i) => (
            <div
              key={i}
              onClick={stat.onClick}
              className={cn(
                "bg-[#11151c] border border-white/10 p-8 rounded-[2.5rem] relative overflow-hidden group shadow-xl",
                stat.onClick ? "cursor-pointer hover:border-rose-500/40" : ""
              )}
            >
              <div className={cn("absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity", stat.color)}>
                <stat.icon size={120} />
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">{stat.label}</p>
              <div className="flex items-center gap-4">
                <div className={cn("p-3 rounded-2xl", stat.bg, stat.color)}>
                  <stat.icon size={20} />
                </div>
                <span className="text-3xl font-black text-white">{stat.value}</span>
              </div>
              {stat.onClick && (
                <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest mt-3">Click to drill →</p>
              )}
            </div>
          ))}
        </div>
        {stats && <p className="text-slate-600 text-xs text-center mb-8">{stats.totalTracked} positions tracked · {totalPositions} in repertoire</p>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-12 bg-[#11151c] border border-white/10 rounded-[3rem] p-10 shadow-xl">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-300 mb-8 flex items-center gap-3">
              <TrendingUp size={16} className="text-indigo-500" /> Repertoire Coverage
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              {chapters.map((chapter, i) => {
                const mastery = getChapterMastery(i);
                return (
                  <button 
                    key={i} 
                    onClick={() => onSelectChapter(i)}
                    className="group text-left"
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-bold text-white group-hover:text-indigo-400 transition-colors truncate pr-4 text-sm">{chapter.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">{mastery}%</span>
                        <Play size={10} className="text-slate-600 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                      </div>
                    </div>
                    <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5 group-hover:border-indigo-500/20 transition-all">
                      <div 
                        className={cn(
                          "h-full transition-all duration-1000",
                          mastery > 80 ? "bg-emerald-500" : mastery > 40 ? "bg-indigo-500" : "bg-rose-500"
                        )} 
                        style={{ width: `${mastery}%` }}
                      ></div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {weakCount > 0 && (
          <div className="mt-12 bg-rose-600 rounded-[3rem] p-12 flex flex-col md:flex-row items-center justify-between relative overflow-hidden group shadow-2xl shadow-rose-900/20">
            <div className="absolute top-0 right-0 p-12 opacity-10 group-hover:scale-110 transition-transform"><Target size={200} /></div>
            <div className="relative z-10 text-center md:text-left mb-8 md:mb-0">
              <h3 className="text-3xl font-black text-white uppercase italic leading-none mb-2">Targeted Drill Ready</h3>
              <p className="text-rose-100 font-bold uppercase tracking-[0.2em] text-xs">You have {weakCount} positions requiring immediate review.</p>
            </div>
            <button onClick={onDrillWeak} className="relative z-10 bg-white text-rose-600 px-10 py-5 rounded-[2rem] font-black uppercase tracking-[0.2em] shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center gap-3">
              Fix Weak Spots <Play size={20} fill="currentColor" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
