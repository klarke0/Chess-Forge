import React, { useState, useEffect } from "react";
import {
  Sparkles,
  TrendingUp,
  CheckCircle2,
  CalendarClock,
  Clock,
  BookOpen,
  Activity,
  AlertTriangle,
  Brain,
  Loader2,
  RefreshCw,
  BarChart3,
  Target,
  Zap,
  Sun,
  Sunset,
  Moon,
  Sunrise,
  Shield,
} from "lucide-react";
import { cn } from "../utils/cn";
import { useRepertoireStore } from "../stores/repertoireStore";
import * as api from "../services/api";
import type { GameTypeStat } from "../services/api";

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
  className?: string;
}> = ({ label, value, icon, color, bg, onClick, hint, className }) => (
  <div
    onClick={onClick}
    className={cn(
      "bg-[#11151c] border border-white/5 rounded-2xl p-5 relative overflow-hidden group",
      onClick && "cursor-pointer hover:border-white/10 transition-colors",
      className,
    )}
  >
    <div
      className={cn(
        "absolute -right-3 -bottom-3 opacity-5 group-hover:opacity-10 transition-opacity",
        color,
      )}
    >
      <div className="text-[80px]">{icon}</div>
    </div>
    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
      {label}
    </p>
    <div className="flex items-center gap-3">
      <div className={cn("p-2 rounded-xl", bg, color)}>{icon}</div>
      <span className="text-2xl font-black text-white">{value}</span>
    </div>
    {hint && (
      <p className="text-[9px] text-slate-600 mt-2 font-bold uppercase tracking-wide">
        {hint}
      </p>
    )}
  </div>
);

