import React, { useEffect, useState } from 'react';
import { Play, Film, BookOpen, Flame } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useRepertoireStore } from '@/stores/repertoireStore';
import * as api from '@/services/api';

interface HomeScreenProps {
  onTrainNow: () => void;
  onGames: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onTrainNow, onGames }) => {
  const repertoireId = useRepertoireStore(s => s.repertoireId);
  const [count, setCount] = useState<api.TrainNowCounts | null>(null);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!repertoireId) return;
    setLoading(true);

    // Fetch train-now counts and progress stats in parallel
    Promise.all([
      api.getTrainNowCounts(repertoireId)
        .catch(() => ({ total: 0, blunders: 0, deviations: 0, review: 0 } as api.TrainNowCounts)),
      api.getProgressStats(repertoireId).catch(() => null),
    ]).then(([counts, stats]) => {
      setCount(counts);
      if (stats) {
        setStreak(stats.streak);
      }
    }).finally(() => setLoading(false));
  }, [repertoireId]);

  const greeting = getGreeting();

  return (
    <div className="flex-1 flex flex-col px-6 pt-12 pb-24 overflow-y-auto">
      {/* Greeting + Streak */}
      <div className="mb-10">
        <h1 className="text-2xl font-black text-slate-100 tracking-tight">
          {greeting}
        </h1>
        {streak > 0 && (
          <div className="flex items-center gap-2 mt-2 text-sm text-slate-400">
            <Flame size={16} className="text-orange-400" />
            <span className="font-semibold">{streak} day streak</span>
          </div>
        )}
      </div>

      {/* Train Now Card */}
      <div className="bg-[#0d1117] border border-white/5 rounded-[2.5rem] p-8 mb-6">
        {loading ? (
          <div className="space-y-3">
            <div className="h-4 w-40 bg-white/5 rounded-full animate-pulse" />
            <div className="h-4 w-24 bg-white/5 rounded-full animate-pulse" />
          </div>
        ) : count && count.total > 0 ? (
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            {[
              count.blunders > 0 && <span key="b" className="text-rose-400 font-semibold">{count.blunders} blunder{count.blunders !== 1 ? 's' : ''}</span>,
              count.deviations > 0 && <span key="d" className="text-amber-400 font-semibold">{count.deviations} deviation{count.deviations !== 1 ? 's' : ''}</span>,
              count.review > 0 && <span key="r" className="text-slate-200 font-semibold">{count.review} review</span>,
            ].filter(Boolean).reduce<React.ReactNode[]>((acc, el, i) => {
              if (i > 0) acc.push(<span key={`sep-${i}`} className="text-slate-600"> &middot; </span>);
              acc.push(el);
              return acc;
            }, [])}
          </p>
        ) : (
          <p className="text-sm text-slate-400 mb-6">
            No positions due — check back after your next game
          </p>
        )}

        <button
          onClick={onTrainNow}
          className={cn(
            'w-full flex items-center justify-center gap-3',
            'bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]',
            'text-white font-black text-lg uppercase tracking-widest',
            'py-5 rounded-2xl transition-all',
            'shadow-xl shadow-indigo-600/30',
            'border border-indigo-400/20',
          )}
        >
          <Play size={22} fill="currentColor" />
          Train Now
        </button>
      </div>

      {/* Secondary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={onGames}
          className={cn(
            'flex flex-col items-center justify-center gap-3 p-6',
            'bg-[#0d1117] border border-white/5 rounded-[2rem]',
            'text-slate-400 hover:text-slate-200 transition-all active:scale-[0.98]',
          )}
        >
          <Film size={24} />
          <span className="text-xs font-black uppercase tracking-wider">Review Games</span>
        </button>

        <button
          onClick={() => {}}
          className={cn(
            'flex flex-col items-center justify-center gap-3 p-6',
            'bg-[#0d1117] border border-white/5 rounded-[2rem]',
            'text-slate-400 hover:text-slate-200 transition-all active:scale-[0.98]',
          )}
        >
          <BookOpen size={24} />
          <span className="text-xs font-black uppercase tracking-wider">Browse Library</span>
        </button>
      </div>
    </div>
  );
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
