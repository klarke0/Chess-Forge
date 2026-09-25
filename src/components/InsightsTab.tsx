import React, { useState, useEffect, useCallback, useId, useMemo } from "react";
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
  GitBranch,
  ChevronRight,
  ChevronDown,
  Users,
} from "lucide-react";
import { cn } from "../utils/cn";
import { useRepertoireStore } from "../stores/repertoireStore";
import * as api from "../services/api";
import type { GameTypeStat } from "../services/api";
import { normalizeFen } from "../utils/normalizeFen";

interface InsightsTabProps {
  // Unused
}

// ── Stat card (compact tile) ──────────────────────────────────────────────────
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
    title={hint}
    className={cn(
      "bg-forge-card border border-forge-border-subtle rounded-2xl px-3 py-2.5 min-h-[76px] flex flex-col justify-between overflow-hidden",
      onClick && "cursor-pointer hover:border-forge-border-default transition-colors duration-150",
      onClick && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
      className,
    )}
    tabIndex={onClick ? 0 : undefined}
    role={onClick ? "button" : undefined}
    onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
  >
    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 truncate">
      {label}
    </p>
    <div className="flex items-center gap-2">
      <div className={cn("p-1.5 rounded-lg shrink-0", bg, color)}>{icon}</div>
      <span className="text-xl font-black text-white tabular-nums truncate">{value}</span>
    </div>
  </div>
);

