import React, { useState, useEffect } from 'react';
import {
  Sparkles, TrendingUp, CheckCircle2, CalendarClock, Clock, BookOpen, Activity,
  AlertTriangle, Brain, Loader2, RefreshCw,
  BarChart3, Target,
} from 'lucide-react';
import { cn } from '../utils/cn';
import { useRepertoireStore } from '../stores/repertoireStore';
import * as api from '../services/api';

interface InsightsTabProps {
  // Unused
}

// ── Stat card ─────────────────────────────────────────────────────────────────
const StatCard: React.FC<{
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  bg: string;
  onClick?: () => void;
  hint?: string;
}> = ({ label, value, icon, color, bg, onClick, hint }) => (
  <div
    onClick={onClick}
    className={cn(
      'bg-[#11151c] border border-white/5 rounded-2xl p-5 relative overflow-hidden group',
      onClick && 'cursor-pointer hover:border-white/10 transition-colors',
    )}
  >
    <div className={cn('absolute -right-3 -bottom-3 opacity-5 group-hover:opacity-10 transition-opacity', color)}>
      <div className="text-[80px]">{icon}</div>
    </div>
    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">{label}</p>
    <div className="flex items-center gap-3">
      <div className={cn('p-2 rounded-xl', bg, color)}>{icon}</div>
      <span className="text-2xl font-black text-white">{value}</span>
    </div>
    {hint && <p className="text-[9px] text-slate-600 mt-2 font-bold uppercase tracking-wide">{hint}</p>}
  </div>
);

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Pattern analysis panel ─────────────────────────────────────────────────────
const PatternPanel: React.FC<{
  cached: api.PatternAnalysis | null;
  onRerun: (result: api.PatternAnalysis) => void;
}> = ({ cached, onRerun }) => {
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const data = await api.runPatternAnalysis();
      onRerun(data);
    } catch {
      onRerun({
        summary: 'Analysis unavailable — make sure the backend is running.',
        patterns: [], action: null, createdAt: null,
        stats: {
          totalGames: 0, gamesAnalyzed: 0,
          whiteWins: 0, whiteDraws: 0, whiteLosses: 0, blackWins: 0, blackDraws: 0, blackLosses: 0,
          opening: 0, middlegame: 0, endgame: 0,
          gamesLostOnTime: 0, blundersUnderPressure: 0,
          shapes: {}, avgTimeWhite: null, avgTimeBlack: null,
        },
        openings: [], isError: true,
      });
    } finally {
      setRunning(false);
    }
  };

  if (!cached && !running) {
    return (
      <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-6 flex flex-col items-center gap-4 text-center">
        <div className="w-12 h-12 bg-violet-500/10 rounded-full flex items-center justify-center">
          <Brain size={24} className="text-violet-400" />
        </div>
        <div>
          <p className="font-bold text-slate-200 text-sm">Pattern Recognition</p>
          <p className="text-slate-500 text-xs mt-1 max-w-xs">
            AI analysis of recurring weaknesses. Results are saved until you re-run.
          </p>
        </div>
        <button onClick={run}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all">
          <Sparkles size={14} /> Run Analysis
        </button>
      </div>
    );
  }

  if (running) {
    return (
      <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-8 flex flex-col items-center gap-3">
        <Loader2 size={28} className="text-violet-400 animate-spin" />
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest animate-pulse">Analysing patterns…</p>
      </div>
    );
  }

  if (!cached) return null;

  const timeAgo = cached.createdAt ? formatTimeAgo(cached.createdAt) : null;

  return (
    <div className="bg-[#0d1117] border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 bg-[#080a0f] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-violet-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-violet-400">Pattern Report</span>
        </div>
        <div className="flex items-center gap-3">
          {timeAgo && <span className="text-[10px] text-slate-600">last run {timeAgo}</span>}
          <button onClick={run} disabled={running}
            className="text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40" title="Re-run">
            <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {cached.stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Win Rates</p>
              {cached.stats.whiteWins + cached.stats.whiteDraws + cached.stats.whiteLosses > 0 && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">As White</span>
                  <div className="flex gap-1.5">
                    <span className="text-emerald-400 font-bold">{cached.stats.whiteWins}W</span>
                    <span className="text-slate-500">{cached.stats.whiteDraws}D</span>
                    <span className="text-rose-400 font-bold">{cached.stats.whiteLosses}L</span>
                  </div>
                </div>
              )}
              {cached.stats.blackWins + cached.stats.blackDraws + cached.stats.blackLosses > 0 && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">As Black</span>
                  <div className="flex gap-1.5">
                    <span className="text-emerald-400 font-bold">{cached.stats.blackWins}W</span>
                    <span className="text-slate-500">{cached.stats.blackDraws}D</span>
                    <span className="text-rose-400 font-bold">{cached.stats.blackLosses}L</span>
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-rows-3 gap-1">
              {[
                { label: 'Opening', value: cached.stats.opening, color: 'text-amber-400' },
                { label: 'Middlegame', value: cached.stats.middlegame, color: 'text-orange-400' },
                { label: 'Endgame', value: cached.stats.endgame, color: 'text-rose-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white/[0.02] border border-white/5 rounded-lg px-3 flex items-center justify-between">
                  <p className="text-[9px] text-slate-600 uppercase tracking-wide font-bold">{label}</p>
                  <p className={cn('text-sm font-black', color)}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className={cn('text-sm leading-relaxed', cached.isError ? 'text-rose-400' : 'text-slate-300')}>
          {cached.summary}
        </p>

        {cached.patterns.length > 0 && (
          <div className="space-y-2">
            {cached.patterns.map((p, i) => (
              <div key={i} className="flex items-start gap-2.5 bg-violet-500/5 border border-violet-500/15 rounded-xl px-3 py-2.5">
                <AlertTriangle size={13} className="text-violet-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-300 leading-relaxed">{p}</p>
              </div>
            ))}
          </div>
        )}

        {cached.action && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <Target size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500 mb-1">Recommended Focus</p>
              <p className="text-xs text-slate-300 leading-relaxed">{cached.action}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main InsightsTab ────────────────────────────────────────────────────────────
export const InsightsTab: React.FC<InsightsTabProps> = () => {
  const { chapters, getChapterMastery, weakPositions } = useRepertoireStore();
  const repertoireId = useRepertoireStore(s => s.repertoireId);

  const [stats, setStats] = useState<api.ProgressStats | null>(null);
  const [patternReport, setPatternReport] = useState<api.PatternAnalysis | null>(null);

  useEffect(() => {
    if (!repertoireId) return;
    api.getProgressStats(repertoireId)
      .then(setStats)
      .catch(() => {});
    
    api.getPatternReport()
      .then(r => setPatternReport(r))
      .catch(() => {});
  }, [repertoireId]);

  const weakCount = Object.keys(weakPositions).length;
  const totalMastery = chapters.length
    ? Math.round(chapters.reduce((s, _, i) => s + getChapterMastery(i), 0) / chapters.length)
    : 0;

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#050507] custom-scrollbar">
      <div className="max-w-4xl mx-auto p-6 space-y-6 pb-24 md:pb-6">
        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-2xl font-black text-white uppercase tracking-tight">Insights</h1>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">
              Performance analytics
            </p>
          </div>
          <div className="w-10 h-10 bg-violet-600/20 rounded-xl flex items-center justify-center">
            <Sparkles size={18} className="text-violet-400" />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard
            label="Weekly Accuracy"
            value={stats ? `${Math.round((stats.weeklyAccuracy || 0) * 100)}%` : '—'}
            icon={<TrendingUp size={16} />}
            color="text-emerald-400"
            bg="bg-emerald-500/10"
          />
          <StatCard
            label="Positions Mastered"
            value={stats?.mastered ?? '—'}
            icon={<CheckCircle2 size={16} />}
            color="text-emerald-400"
            bg="bg-emerald-500/10"
          />
          <StatCard
            label="Due Today"
            value={stats?.dueToday ?? '—'}
            icon={<CalendarClock size={16} />}
            color="text-amber-400"
            bg="bg-amber-500/10"
          />
          <StatCard
            label="Weak Points"
            value={weakCount}
            icon={<AlertTriangle size={16} />}
            color="text-rose-400"
            bg="bg-rose-500/10"
          />
          <StatCard
            label="Time Pressure"
            value={patternReport?.stats.blundersUnderPressure ?? '—'}
            icon={<Clock size={16} />}
            color="text-orange-400"
            bg="bg-orange-500/10"
            hint="Mistakes under pressure"
          />
        </div>

        {/* Repertoire coverage */}
        <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={14} className="text-indigo-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Repertoire Coverage</span>
            </div>
            <span className="text-[10px] text-slate-600 font-bold">{totalMastery}% avg mastery</span>
          </div>
          <div className="space-y-3">
            {chapters.map((chapter, i) => {
              const mastery = getChapterMastery(i);
              return (
                <div key={i}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-slate-400 truncate pr-4">{chapter.name}</span>
                    <span className="text-[10px] font-black text-slate-500 shrink-0">{mastery}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-700',
                        mastery > 80 ? 'bg-emerald-500' : mastery > 40 ? 'bg-indigo-500' : 'bg-rose-500',
                      )}
                      style={{ width: `${mastery}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {patternReport?.openings && patternReport.openings.length > 0 && (
          <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BookOpen size={14} className="text-emerald-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Opening Breakdown</span>
              </div>
              <span className="text-[10px] text-slate-600 font-bold">last {patternReport.stats.gamesAnalyzed} games</span>
            </div>
            <div className="space-y-2.5">
              {patternReport.openings.map(op => (
                <div key={op.name}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-slate-400 truncate pr-4">{op.name}</span>
                    <div className="flex items-center gap-2 shrink-0 text-[10px] font-bold">
                      <span className="text-emerald-400">{op.winPct}%W</span>
                      <span className="text-slate-500">{op.drawPct}%D</span>
                      <span className="text-rose-400">{op.lossPct}%L</span>
                      <span className="text-slate-600">({op.games}g)</span>
                    </div>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden flex">
                    <div className="h-full bg-emerald-600" style={{ width: `${op.winPct}%` }} />
                    <div className="h-full bg-slate-600" style={{ width: `${op.drawPct}%` }} />
                    <div className="h-full bg-rose-600" style={{ width: `${op.lossPct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {patternReport?.stats.shapes && Object.keys(patternReport.stats.shapes).length > 0 && (
          <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-amber-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">Game Shape Distribution</span>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {(['Smooth', 'Balanced', 'Sharp', 'Wild', 'Sudden', 'Giveaway', 'Intense'] as const).map(shape => {
                const count = patternReport.stats.shapes[shape] ?? 0;
                const COLORS: Record<string, string> = {
                  Smooth:   'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                  Balanced: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
                  Sharp:    'text-amber-400 bg-amber-500/10 border-amber-500/20',
                  Wild:     'text-rose-400 bg-rose-500/10 border-rose-500/20',
                  Sudden:   'text-orange-400 bg-orange-500/10 border-orange-500/20',
                  Giveaway: 'text-red-400 bg-red-500/10 border-red-500/20',
                  Intense:  'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
                };
                return (
                  <div key={shape}
                    className={cn('border rounded-xl py-2 px-1 text-center',
                      count > 0 ? COLORS[shape] : 'text-slate-700 bg-white/[0.02] border-white/5')}
                    title={shape}>
                    <p className="text-lg font-black">{count}</p>
                    <p className="text-[8px] uppercase tracking-wide font-bold opacity-70 truncate px-0.5">{shape}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pattern Recognition */}
        <PatternPanel
          cached={patternReport}
          onRerun={(result) => setPatternReport(result)}
        />
      </div>
    </div>
  );
};