/** Strip common markdown formatting so AI-generated text renders cleanly */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/\*(.+?)\*/g, "$1")      // *italic*
    .replace(/`(.+?)`/g, "$1")        // `code`
    .replace(/^#+\s/gm, "")           // headings
    .trim();
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
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
        summary: "Analysis unavailable — make sure the backend is running.",
        patterns: [],
        action: null,
        createdAt: null,
        stats: {
          totalGames: 0,
          gamesAnalyzed: 0,
          whiteWins: 0,
          whiteDraws: 0,
          whiteLosses: 0,
          blackWins: 0,
          blackDraws: 0,
          blackLosses: 0,
          opening: 0,
          middlegame: 0,
          endgame: 0,
          gamesLostOnTime: 0,
          blundersUnderPressure: 0,
          shapes: {},
          avgTimeWhite: null,
          avgTimeBlack: null,
        },
        openings: [],
        isError: true,
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
          <p className="font-bold text-slate-200 text-sm">
            Pattern Recognition
          </p>
          <p className="text-slate-500 text-xs mt-1 max-w-xs">
            AI analysis of recurring weaknesses. Results are saved until you
            re-run.
          </p>
        </div>
        <button
          onClick={run}
          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all"
        >
          <Sparkles size={14} /> Run Analysis
        </button>
      </div>
    );
  }

  if (running) {
    return (
      <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-8 flex flex-col items-center gap-3">
        <Loader2 size={28} className="text-violet-400 animate-spin" />
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest animate-pulse">
          Analysing patterns…
        </p>
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
          <span className="text-[10px] font-black uppercase tracking-widest text-violet-400">
            Pattern Report
          </span>
        </div>
        <div className="flex items-center gap-3">
          {timeAgo && (
            <span className="text-[10px] text-slate-600">
              last run {timeAgo}
            </span>
          )}
          <button
            onClick={run}
            disabled={running}
            className="text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
            title="Re-run"
          >
            <RefreshCw size={12} className={running ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {cached.stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">
                Win Rates
              </p>
              {cached.stats.whiteWins +
                cached.stats.whiteDraws +
                cached.stats.whiteLosses >
                0 && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">As White</span>
                  <div className="flex gap-1.5">
                    <span className="text-emerald-400 font-bold">
                      {cached.stats.whiteWins}W
                    </span>
                    <span className="text-slate-500">
                      {cached.stats.whiteDraws}D
                    </span>
                    <span className="text-rose-400 font-bold">
                      {cached.stats.whiteLosses}L
                    </span>
                  </div>
                </div>
              )}
              {cached.stats.blackWins +
                cached.stats.blackDraws +
                cached.stats.blackLosses >
                0 && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">As Black</span>
                  <div className="flex gap-1.5">
                    <span className="text-emerald-400 font-bold">
                      {cached.stats.blackWins}W
                    </span>
                    <span className="text-slate-500">
                      {cached.stats.blackDraws}D
                    </span>
                    <span className="text-rose-400 font-bold">
                      {cached.stats.blackLosses}L
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-rows-3 gap-1">
              {[
                {
                  label: "Opening",
                  value: cached.stats.opening,
                  color: "text-amber-400",
                },
                {
                  label: "Middlegame",
                  value: cached.stats.middlegame,
                  color: "text-orange-400",
                },
                {
                  label: "Endgame",
                  value: cached.stats.endgame,
                  color: "text-rose-400",
                },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="bg-white/[0.02] border border-white/5 rounded-lg px-3 flex items-center justify-between"
                >
                  <p className="text-[9px] text-slate-600 uppercase tracking-wide font-bold">
                    {label}
                  </p>
                  <p className={cn("text-sm font-black", color)}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p
          className={cn(
            "text-sm leading-relaxed",
            cached.isError ? "text-rose-400" : "text-slate-300",
          )}
        >
          {stripMarkdown(cached.summary)}
        </p>

        {cached.patterns.length > 0 && (
          <div className="space-y-2">
            {cached.patterns.map((p, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 bg-violet-500/5 border border-violet-500/15 rounded-xl px-3 py-2.5"
              >
                <AlertTriangle
                  size={13}
                  className="text-violet-400 mt-0.5 shrink-0"
                />
                <p className="text-xs text-slate-300 leading-relaxed">{stripMarkdown(p)}</p>
              </div>
            ))}
          </div>
        )}

        {cached.action && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-start gap-2.5">
            <Target size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500 mb-1">
                Recommended Focus
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                {stripMarkdown(cached.action)}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Game Type Breakdown panel ──────────────────────────────────────────────────
const TIME_CLASS_LABELS: Record<string, string> = {
  bullet: "Bullet",
  blitz: "Blitz",
  rapid: "Rapid",
  daily: "Daily",
};

const TIME_CLASS_COLORS: Record<string, { bar: string; text: string; bg: string; border: string }> = {
  bullet:  { bar: "bg-rose-500",   text: "text-rose-400",   bg: "bg-rose-500/10",   border: "border-rose-500/20" },
  blitz:   { bar: "bg-amber-500",  text: "text-amber-400",  bg: "bg-amber-500/10",  border: "border-amber-500/20" },
  rapid:   { bar: "bg-emerald-500",text: "text-emerald-400",bg: "bg-emerald-500/10",border: "border-emerald-500/20" },
  daily:   { bar: "bg-indigo-500", text: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
};

const GameTypePanel: React.FC = () => {
  const [data, setData] = useState<GameTypeStat[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .fetchGameTypeStats()
      .then((d) => setData(d.byType))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-6 flex items-center justify-center gap-2">
        <Loader2 size={16} className="text-indigo-400 animate-spin" />
        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
          Loading...
        </span>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-6 text-center">
        <p className="text-xs text-slate-500 font-semibold">No game data yet.</p>
      </div>
    );
  }

  const totalGames = data.reduce((s, r) => s + r.games, 0);

  return (
    <div className="bg-[#0d1117] border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 bg-[#080a0f] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-indigo-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
            By Time Control
          </span>
        </div>
        <span className="text-[10px] text-slate-600 font-bold">{totalGames} total games</span>
      </div>
      <div className="p-5 space-y-4">
        {data.map((row) => {
          const colors = TIME_CLASS_COLORS[row.timeClass] ?? TIME_CLASS_COLORS.rapid;
          const label = TIME_CLASS_LABELS[row.timeClass] ?? row.timeClass;
          return (
            <div key={row.timeClass}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs font-black uppercase tracking-wide", colors.text)}>
                    {label}
                  </span>
                  <span className="text-[10px] text-slate-600 font-bold">{row.games}g</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold">
                  <span className="text-emerald-400">{row.winPct}%W</span>
                  <span className="text-slate-500">{row.drawPct}%D</span>
                  <span className="text-rose-400">{row.lossPct}%L</span>
                </div>
              </div>
              {/* Stacked bar: win / draw / loss */}
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-emerald-600 transition-all duration-700"
                  style={{ width: `${row.winPct}%` }}
                />
                <div
                  className="h-full bg-slate-600 transition-all duration-700"
                  style={{ width: `${row.drawPct}%` }}
                />
                <div
                  className="h-full bg-rose-600 transition-all duration-700"
                  style={{ width: `${row.lossPct}%` }}
                />
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <span className="text-[9px] text-emerald-500 font-bold">{row.wins}W</span>
                <span className="text-[9px] text-slate-600">·</span>
                <span className="text-[9px] text-slate-500">{row.draws}D</span>
                <span className="text-[9px] text-slate-600">·</span>
                <span className="text-[9px] text-rose-500 font-bold">{row.losses}L</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Weekly drill accuracy trend panel ────────────────────────────────────────

const WeeklyAccuracyPanel: React.FC = () => {
  const [data, setData] = useState<api.WeeklyAccuracyWeek[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .fetchWeeklyAccuracy()
      .then((d) => setData(d.weeks))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 flex items-center justify-center gap-2">
        <Loader2 size={16} className="text-forge-insight animate-spin" />
        <span className="text-[10px] text-forge-text-muted font-bold uppercase tracking-widest">
          Loading accuracy…
        </span>
      </div>
    );
  }

  const weeks = data ?? [];
  const hasData = weeks.some((w) => w.accuracy !== null);

  if (!hasData) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 text-center">
        <p className="text-xs text-forge-text-muted font-semibold">
          No drill data yet — complete a session to see your accuracy trend.
        </p>
      </div>
    );
  }

  const maxAcc = Math.max(...weeks.map((w) => w.accuracy ?? 0), 1);
  // Average accuracy across weeks that have data
  const weeksWithData = weeks.filter((w) => w.accuracy !== null);
  const avgAcc =
    weeksWithData.length > 0
      ? Math.round(
          weeksWithData.reduce((s, w) => s + (w.accuracy ?? 0), 0) /
            weeksWithData.length,
        )
      : null;

  // Detect trend: compare last 4 weeks vs prior 4 weeks
  const recent = weeks.slice(4).filter((w) => w.accuracy !== null);
  const older = weeks.slice(0, 4).filter((w) => w.accuracy !== null);
  const recentAvg =
    recent.length > 0
      ? recent.reduce((s, w) => s + (w.accuracy ?? 0), 0) / recent.length
      : null;
  const olderAvg =
    older.length > 0
      ? older.reduce((s, w) => s + (w.accuracy ?? 0), 0) / older.length
      : null;
  const trend =
    recentAvg !== null && olderAvg !== null
      ? recentAvg - olderAvg
      : null;

  return (
    <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-forge-border-subtle bg-forge-surface flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-forge-insight" />
          <span className="text-[10px] font-black uppercase tracking-widest text-forge-insight">
            Accuracy Trend
          </span>
        </div>
        <div className="flex items-center gap-2">
          {trend !== null && (
            <span
              className={cn(
                "text-[10px] font-black",
                trend > 2
                  ? "text-forge-success"
                  : trend < -2
                    ? "text-forge-danger"
                    : "text-forge-text-muted",
              )}
            >
              {trend > 0 ? "+" : ""}
              {Math.round(trend)}% vs prior 4w
            </span>
          )}
          {avgAcc !== null && (
            <span className="text-[10px] text-forge-text-muted font-bold">
              avg {avgAcc}%
            </span>
          )}
        </div>
      </div>
      <div className="p-5 space-y-2">
        {weeks.map((week) => {
          const acc = week.accuracy;
          const barWidth = acc !== null ? (acc / maxAcc) * 100 : 0;
          const barColor =
            acc === null
              ? "bg-forge-border-subtle"
              : acc >= 80
                ? "bg-forge-success"
                : acc >= 60
                  ? "bg-amber-500"
                  : "bg-forge-danger";

          return (
            <div key={week.label} className="flex items-center gap-3">
              <span className="text-[10px] text-forge-text-muted font-bold w-14 shrink-0 text-right tabular-nums">
                {week.label}
              </span>
              <div className="flex-1 h-5 bg-forge-border-subtle rounded-md overflow-hidden relative">
                {acc !== null && (
                  <div
                    className={cn(
                      "h-full rounded-md transition-all duration-500",
                      barColor,
                      "opacity-70",
                    )}
                    style={{ width: `${barWidth}%` }}
                  />
                )}
              </div>
              <span className="text-[11px] font-black w-8 text-right tabular-nums shrink-0 text-forge-text-primary">
                {acc !== null ? `${acc}%` : "—"}
              </span>
            </div>
          );
        })}
        <p className="text-[10px] text-forge-text-muted font-semibold pt-1">
          Weekly SM-2 drill accuracy from the progress table (last 8 weeks).
        </p>
      </div>
    </div>
  );
};

// ── Blunder Trend panel ──────────────────────────────────────────────────────
const BlunderTrendPanel: React.FC = () => {
  const [data, setData] = useState<api.VelocityWeek[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .fetchVelocity()
      .then((d) => setData(d.weeks))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-6 flex items-center justify-center gap-2">
        <Loader2 size={16} className="text-rose-400 animate-spin" />
        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
          Loading trend...
        </span>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-6 text-center">
        <p className="text-xs text-slate-500 font-semibold">
          No blunder data yet. Play and analyze some games first.
        </p>
      </div>
    );
  }

  const maxBlunders = Math.max(...data.map((w) => w.blunders), 1);

  return (
    <div className="bg-[#0d1117] border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/5 bg-[#080a0f] flex items-center gap-2">
        <Activity size={14} className="text-rose-400" />
        <span className="text-[10px] font-black uppercase tracking-widest text-rose-400">
          Blunder Trend
        </span>
      </div>
      <div className="p-5 space-y-2">
        {data.map((week) => (
          <div key={week.label} className="flex items-center gap-3">
            <span className="text-[10px] text-slate-500 font-bold w-16 shrink-0 text-right tabular-nums">
              {week.label}
            </span>
            <div className="flex-1 h-5 bg-white/[0.03] rounded-md overflow-hidden">
              <div
                className="h-full bg-rose-500/40 rounded-md transition-all duration-500"
                style={{ width: `${(week.blunders / maxBlunders) * 100}%` }}
              />
            </div>
            <span className="text-[11px] font-black text-slate-300 w-6 text-right tabular-nums">
              {week.blunders}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Time-of-day accuracy panel ────────────────────────────────────────────────

const TOD_META: Record<
  api.TimeOfDayBucket["bucket"],
  { icon: React.ReactNode; color: string; bg: string; bar: string }
> = {
  morning:   { icon: <Sunrise size={14} />,  color: "text-amber-400",   bg: "bg-amber-500/10",   bar: "bg-amber-500" },
  afternoon: { icon: <Sun size={14} />,       color: "text-yellow-400",  bg: "bg-yellow-500/10",  bar: "bg-yellow-500" },
  evening:   { icon: <Sunset size={14} />,    color: "text-orange-400",  bg: "bg-orange-500/10",  bar: "bg-orange-500" },
  night:     { icon: <Moon size={14} />,      color: "text-indigo-400",  bg: "bg-indigo-500/10",  bar: "bg-indigo-500" },
};

const TimeOfDayPanel: React.FC<{ data: api.TimeOfDayBucket[] }> = ({ data }) => {
  const maxAcc = Math.max(...data.map((b) => b.accuracy), 1);

  return (
    <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-forge-border-subtle bg-forge-surface flex items-center gap-2">
        <Clock size={14} className="text-forge-insight" />
        <span className="text-[10px] font-black uppercase tracking-widest text-forge-insight">
          Best Time to Train
        </span>
      </div>
      <div className="p-5 space-y-4">
        {data.map((bucket) => {
          const meta = TOD_META[bucket.bucket];
          const barWidth = maxAcc > 0 ? (bucket.accuracy / maxAcc) * 100 : 0;
          const isBest = bucket.accuracy === maxAcc && bucket.sessions > 0;
          return (
            <div key={bucket.bucket}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className={cn("p-1 rounded-lg", meta.bg, meta.color)}>
                    {meta.icon}
                  </div>
                  <div>
                    <span className={cn("text-xs font-black uppercase tracking-wide", meta.color)}>
                      {bucket.label}
                    </span>
                    <span className="text-[9px] text-forge-text-muted font-bold ml-1.5">
                      {bucket.hourRange}
                    </span>
                  </div>
                  {isBest && (
                    <span className="text-[8px] font-black uppercase tracking-widest text-forge-success bg-forge-success-muted px-1.5 py-0.5 rounded-full">
                      Best
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className={cn("text-sm font-black", bucket.sessions > 0 ? meta.color : "text-forge-text-muted")}>
                    {bucket.sessions > 0 ? `${bucket.accuracy}%` : "—"}
                  </span>
                  {bucket.sessions > 0 && (
                    <span className="text-[9px] text-forge-text-muted font-bold block">
                      {bucket.sessions} pos
                    </span>
                  )}
                </div>
              </div>
              <div className="h-2 w-full bg-forge-border-subtle rounded-full overflow-hidden">
                {bucket.sessions > 0 && (
                  <div
                    className={cn("h-full rounded-full transition-all duration-700", meta.bar)}
                    style={{ width: `${barWidth}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
        <p className="text-[10px] text-forge-text-muted font-semibold pt-1">
          Based on SM-2 review attempts from the progress table.
        </p>
      </div>
    </div>
  );
};

// ── Opening accuracy by repertoire panel ──────────────────────────────────────

const REP_COLORS: Record<number, { color: string; bg: string; bar: string; border: string }> = {
  2: { color: "text-sky-400",    bg: "bg-sky-500/10",    bar: "bg-sky-500",    border: "border-sky-500/20" },
  3: { color: "text-violet-400", bg: "bg-violet-500/10", bar: "bg-violet-500", border: "border-violet-500/20" },
};
const REP_DEFAULT = { color: "text-slate-400", bg: "bg-slate-500/10", bar: "bg-slate-500", border: "border-slate-500/20" };

const RepertoireAccuracyPanel: React.FC<{ data: api.RepertoireAccuracyStat[] }> = ({ data }) => {
  const filtered = data.filter((r) => r.positions > 0);

  if (filtered.length === 0) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 text-center">
        <p className="text-xs text-forge-text-muted font-semibold">No drill data yet.</p>
      </div>
    );
  }

  const maxAcc = Math.max(...filtered.map((r) => r.accuracy), 1);

  return (
    <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-forge-border-subtle bg-forge-surface flex items-center gap-2">
        <Shield size={14} className="text-forge-success" />
        <span className="text-[10px] font-black uppercase tracking-widest text-forge-success">
          Opening Accuracy
        </span>
      </div>
      <div className="p-5 space-y-5">
        {filtered.map((rep) => {
          const colors = REP_COLORS[rep.id] ?? REP_DEFAULT;
          const barWidth = maxAcc > 0 ? (rep.accuracy / maxAcc) * 100 : 0;
          return (
            <div key={rep.id}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", colors.bar)} />
                  <span className={cn("text-xs font-black uppercase tracking-wide", colors.color)}>
                    {rep.name}
                  </span>
                </div>
                <div className="text-right">
                  <span className={cn("text-sm font-black", colors.color)}>
                    {rep.attempts > 0 ? `${rep.accuracy}%` : "—"}
                  </span>
                </div>
              </div>
              <div className="h-3 w-full bg-forge-border-subtle rounded-full overflow-hidden">
                {rep.attempts > 0 && (
                  <div
                    className={cn("h-full rounded-full transition-all duration-700", colors.bar)}
                    style={{ width: `${barWidth}%` }}
                  />
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-forge-text-muted font-bold">
                <span>{rep.positions} positions drilled</span>
                <span>·</span>
                <span>{rep.attempts} total attempts</span>
              </div>
            </div>
          );
        })}

        {/* Side-by-side summary if 2 repertoires */}
        {filtered.length === 2 && (
          <div className={cn(
            "mt-2 border rounded-forge-lg p-3 flex items-center gap-3",
            filtered[0].accuracy >= filtered[1].accuracy
              ? (REP_COLORS[filtered[0].id] ?? REP_DEFAULT).border
              : (REP_COLORS[filtered[1].id] ?? REP_DEFAULT).border,
          )}>
            <TrendingUp size={14} className="text-forge-success shrink-0" />
            <p className="text-[10px] text-forge-text-secondary font-semibold leading-relaxed">
              {filtered[0].accuracy >= filtered[1].accuracy
                ? `${filtered[0].name} leads by ${filtered[0].accuracy - filtered[1].accuracy}%.`
                : `${filtered[1].name} leads by ${filtered[1].accuracy - filtered[0].accuracy}%.`}
              {" "}Focus more on the weaker repertoire to close the gap.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Insights dashboard loader ─────────────────────────────────────────────────

const InsightsDashboardPanels: React.FC = () => {
  const [data, setData] = useState<api.InsightsDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .fetchInsightsDashboard()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <>
        <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 flex items-center justify-center gap-2">
          <Loader2 size={16} className="text-forge-insight animate-spin" />
          <span className="text-[10px] text-forge-text-muted font-bold uppercase tracking-widest">Loading…</span>
        </div>
        <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 flex items-center justify-center gap-2">
          <Loader2 size={16} className="text-forge-success animate-spin" />
          <span className="text-[10px] text-forge-text-muted font-bold uppercase tracking-widest">Loading…</span>
        </div>
      </>
    );
  }

  if (!data) return null;

  return (
    <>
      <TimeOfDayPanel data={data.timeOfDay} />
      <RepertoireAccuracyPanel data={data.repertoireAccuracy} />
    </>
  );
};

// ── Main InsightsTab ────────────────────────────────────────────────────────────
export const InsightsTab: React.FC<InsightsTabProps> = () => {
  const { chapters, getChapterMastery, weakPositions } = useRepertoireStore();
  const repertoireId = useRepertoireStore((s) => s.repertoireId);

  const [stats, setStats] = useState<api.ProgressStats | null>(null);
  const [patternReport, setPatternReport] =
    useState<api.PatternAnalysis | null>(null);

  useEffect(() => {
    if (!repertoireId) return;
    api
      .getProgressStats(repertoireId)
      .then(setStats)
      .catch(() => {});

    api
      .getPatternReport()
      .then((r) => setPatternReport(r))
      .catch(() => {});
  }, [repertoireId]);

  const weakCount = Object.keys(weakPositions).length;
  const totalMastery = chapters.length
    ? Math.round(
        chapters.reduce((s, _, i) => s + getChapterMastery(i), 0) /
          chapters.length,
      )
    : 0;

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#050507] custom-scrollbar">
      <div className="max-w-4xl mx-auto p-6 space-y-6 pb-24 md:pb-6">
        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-2xl font-black text-white uppercase tracking-tight">
              Insights
            </h1>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">
              Performance analytics
            </p>
          </div>
          <div className="w-10 h-10 bg-violet-600/20 rounded-xl flex items-center justify-center">
            <Sparkles size={18} className="text-violet-400" />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Weekly Accuracy"
            value={
              stats ? `${Math.round((stats.weeklyAccuracy || 0) * 100)}%` : "—"
            }
            icon={<TrendingUp size={16} />}
            color="text-emerald-400"
            bg="bg-emerald-500/10"
          />
          <StatCard
            label="Positions Mastered"
            value={stats?.mastered ?? "—"}
            icon={<CheckCircle2 size={16} />}
            color="text-emerald-400"
            bg="bg-emerald-500/10"
          />
          <StatCard
            label="Due Today"
            value={stats?.dueToday ?? "—"}
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
            value={patternReport?.stats.blundersUnderPressure ?? "—"}
            icon={<Clock size={16} />}
            color="text-orange-400"
            bg="bg-orange-500/10"
            hint="Mistakes under pressure"
            className="col-span-2"
          />
        </div>

        {/* Repertoire coverage */}
        <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={14} className="text-indigo-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
                Repertoire Coverage
              </span>
            </div>
            <span className="text-[10px] text-slate-600 font-bold">
              {totalMastery}% avg mastery
            </span>
          </div>
          <div className="space-y-3">
            {chapters.map((chapter, i) => {
              const mastery = getChapterMastery(i);
              return (
                <div key={i}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-slate-400 truncate pr-4">
                      {chapter.name}
                    </span>
                    <span className="text-[10px] font-black text-slate-500 shrink-0">
                      {mastery}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-700",
                        mastery > 80
                          ? "bg-emerald-500"
                          : mastery > 40
                            ? "bg-indigo-500"
                            : "bg-rose-500",
                      )}
                      style={{ width: `${mastery}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Game type breakdown */}
        <GameTypePanel />

        {patternReport?.openings && patternReport.openings.length > 0 && (
          <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BookOpen size={14} className="text-emerald-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
                  Opening Breakdown
                </span>
              </div>
              <span className="text-[10px] text-slate-600 font-bold">
                last {patternReport.stats.gamesAnalyzed} games
              </span>
            </div>
            <div className="space-y-2.5">
              {patternReport.openings.map((op) => (
                <div key={op.name}>
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-slate-400 truncate pr-4">
                      {op.name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0 text-[10px] font-bold">
                      <span className="text-emerald-400">{op.winPct}%W</span>
                      <span className="text-slate-500">{op.drawPct}%D</span>
                      <span className="text-rose-400">{op.lossPct}%L</span>
                      <span className="text-slate-600">({op.games}g)</span>
                    </div>
                  </div>
                  <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-emerald-600"
                      style={{ width: `${op.winPct}%` }}
                    />
                    <div
                      className="h-full bg-slate-600"
                      style={{ width: `${op.drawPct}%` }}
                    />
                    <div
                      className="h-full bg-rose-600"
                      style={{ width: `${op.lossPct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {patternReport?.stats.shapes &&
          Object.keys(patternReport.stats.shapes).length > 0 && (
            <div className="bg-[#0d1117] border border-white/5 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Activity size={14} className="text-amber-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
                  Game Shape Distribution
                </span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {(
                  [
                    "Smooth",
                    "Balanced",
                    "Sharp",
                    "Wild",
                    "Sudden",
                    "Giveaway",
                    "Intense",
                  ] as const
                ).map((shape) => {
                  const count = patternReport.stats.shapes[shape] ?? 0;
                  const COLORS: Record<string, string> = {
                    Smooth:
                      "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
                    Balanced:
                      "text-slate-400 bg-slate-500/10 border-slate-500/20",
                    Sharp: "text-amber-400 bg-amber-500/10 border-amber-500/20",
                    Wild: "text-rose-400 bg-rose-500/10 border-rose-500/20",
                    Sudden:
                      "text-orange-400 bg-orange-500/10 border-orange-500/20",
                    Giveaway: "text-red-400 bg-red-500/10 border-red-500/20",
                    Intense:
                      "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
                  };
                  const ABBR: Record<string, string> = {
                    Smooth: "Smooth",
                    Balanced: "Balanc",
                    Sharp: "Sharp",
                    Wild: "Wild",
                    Sudden: "Sudden",
                    Giveaway: "Give.",
                    Intense: "Intnse",
                  };
                  return (
                    <div
                      key={shape}
                      className={cn(
                        "border rounded-xl py-2 px-1 text-center",
                        count > 0
                          ? COLORS[shape]
                          : "text-slate-700 bg-white/[0.02] border-white/5",
                      )}
                      title={shape}
                    >
                      <p className="text-lg font-black">{count}</p>
                      <p className="text-[8px] uppercase tracking-wide font-bold opacity-70 px-0.5">
                        {ABBR[shape] ?? shape}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        {/* Weekly accuracy trend */}
        <WeeklyAccuracyPanel />

        {/* Blunder Trend */}
        <BlunderTrendPanel />

        {/* Time-of-day + Repertoire accuracy */}
        <InsightsDashboardPanels />

        {/* Pattern Recognition */}
        <PatternPanel
          cached={patternReport}
          onRerun={(result) => setPatternReport(result)}
        />
      </div>
    </div>
  );
};