// ── Accordion ─────────────────────────────────────────────────────────────────
// Default-closed disclosure: a 44px header row (title + one-line summary +
// chevron) that expands its body inline. Children stay mounted while closed
// (hidden via visibility + 0-height grid row) so panels that fetch their own
// data can still report a summary for the header.
const Accordion: React.FC<{
  title: string;
  summary?: string;
  icon: React.ReactNode;
  accent: string;
  children: React.ReactNode;
}> = ({ title, summary, icon, accent, children }) => {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const headerId = `${uid}-header`;
  const bodyId = `${uid}-body`;
  return (
    <div>
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-[44px] px-4 flex items-center gap-3 bg-forge-card border border-forge-border-subtle rounded-2xl text-left cursor-pointer hover:border-forge-border-default motion-safe:transition-colors motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <span className={cn("shrink-0", accent)} aria-hidden="true">
          {icon}
        </span>
        <span className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className={cn("text-[10px] font-black uppercase tracking-widest shrink-0", accent)}>
            {title}
          </span>
          {summary && (
            <span className="text-xs text-slate-500 font-semibold truncate">{summary}</span>
          )}
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-slate-500 motion-safe:transition-transform motion-safe:duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      <div
        id={bodyId}
        role="region"
        aria-labelledby={headerId}
        className={cn(
          "grid motion-safe:transition-[grid-template-rows,margin-top,visibility] motion-safe:duration-300",
          open ? "grid-rows-[1fr] mt-2 visible" : "grid-rows-[0fr] mt-0 invisible",
        )}
      >
        <div className="min-h-0 overflow-hidden space-y-3">{children}</div>
      </div>
    </div>
  );
};

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
      <div className="bg-forge-card border border-forge-border-subtle rounded-2xl p-6 flex flex-col items-center gap-4 text-center">
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
          className="flex items-center gap-2 px-5 py-2.5 min-h-[44px] bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-bold text-xs uppercase tracking-widest cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        >
          <Sparkles size={14} /> Run Analysis
        </button>
      </div>
    );
  }

  if (running) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-2xl p-8 flex flex-col items-center gap-3">
        <Loader2 size={28} className="text-violet-400 motion-safe:animate-spin" />
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest motion-safe:animate-pulse">
          Analysing patterns…
        </p>
      </div>
    );
  }

  if (!cached) return null;

  const timeAgo = cached.createdAt ? formatTimeAgo(cached.createdAt) : null;

  return (
    <div className="bg-forge-card border border-forge-border-subtle rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-forge-border-subtle bg-forge-surface flex items-center justify-between">
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
            className="p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 cursor-pointer transition-colors duration-150 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            title="Re-run"
          >
            <RefreshCw size={12} className={running ? "motion-safe:animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {cached.stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-forge-elevated border border-forge-border-subtle rounded-xl p-3 space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
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
                  className="bg-forge-elevated border border-forge-border-subtle rounded-lg px-3 flex items-center justify-between"
                >
                  <p className="text-[10px] text-slate-600 uppercase tracking-wide font-bold">
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
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-1">
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

const GameTypePanel: React.FC<{ onSummary?: (s: string) => void }> = ({ onSummary }) => {
  const [data, setData] = useState<GameTypeStat[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .fetchGameTypeStats()
      .then((d) => setData(d.byType))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !onSummary) return;
    const rows = data ?? [];
    const total = rows.reduce((sum, r) => sum + r.games, 0);
    if (total === 0) return onSummary("No game data yet");
    const top = rows.reduce((a, b) => (b.games > a.games ? b : a));
    onSummary(`${total.toLocaleString()} games · mostly ${TIME_CLASS_LABELS[top.timeClass] ?? top.timeClass}`);
  }, [data, loading, onSummary]);

  if (loading) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-2xl p-6 space-y-3">
        <div className="h-3 w-24 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
        <div className="h-5 bg-forge-elevated rounded-md motion-safe:animate-pulse" />
        <div className="h-5 bg-forge-elevated rounded-md motion-safe:animate-pulse" />
        <div className="h-5 bg-forge-elevated rounded-md motion-safe:animate-pulse" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-2xl p-6 text-center">
        <p className="text-xs text-slate-500 font-semibold">No game data yet.</p>
      </div>
    );
  }

  const totalGames = data.reduce((s, r) => s + r.games, 0);

  return (
    <div className="bg-forge-card border border-forge-border-subtle rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-forge-border-subtle bg-forge-surface flex items-center justify-between">
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
              <div className="h-2 w-full bg-forge-border-subtle rounded-full overflow-hidden flex">
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
                <span className="text-[10px] text-emerald-500 font-bold">{row.wins}W</span>
                <span className="text-[10px] text-slate-600">·</span>
                <span className="text-[10px] text-slate-500">{row.draws}D</span>
                <span className="text-[10px] text-slate-600">·</span>
                <span className="text-[10px] text-rose-500 font-bold">{row.losses}L</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Weekly drill accuracy trend panel ────────────────────────────────────────

const WeeklyAccuracyPanel: React.FC<{ onSummary?: (s: string) => void }> = ({ onSummary }) => {
  const [data, setData] = useState<api.WeeklyAccuracyWeek[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .fetchWeeklyAccuracy()
      .then((d) => setData(d.weeks))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !onSummary) return;
    const withData = (data ?? []).filter((w) => w.accuracy !== null);
    if (withData.length === 0) return onSummary("No drill data yet");
    const avg = Math.round(withData.reduce((sum, w) => sum + (w.accuracy ?? 0), 0) / withData.length);
    onSummary(`avg accuracy ${avg}%`);
  }, [data, loading, onSummary]);

  if (loading) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 space-y-3">
        <div className="h-3 w-28 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-14 bg-forge-elevated rounded-full motion-safe:animate-pulse shrink-0" />
            <div className="flex-1 h-5 bg-forge-elevated rounded-md motion-safe:animate-pulse" />
            <div className="h-3 w-8 bg-forge-elevated rounded-full motion-safe:animate-pulse shrink-0" />
          </div>
        ))}
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
        <p className="text-[10px] text-forge-text-muted italic pt-0.5">
          Accuracy reflects all-time performance per position, not individual session results.
        </p>
      </div>
    </div>
  );
};

// ── Blunder Trend panel ──────────────────────────────────────────────────────
const BlunderTrendPanel: React.FC<{ onSummary?: (s: string) => void }> = ({ onSummary }) => {
  const [data, setData] = useState<api.VelocityWeek[] | null>(null);
  const [loading, setLoading] = useState(true);

  const repertoireId = useRepertoireStore((s) => s.repertoireId);

  useEffect(() => {
    api
      .fetchVelocity(repertoireId ?? undefined)
      .then((d) => setData(d.weeks))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [repertoireId]);

  useEffect(() => {
    if (loading || !onSummary) return;
    const weeks = data ?? [];
    if (weeks.length === 0) return onSummary("No blunder data yet");
    const total = weeks.reduce((sum, w) => sum + w.blunders, 0);
    onSummary(`${total} blunders / ${weeks.length}w`);
  }, [data, loading, onSummary]);

  if (loading) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-2xl p-6 space-y-3">
        <div className="h-3 w-24 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
        <div className="h-5 bg-forge-elevated rounded-md motion-safe:animate-pulse" />
        <div className="h-5 bg-forge-elevated rounded-md motion-safe:animate-pulse" />
        <div className="h-5 bg-forge-elevated rounded-md motion-safe:animate-pulse" />
        <div className="h-5 w-3/4 bg-forge-elevated rounded-md motion-safe:animate-pulse" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-2xl p-6 text-center">
        <p className="text-xs text-slate-500 font-semibold">
          No blunder data yet. Play and analyze some games first.
        </p>
      </div>
    );
  }

  const maxBlunders = Math.max(...data.map((w) => w.blunders), 1);

  return (
    <div className="bg-forge-card border border-forge-border-subtle rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-forge-border-subtle bg-forge-surface flex items-center gap-2">
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
            <div className="flex-1 h-5 bg-forge-border-subtle rounded-md overflow-hidden">
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
                    <span className="text-[10px] text-forge-text-muted font-bold ml-1.5">
                      {bucket.hourRange}
                    </span>
                  </div>
                  {isBest && (
                    <span className="text-[10px] font-black uppercase tracking-widest text-forge-success bg-[var(--forge-accent-success-muted)] px-1.5 py-0.5 rounded-full">
                      Best
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className={cn("text-sm font-black", bucket.sessions > 0 ? meta.color : "text-forge-text-muted")}>
                    {bucket.sessions > 0 ? `${bucket.accuracy}%` : "—"}
                  </span>
                  {bucket.sessions > 0 && (
                    <span className="text-[10px] text-forge-text-muted font-bold block">
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

// ── Opening Tree Visualization ────────────────────────────────────────────────

type MasteryLevel = "green" | "amber" | "red" | "gray";

function getMastery(
  fen: string,
  progressMap: Record<string, api.ProgressEntry>,
): MasteryLevel {
  const row = progressMap[normalizeFen(fen)];
  if (!row || row.total_attempts === 0) return "gray";
  const acc = row.correct_attempts / row.total_attempts;
  if (acc >= 0.8) return "green";
  if (acc >= 0.5) return "amber";
  return "red";
}

const MASTERY_DOT: Record<MasteryLevel, string> = {
  green: "bg-forge-success",
  amber: "bg-amber-400",
  red: "bg-forge-danger",
  gray: "bg-slate-600",
};

const MASTERY_TEXT: Record<MasteryLevel, string> = {
  green: "text-forge-success",
  amber: "text-amber-400",
  red: "text-forge-danger",
  gray: "text-slate-500",
};

interface TreeMoveNode {
  san: string;
  fen: string; // nextFen (the FEN *after* the move)
  mastery: MasteryLevel;
  children: TreeMoveNode[];
  /** accuracy 0-100, or null if never drilled */
  accuracy: number | null;
}

function buildMoveTree(
  parentFen: string,
  positions: api.PositionTree,
  progressMap: Record<string, api.ProgressEntry>,
  depth: number,
  maxDepth: number,
  visited: Set<string>,
): TreeMoveNode[] {
  if (depth >= maxDepth) return [];
  const moves = positions[normalizeFen(parentFen)] ?? [];
  return moves.slice(0, 6).map((m) => {
    const nextFen = normalizeFen(m.nextFen);
    const mastery = getMastery(nextFen, progressMap);
    const row = progressMap[nextFen];
    const accuracy =
      row && row.total_attempts > 0
        ? Math.round((row.correct_attempts / row.total_attempts) * 100)
        : null;
    // Guard against cycles
    const childrenFen = nextFen;
    const children =
      !visited.has(childrenFen) && depth < maxDepth - 1
        ? buildMoveTree(
            m.nextFen,
            positions,
            progressMap,
            depth + 1,
            maxDepth,
            new Set([...visited, childrenFen]),
          )
        : [];
    return { san: m.san, fen: nextFen, mastery, children, accuracy };
  });
}

const TreeNode: React.FC<{
  node: TreeMoveNode;
  depth: number;
}> = ({ node, depth }) => {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const indent = Math.min(depth * 10, 60);
  const moveNumber = Math.floor(depth / 2) + 1;
  const isBlack = depth % 2 === 1;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 rounded-lg cursor-pointer hover:bg-forge-surface transition-colors select-none"
        style={{ paddingLeft: `${8 + indent}px`, paddingRight: "8px" }}
        onClick={() => hasChildren && setOpen((v) => !v)}
      >
        {/* Expand chevron */}
        <span className="w-3 shrink-0 text-slate-600">
          {hasChildren ? (
            open ? (
              <ChevronDown size={10} />
            ) : (
              <ChevronRight size={10} />
            )
          ) : null}
        </span>

        {/* Mastery dot */}
        <span
          className={cn("w-2 h-2 rounded-full shrink-0", MASTERY_DOT[node.mastery])}
        />

        {/* Move number + SAN */}
        <span className="text-[10px] text-slate-500 font-mono shrink-0 w-7">
          {isBlack ? `${moveNumber}…` : `${moveNumber}.`}
        </span>
        <span
          className={cn(
            "text-xs font-bold",
            MASTERY_TEXT[node.mastery],
          )}
        >
          {node.san}
        </span>

        {/* Accuracy chip */}
        {node.accuracy !== null && (
          <span
            className={cn(
              "ml-auto text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-full",
              node.mastery === "green"
                ? "bg-forge-success/10 text-forge-success"
                : node.mastery === "amber"
                  ? "bg-amber-500/10 text-amber-400"
                  : "bg-forge-danger/10 text-forge-danger",
            )}
          >
            {node.accuracy}%
          </span>
        )}
      </div>

      {open && hasChildren && (
        <div className="border-l border-forge-border-subtle ml-5">
          {node.children.map((child, i) => (
            <TreeNode
              key={i}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface RepertoireTreeData {
  id: number;
  name: string;
  side: "white" | "black";
  /** Raw position map — kept so the card can rebuild tree at different depths */
  positions: api.PositionTree;
  progressMap: Record<string, api.ProgressEntry>;
  tree: TreeMoveNode[];
  totalPositions: number;
  drilledPositions: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
}

function countMastery(nodes: TreeMoveNode[]): {
  drilled: number;
  green: number;
  amber: number;
  red: number;
} {
  let drilled = 0, green = 0, amber = 0, red = 0;
  for (const n of nodes) {
    if (n.mastery !== "gray") drilled++;
    if (n.mastery === "green") green++;
    else if (n.mastery === "amber") amber++;
    else if (n.mastery === "red") red++;
    const sub = countMastery(n.children);
    drilled += sub.drilled;
    green += sub.green;
    amber += sub.amber;
    red += sub.red;
  }
  return { drilled, green, amber, red };
}

function countTotal(nodes: TreeMoveNode[]): number {
  return nodes.reduce((s, n) => s + 1 + countTotal(n.children), 0);
}

const STARTING_FEN_CONST =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MAX_TREE_DEPTH = 20;

const RepertoireTreeCard: React.FC<{ data: RepertoireTreeData }> = ({
  data,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [maxDepth, setMaxDepth] = useState(8);

  // Rebuild tree whenever maxDepth changes (user clicked "Show more depth")
  const currentTree = useMemo(() => {
    if (maxDepth === 8) return data.tree; // use pre-built tree for initial depth
    return buildMoveTree(
      STARTING_FEN_CONST,
      data.positions,
      data.progressMap,
      0,
      maxDepth,
      new Set([normalizeFen(STARTING_FEN_CONST)]),
    );
  }, [maxDepth, data]);

  // Check whether there are positions beyond the current depth cap
  const hasMoreDepth = useMemo(() => {
    if (maxDepth >= MAX_TREE_DEPTH) return false;
    // Probe one level deeper — if that returns nodes, there's more to show
    function hasNodesAtDepth(nodes: TreeMoveNode[], remaining: number): boolean {
      if (remaining === 0) return nodes.length > 0;
      return nodes.some((n) => hasNodesAtDepth(n.children, remaining - 1));
    }
    return hasNodesAtDepth(currentTree, 0) && maxDepth < MAX_TREE_DEPTH;
  }, [currentTree, maxDepth]);

  const drilledPct =
    data.totalPositions > 0
      ? Math.round((data.drilledPositions / data.totalPositions) * 100)
      : 0;

  const REP_COLOR =
    data.id === 2
      ? { accent: "text-sky-400", bar: "bg-sky-500", bg: "bg-sky-500/10" }
      : { accent: "text-violet-400", bar: "bg-violet-500", bg: "bg-violet-500/10" };

  return (
    <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full px-5 py-4 flex items-center gap-3 cursor-pointer hover:bg-forge-surface transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className={cn("p-2 rounded-xl", REP_COLOR.bg)}>
          <GitBranch size={14} className={REP_COLOR.accent} />
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-black uppercase tracking-wide", REP_COLOR.accent)}>
              {data.name}
            </span>
            <span className="text-[10px] text-forge-text-muted font-bold uppercase">
              {data.side}
            </span>
          </div>
          {/* Mastery summary bar */}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1.5 bg-forge-border-subtle rounded-full overflow-hidden flex">
              <div
                className="h-full bg-forge-success transition-all duration-700"
                style={{
                  width: `${data.totalPositions > 0 ? (data.greenCount / data.totalPositions) * 100 : 0}%`,
                }}
              />
              <div
                className="h-full bg-amber-400 transition-all duration-700"
                style={{
                  width: `${data.totalPositions > 0 ? (data.amberCount / data.totalPositions) * 100 : 0}%`,
                }}
              />
              <div
                className="h-full bg-forge-danger transition-all duration-700"
                style={{
                  width: `${data.totalPositions > 0 ? (data.redCount / data.totalPositions) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="text-[10px] text-forge-text-muted font-bold shrink-0">
              {drilledPct}% drilled
            </span>
          </div>
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "text-slate-500 shrink-0 transition-transform duration-200",
            expanded ? "rotate-180" : "",
          )}
        />
      </button>

      {/* Legend */}
      {expanded && (
        <div className="px-5 py-2 border-t border-forge-border-subtle bg-forge-surface flex items-center gap-4 flex-wrap">
          {[
            { dot: "bg-forge-success", label: `${data.greenCount} mastered (≥80%)` },
            { dot: "bg-amber-400", label: `${data.amberCount} learning (50–79%)` },
            { dot: "bg-forge-danger", label: `${data.redCount} weak (<50%)` },
            { dot: "bg-slate-600", label: "undrilled" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div className={cn("w-2 h-2 rounded-full shrink-0", item.dot)} />
              <span className="text-[10px] text-forge-text-muted font-bold">{item.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tree */}
      {expanded && (
        <div className="px-3 py-3 border-t border-forge-border-subtle max-h-[50dvh] overflow-y-auto">
          {currentTree.length === 0 ? (
            <p className="text-xs text-forge-text-muted text-center py-4 font-semibold">
              No positions loaded yet.
            </p>
          ) : (
            <>
              {currentTree.map((node, i) => (
                <TreeNode
                  key={i}
                  node={node}
                  depth={0}
                />
              ))}
              {hasMoreDepth && (
                <button
                  onClick={() => setMaxDepth((d) => Math.min(d + 4, MAX_TREE_DEPTH))}
                  className="w-full mt-2 py-2 min-h-[36px] text-[10px] font-black uppercase tracking-widest text-forge-text-muted hover:text-forge-text-secondary border border-forge-border-subtle hover:border-forge-border-default rounded-xl cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  Show more depth (move {maxDepth / 2 + 1}+)
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const OpeningTreePanel: React.FC<{ onSummary?: (s: string) => void }> = ({ onSummary }) => {
  const availableRepertoires = useRepertoireStore((s) => s.availableRepertoires);
  const [trees, setTrees] = useState<RepertoireTreeData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTrees = useCallback(async () => {
    if (availableRepertoires.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        availableRepertoires.map(async (rep) => {
          const [positions, progress] = await Promise.all([
            api.getPositions(rep.id),
            api.getProgress(rep.id),
          ]);
          // Build progress lookup keyed by normalized FEN
          const progressMap: Record<string, api.ProgressEntry> = {};
          for (const row of progress) {
            progressMap[normalizeFen(row.fen)] = row;
          }
          const tree = buildMoveTree(
            STARTING_FEN_CONST,
            positions,
            progressMap,
            0,
            8,
            new Set([normalizeFen(STARTING_FEN_CONST)]),
          );
          const { drilled, green, amber, red } = countMastery(tree);
          const total = countTotal(tree);
          return {
            id: rep.id,
            name: rep.name,
            side: rep.side,
            positions,
            progressMap,
            tree,
            totalPositions: total,
            drilledPositions: drilled,
            greenCount: green,
            amberCount: amber,
            redCount: red,
          } satisfies RepertoireTreeData;
        }),
      );
      setTrees(results);
    } catch {
      setTrees([]);
    } finally {
      setLoading(false);
    }
  }, [availableRepertoires]);

  useEffect(() => {
    loadTrees();
  }, [loadTrees]);

  useEffect(() => {
    if (loading || !onSummary) return;
    if (trees.length === 0) return onSummary("No repertoires found");
    const drilled = trees.reduce((sum, t) => sum + t.drilledPositions, 0);
    const total = trees.reduce((sum, t) => sum + t.totalPositions, 0);
    onSummary(`${trees.length} ${trees.length === 1 ? "repertoire" : "repertoires"} · ${drilled}/${total} positions drilled`);
  }, [trees, loading, onSummary]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-forge-insight" />
          <span className="text-[10px] font-black uppercase tracking-widest text-forge-insight">
            Opening Tree
          </span>
        </div>
        <span className="text-[10px] text-forge-text-muted font-bold uppercase">
          Tap repertoire to expand
        </span>
      </div>

      {loading ? (
        <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-forge-elevated rounded-xl motion-safe:animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
              <div className="h-2 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-forge-elevated rounded-xl motion-safe:animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-28 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
              <div className="h-2 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
            </div>
          </div>
        </div>
      ) : trees.length === 0 ? (
        <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 text-center">
          <p className="text-xs text-forge-text-muted font-semibold">
            No repertoires found. Make sure the backend is running.
          </p>
        </div>
      ) : (
        trees.map((t) => <RepertoireTreeCard key={t.id} data={t} />)
      )}
    </div>
  );
};

// ── Opponent model panel ──────────────────────────────────────────────────────

const OpponentModelPanel: React.FC<{ onSummary?: (s: string) => void }> = ({ onSummary }) => {
  const [data, setData] = useState<api.TopOpponent[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .fetchTopOpponents()
      .then((d) => setData(d.opponents))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !onSummary) return;
    const opps = data ?? [];
    if (opps.length === 0) return onSummary("No deviation data yet");
    onSummary(`${opps.length} ${opps.length === 1 ? "opponent" : "opponents"} · top: ${opps[0].opponent}`);
  }, [data, loading, onSummary]);

  if (loading) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="h-3 w-28 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
              <div className="h-3 w-16 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
            </div>
            <div className="h-2 bg-forge-elevated rounded-full motion-safe:animate-pulse" style={{ width: `${70 - i * 15}%` }} />
          </div>
        ))}
      </div>
    );
  }

  const opponents = data ?? [];

  if (opponents.length === 0) {
    return (
      <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 text-center">
        <p className="text-xs text-forge-text-muted font-semibold">
          No deviation data yet — play some games and run backfill-deviations to populate.
        </p>
      </div>
    );
  }

  const maxDeviations = Math.max(...opponents.map((o) => o.deviationCount), 1);

  return (
    <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-forge-border-subtle bg-forge-surface flex items-center gap-2">
        <Users size={14} className="text-forge-insight" />
        <span className="text-[10px] font-black uppercase tracking-widest text-forge-insight">
          Most Challenging Opponents
        </span>
      </div>
      <div className="p-5 space-y-4">
        {opponents.map((opp, i) => {
          const barWidth = (opp.deviationCount / maxDeviations) * 100;
          const winPct = opp.games > 0 ? Math.round((opp.wins / opp.games) * 100) : 0;
          const drawPct = opp.games > 0 ? Math.round((opp.draws / opp.games) * 100) : 0;
          const lossPct = opp.games > 0 ? Math.round((opp.losses / opp.games) * 100) : 0;
          const rankColor = i === 0 ? "text-amber-400" : i === 1 ? "text-slate-400" : "text-orange-700";
          return (
            <div key={opp.opponent}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn("text-[10px] font-black w-4 shrink-0 tabular-nums", rankColor)}>
                    #{i + 1}
                  </span>
                  <span className="text-xs font-bold text-forge-text-primary truncate">
                    {opp.opponent}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[10px] font-bold">
                  <span className="text-forge-danger font-black tabular-nums">
                    {opp.deviationCount} dev{opp.deviationCount !== 1 ? "s" : ""}
                  </span>
                  <span className="text-forge-text-muted">·</span>
                  <span className="text-forge-text-muted">{opp.games}g</span>
                </div>
              </div>
              <div className="h-2 w-full bg-forge-border-subtle rounded-full overflow-hidden mb-1">
                <div
                  className="h-full bg-forge-danger/60 rounded-full transition-all duration-500"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              {opp.games > 0 && (
                <div className="flex items-center gap-1 text-[10px] font-bold">
                  <span className="text-forge-success">{winPct}%W</span>
                  <span className="text-forge-text-muted">·</span>
                  <span className="text-forge-text-secondary">{drawPct}%D</span>
                  <span className="text-forge-text-muted">·</span>
                  <span className="text-forge-danger">{lossPct}%L</span>
                </div>
              )}
            </div>
          );
        })}
        <p className="text-[10px] text-forge-text-muted font-semibold pt-1">
          Opponents you deviated from your repertoire against most often.
        </p>
      </div>
    </div>
  );
};

// ── Insights dashboard loader ─────────────────────────────────────────────────

const InsightsDashboardPanels: React.FC<{ onSummary?: (s: string) => void }> = ({ onSummary }) => {
  const [data, setData] = useState<api.InsightsDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .fetchInsightsDashboard()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !onSummary) return;
    if (!data) return onSummary("Unavailable");
    const best = data.timeOfDay
      .filter((b) => b.sessions > 0)
      .reduce<api.TimeOfDayBucket | null>((a, b) => (a === null || b.accuracy > a.accuracy ? b : a), null);
    const reps = data.repertoireAccuracy.filter((r) => r.positions > 0).length;
    const parts = [
      best ? `best time: ${best.label.toLowerCase()} (${best.accuracy}%)` : null,
      reps > 0 ? `${reps} ${reps === 1 ? "repertoire" : "repertoires"} drilled` : null,
    ].filter(Boolean);
    onSummary(parts.length > 0 ? parts.join(" · ") : "No drill data yet");
  }, [data, loading, onSummary]);

  if (loading) {
    return (
      <>
        {/* Time of day skeleton */}
        <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 space-y-4">
          <div className="h-3 w-32 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="h-3 w-20 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
                <div className="h-3 w-10 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
              </div>
              <div className="h-2 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
        {/* Repertoire accuracy skeleton */}
        <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-6 space-y-4">
          <div className="h-3 w-36 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
          {[...Array(2)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="h-3 w-28 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
                <div className="h-3 w-8 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
              </div>
              <div className="h-3 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
            </div>
          ))}
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
type SummaryKey = "timeControl" | "weekly" | "blunder" | "drill" | "tree" | "opponents";

export const InsightsTab: React.FC<InsightsTabProps> = () => {
  const { chapters, getChapterMastery, weakPositions } = useRepertoireStore();
  const repertoireId = useRepertoireStore((s) => s.repertoireId);

  const [stats, setStats] = useState<api.ProgressStats | null>(null);
  const [patternReport, setPatternReport] =
    useState<api.PatternAnalysis | null>(null);
  const [showAllCoverage, setShowAllCoverage] = useState(false);
  const [summaries, setSummaries] = useState<Partial<Record<SummaryKey, string>>>({});

  // Stable per-panel callbacks so panels can report a one-line summary for
  // their accordion header without re-triggering their effects each render.
  const report = useMemo(() => {
    const make = (key: SummaryKey) => (text: string) =>
      setSummaries((prev) => (prev[key] === text ? prev : { ...prev, [key]: text }));
    return {
      timeControl: make("timeControl"),
      weekly: make("weekly"),
      blunder: make("blunder"),
      drill: make("drill"),
      tree: make("tree"),
      opponents: make("opponents"),
    };
  }, []);

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

  const COVERAGE_PREVIEW = 5;
  const visibleChapters = showAllCoverage
    ? chapters
    : chapters.slice(0, COVERAGE_PREVIEW);

  const patternSummary = !patternReport
    ? "Not run yet"
    : patternReport.isError
      ? "Analysis unavailable"
      : [
          patternReport.patterns.length > 0
            ? `${patternReport.patterns.length} patterns`
            : null,
          patternReport.createdAt
            ? `last run ${formatTimeAgo(patternReport.createdAt)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Report ready";

  const gameBreakdownSummary = [
    summaries.timeControl ?? "Loading…",
    patternReport?.openings && patternReport.openings.length > 0
      ? `${patternReport.openings.length} openings`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const trendsSummary =
    [summaries.weekly, summaries.blunder].filter(Boolean).join(" · ") ||
    "Loading…";

  return (
    <div className="absolute inset-0 overflow-y-auto bg-forge-base custom-scrollbar">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-3 pb-24 md:pb-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-white uppercase tracking-tight leading-tight">
              Insights
            </h1>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">
              Performance analytics
            </p>
          </div>
          <div className="w-9 h-9 bg-violet-600/20 rounded-xl flex items-center justify-center" aria-hidden="true">
            <Sparkles size={16} className="text-violet-400" />
          </div>
        </div>

        {/* Stats grid — compact 3x2 tiles */}
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            label="Weekly Acc."
            hint="Weekly accuracy"
            value={
              stats ? `${Math.round((stats.weeklyAccuracy || 0) * 100)}%` : "—"
            }
            icon={<TrendingUp size={14} />}
            color="text-emerald-400"
            bg="bg-emerald-500/10"
          />
          <StatCard
            label="Mastered"
            hint="Positions mastered"
            value={stats?.mastered ?? "—"}
            icon={<CheckCircle2 size={14} />}
            color="text-emerald-400"
            bg="bg-emerald-500/10"
          />
          <StatCard
            label="Tracked Due"
            value={stats?.dueToday ?? "—"}
            icon={<CalendarClock size={14} />}
            color="text-amber-400"
            bg="bg-amber-500/10"
          />
          <StatCard
            label="Weak Points"
            value={weakCount}
            icon={<AlertTriangle size={14} />}
            color="text-rose-400"
            bg="bg-rose-500/10"
          />
          <StatCard
            label="Time Pressure"
            hint="Mistakes under pressure"
            value={patternReport?.stats.blundersUnderPressure ?? "—"}
            icon={<Clock size={14} />}
            color="text-orange-400"
            bg="bg-orange-500/10"
          />
          <StatCard
            label="Avg Mastery"
            hint="Average chapter mastery"
            value={chapters.length ? `${totalMastery}%` : "—"}
            icon={<BarChart3 size={14} />}
            color="text-indigo-400"
            bg="bg-indigo-500/10"
          />
        </div>

        {/* Everything else: default-closed accordions */}
        <div className="space-y-2">
          <Accordion
            title="Repertoire coverage"
            summary={`${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"} · ${totalMastery}% avg`}
            icon={<BarChart3 size={14} />}
            accent="text-indigo-400"
          >
            <div className="bg-forge-card border border-forge-border-subtle rounded-2xl p-5">
              <div className="space-y-3">
                {visibleChapters.map((chapter, i) => {
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
                      <div className="h-1.5 w-full bg-forge-border-subtle rounded-full overflow-hidden">
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
              {chapters.length > COVERAGE_PREVIEW && (
                <button
                  type="button"
                  aria-expanded={showAllCoverage}
                  onClick={() => setShowAllCoverage((v) => !v)}
                  className="w-full mt-3 min-h-[44px] text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 border border-forge-border-subtle hover:border-forge-border-default rounded-xl cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  {showAllCoverage ? "Show less" : `Show all (${chapters.length})`}
                </button>
              )}
            </div>
          </Accordion>

          <Accordion
            title="Game breakdown"
            summary={gameBreakdownSummary}
            icon={<Zap size={14} />}
            accent="text-emerald-400"
          >
            <GameTypePanel onSummary={report.timeControl} />

            {patternReport?.openings && patternReport.openings.length > 0 && (
              <div className="bg-forge-card border border-forge-border-subtle rounded-2xl p-5">
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
                      <div className="h-1 w-full bg-forge-border-subtle rounded-full overflow-hidden flex">
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
                <div className="bg-forge-card border border-forge-border-subtle rounded-2xl p-5">
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
                              : "text-slate-700 bg-forge-elevated border-forge-border-subtle",
                          )}
                          title={shape}
                        >
                          <p className="text-lg font-black">{count}</p>
                          <p className="text-[10px] uppercase tracking-wide font-bold opacity-70 px-0.5">
                            {ABBR[shape] ?? shape}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
          </Accordion>

          <Accordion
            title="Trends"
            summary={trendsSummary}
            icon={<TrendingUp size={14} />}
            accent="text-forge-insight"
          >
            <WeeklyAccuracyPanel onSummary={report.weekly} />
            <BlunderTrendPanel onSummary={report.blunder} />
          </Accordion>

          <Accordion
            title="Drill stats"
            summary={summaries.drill ?? "Loading…"}
            icon={<Shield size={14} />}
            accent="text-forge-success"
          >
            <InsightsDashboardPanels onSummary={report.drill} />
          </Accordion>

          <Accordion
            title="Opening tree"
            summary={summaries.tree ?? "Loading…"}
            icon={<GitBranch size={14} />}
            accent="text-forge-insight"
          >
            <OpeningTreePanel onSummary={report.tree} />
          </Accordion>

          <Accordion
            title="Opponents"
            summary={summaries.opponents ?? "Loading…"}
            icon={<Users size={14} />}
            accent="text-forge-insight"
          >
            <OpponentModelPanel onSummary={report.opponents} />
          </Accordion>

          <Accordion
            title="Pattern report"
            summary={patternSummary}
            icon={<Brain size={14} />}
            accent="text-violet-400"
          >
            <PatternPanel
              cached={patternReport}
              onRerun={(result) => setPatternReport(result)}
            />
          </Accordion>
        </div>
      </div>
    </div>
  );
};
