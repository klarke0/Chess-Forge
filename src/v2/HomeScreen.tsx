import React, { useEffect, useState } from "react";
import { Play, Film, BookOpen, Flame, RefreshCw, Loader2, Target, CheckCircle2, Circle, GraduationCap } from "lucide-react";
import { Chessboard } from "react-chessboard";
import { cn } from "@/utils/cn";
import { useRepertoireStore } from "@/stores/repertoireStore";
import { useBackgroundStore } from "@/stores/backgroundStore";
import { BackgroundAnalysisQueue } from "@/services/background_analysis";
import * as api from "@/services/api";
import { BOARD_THEME_MUTED } from "@/design/tokens";
import { StatusChip, type ChipTone } from "@/v2/components/StatusChip";

export type TrainingMode = "blunder" | "repertoire";
export type PhaseFilter = "all" | "opening" | "endgame";

interface HomeScreenProps {
  onTrainNow: (mode: TrainingMode, phase: PhaseFilter) => void;
  onGames: () => void;
  onLearn: () => void;
}

// Label = the phase LearnScreen opens for that stage (see stageForLessonStage):
// 0 -> watch, 1 -> guided, 2 -> blind, 3 (refresh) -> blind.
const STAGE_CHIP: Record<number, { label: string; tone: ChipTone; className?: string }> = {
  0: { label: "WATCH", tone: "primary", className: "text-white" },
  1: { label: "GUIDED", tone: "primary", className: "text-white" },
  2: { label: "BLIND", tone: "primary", className: "text-white" },
  3: { label: "REFRESH", tone: "success" },
};

function formatLastSeen(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Last session: today";
  if (days === 1) return "Last session: yesterday";
  return `Last session: ${days}d ago`;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onTrainNow,
  onGames,
  onLearn,
}) => {
  const repertoireId = useRepertoireStore((s) => s.repertoireId);
  const availableRepertoires = useRepertoireStore(
    (s) => s.availableRepertoires,
  );
  const setActiveRepertoire = useRepertoireStore((s) => s.setActiveRepertoire);
  const [count, setCount] = useState<api.TrainNowCounts | null>(null);
  // A failed/timed-out count fetch is not "nothing due" — track it separately.
  const [countFailed, setCountFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [streak, setStreak] = useState(0);
  const [dailyGoalDone, setDailyGoalDone] = useState(false);
  const [lastReviewed, setLastReviewed] = useState<string | null>(null);
  const [weakest, setWeakest] = useState<api.WeakestPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [lessonState, setLessonState] = useState<{
    loading: boolean;
    lesson: api.Lesson | null;
    learned: number;
  }>({ loading: true, lesson: null, learned: 0 });

  const isAnalyzing = useBackgroundStore((s) => s.isAnalyzing);
  const analyzedCount = useBackgroundStore((s) => s.analyzedCount);
  const totalInQueue = useBackgroundStore((s) => s.totalInQueue);
  const activeGameName = useBackgroundStore((s) => s.activeGameName);

  async function handleRefreshAnalysis() {
    if (refreshing || isAnalyzing) return;
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const { queued } = await api.refreshAnalysis();
      if (queued === 0) {
        setRefreshMsg("All games already up to date");
      } else {
        setRefreshMsg(`Queued ${queued} games for re-analysis`);
        BackgroundAnalysisQueue.triggerNow();
      }
    } catch {
      setRefreshMsg("Failed to queue games");
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 4000);
    }
  }

  useEffect(() => {
    if (!repertoireId) return;
    setLoading(true);

    Promise.all([
      api.getTrainNowCounts(repertoireId, phase).catch(() => null),
      api.getProgressStats(repertoireId).catch(() => null),
      api.getWeakestPosition(repertoireId).catch(() => null),
    ])
      .then(([counts, stats, weak]) => {
        setCount(counts);
        setCountFailed(counts === null);
        if (stats) {
          setStreak(stats.streak);
          setDailyGoalDone(stats.dailyGoalDone ?? false);
          setLastReviewed(stats.lastReviewed ?? null);
        }
        setWeakest(weak);
      })
      .finally(() => setLoading(false));
  }, [repertoireId, phase, reloadTick]);

  useEffect(() => {
    if (!repertoireId) return;
    setLessonState((s) => ({ ...s, loading: true }));
    api
      .getNextLesson(repertoireId)
      .then((result) => {
        setLessonState({
          loading: false,
          lesson: result.lesson,
          learned: result.totals.learned,
        });
      })
      .catch(() => {
        setLessonState({ loading: false, lesson: null, learned: 0 });
      });
  }, [repertoireId]);

  const greeting = getGreeting();
  const lastSeenLabel = formatLastSeen(lastReviewed);

  return (
    <div className="flex-1 flex flex-col gap-3 px-5 pt-4 pb-4 overflow-y-auto">
      {/* Header: greeting + repertoire select, then streak / goal chips */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-black text-forge-text-primary tracking-tight truncate">
            {greeting}
          </h1>
          {availableRepertoires.length > 1 && (
            <select
              value={repertoireId}
              onChange={(e) => setActiveRepertoire(Number(e.target.value))}
              aria-label="Active repertoire"
              className="min-w-0 max-w-[55%] truncate text-base font-semibold bg-forge-border-subtle border border-forge-border-default text-forge-text-primary rounded-lg px-3 py-2 min-h-[44px] appearance-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {availableRepertoires.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap min-h-[28px]">
          {streak > 0 && (
            <div className="flex items-center gap-1.5 bg-forge-card border border-forge-border-subtle rounded-full px-3 py-1">
              <Flame
                size={13}
                className={dailyGoalDone ? "text-forge-warm" : "text-forge-text-muted"}
              />
              <span className="text-xs font-black text-forge-text-primary">{streak}</span>
              <span className="text-xs text-forge-text-inactive">day streak</span>
            </div>
          )}
          {!loading &&
            (dailyGoalDone ? (
              <StatusChip tone="success" className="gap-1">
                <CheckCircle2 size={11} /> Goal done
                <span className="sr-only">. Come back tomorrow to keep the streak going.</span>
              </StatusChip>
            ) : (
              <StatusChip tone="neutral" className="gap-1">
                <Circle size={11} /> Goal: 1 session today
              </StatusChip>
            ))}
          {lastSeenLabel && (
            <span className="text-[10px] text-forge-text-muted">{lastSeenLabel}</span>
          )}
        </div>
      </div>

      {/* Learn Card */}
      <LearnCard state={lessonState} onLearn={onLearn} />

      {/* Train Now Card */}
      <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-4">
        {loading ? (
          <div className="space-y-3 mb-3">
            <div className="h-4 w-40 bg-forge-border-subtle rounded-full motion-safe:animate-pulse" />
            <div className="h-4 w-24 bg-forge-border-subtle rounded-full motion-safe:animate-pulse" />
          </div>
        ) : count && count.total > 0 ? (
          <div className="mb-3">
            <p className="text-sm font-black text-forge-text-primary mb-0.5">12-position session</p>
            <p className="text-xs text-forge-text-inactive leading-relaxed">
              Pool:{" "}
              {[
                count.blunders > 0 && (
                  <span key="b" className="text-forge-danger">
                    {count.blunders} blunder{count.blunders !== 1 ? "s" : ""}
                  </span>
                ),
                count.deviations > 0 && (
                  <span key="d" className="text-forge-warning">
                    {count.deviations} deviation
                    {count.deviations !== 1 ? "s" : ""}
                  </span>
                ),
                count.review > 0 && (
                  <span key="r" className="text-forge-text-primary">
                    {count.review} review
                  </span>
                ),
              ]
                .filter(Boolean)
                .reduce<React.ReactNode[]>((acc, el, i) => {
                  if (i > 0)
                    acc.push(
                      <span key={`sep-${i}`} className="text-forge-text-muted">
                        {" "}
                        &middot;{" "}
                      </span>,
                    );
                  acc.push(el);
                  return acc;
                }, [])}
            </p>
          </div>
        ) : countFailed ? (
          <p className="text-sm text-forge-text-secondary mb-3">
            Couldn&apos;t load your queue.{" "}
            <button
              onClick={() => setReloadTick((n) => n + 1)}
              className="inline-flex items-center min-h-[44px] px-2 font-bold text-forge-primary underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
            >
              Retry
            </button>
          </p>
        ) : (
          <p className="text-sm text-forge-text-secondary mb-3">
            No positions due — check back after your next game
          </p>
        )}

        {/* Phase filter — segmented control */}
        <div
          role="group"
          aria-label="Session phase"
          className="flex gap-0.5 p-0.5 mb-3 bg-forge-elevated rounded-full"
        >
          {(["all", "opening", "endgame"] as PhaseFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setPhase(v)}
              aria-pressed={phase === v}
              className={cn(
                "flex-1 px-3 min-h-[44px] rounded-full text-xs font-bold uppercase tracking-wide cursor-pointer",
                "transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                phase === v
                  ? "bg-forge-primary text-white"
                  : "text-forge-text-inactive hover:text-forge-text-primary",
              )}
            >
              {v === "opening" ? "Opening/Mid" : v === "endgame" ? "Endgame" : "All"}
            </button>
          ))}
        </div>

        <button
          onClick={() => onTrainNow("blunder", phase)}
          className={cn(
            "w-full flex items-center justify-center gap-3 cursor-pointer",
            "bg-forge-primary hover:bg-forge-primary-hover active:scale-[0.98]",
            "text-white font-black text-lg uppercase tracking-widest",
            "py-4 rounded-forge-md transition-all duration-150",
            "shadow-xl shadow-[var(--forge-accent-primary-shadow)]",
            "border border-forge-primary-border",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-forge-card",
          )}
        >
          <Play size={22} fill="currentColor" />
          Train Now
        </button>
      </div>

      {/* Weakest position preview */}
      {weakest && (
        <button
          onClick={() => onTrainNow("blunder", "all")}
          className={cn(
            "w-full flex items-center gap-3 p-2.5 cursor-pointer",
            "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
            "text-left active:scale-[0.98] transition-all duration-150",
            "hover:border-forge-border-default",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
          )}
        >
          <div className="w-12 aspect-square rounded-lg overflow-hidden border border-forge-border-subtle shrink-0">
            <Chessboard
              position={weakest.fen}
              arePiecesDraggable={false}
              boardWidth={48}
              animationDuration={0}
              {...BOARD_THEME_MUTED}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Target size={12} className="text-forge-danger shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-widest text-forge-text-inactive">
                Weakest position
              </span>
            </div>
            <p className="text-sm font-black text-forge-text-primary truncate">
              {weakest.correctSan}
              <span className="ml-2 text-xs text-forge-danger font-semibold">
                {weakest.accuracy}% accuracy
              </span>
            </p>
          </div>
          <div className="text-forge-text-muted shrink-0">›</div>
        </button>
      )}

      {/* Secondary actions */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onGames}
          className={cn(
            "flex items-center justify-center gap-2 px-3 min-h-[56px] cursor-pointer",
            "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
            "text-forge-text-secondary hover:text-forge-text-primary hover:border-forge-border-default",
            "transition-colors duration-150 active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
          )}
        >
          <Film size={18} />
          <span className="text-xs font-black uppercase tracking-wider">
            Review Games
          </span>
        </button>

        <button
          onClick={() => onTrainNow("repertoire", "all")}
          className={cn(
            "flex items-center justify-center gap-2 px-3 min-h-[56px] cursor-pointer",
            "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
            "text-forge-text-secondary hover:text-forge-text-primary hover:border-forge-border-default",
            "transition-colors duration-150 active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
          )}
        >
          <BookOpen size={18} />
          <span className="text-xs font-black uppercase tracking-wider">
            Drill Lines
          </span>
        </button>
      </div>

      {/* Analysis status + refresh — one small line */}
      {isAnalyzing ? (
        <div className="flex items-center gap-2 px-2 text-[10px] text-forge-text-inactive">
          <Loader2 size={10} className="motion-safe:animate-spin text-forge-primary-hover shrink-0" />
          <span className="truncate">
            {activeGameName
              ? `Analyzing ${analyzedCount}/${totalInQueue} — ${activeGameName}`
              : "Analyzing games..."}
          </span>
        </div>
      ) : (
        // -my-3 keeps the row visually one line tall while the button's 44px
        // hit area extends into the surrounding gap-3 spacing.
        <div className="flex items-center gap-2 px-2 -my-3">
          <button
            onClick={handleRefreshAnalysis}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-[10px] text-forge-text-muted hover:text-forge-text-secondary transition-colors duration-150 disabled:opacity-40 cursor-pointer min-h-[44px] px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
          >
            {refreshing
              ? <Loader2 size={10} className="motion-safe:animate-spin" />
              : <RefreshCw size={10} />}
            Refresh analysis
          </button>
          {refreshMsg && (
            <span className="text-[10px] text-forge-text-inactive">{refreshMsg}</span>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Learn Card sub-component
// ---------------------------------------------------------------------------

interface LearnCardProps {
  state: { loading: boolean; lesson: api.Lesson | null; learned: number };
  onLearn: () => void;
}

function LearnCard({ state, onLearn }: LearnCardProps) {
  const { loading, lesson, learned } = state;

  // Reserve the card's height while loading so the layout doesn't jump.
  if (loading) {
    return (
      <div
        aria-hidden="true"
        className="min-h-[64px] bg-forge-card border border-forge-border-subtle rounded-forge-xl motion-safe:animate-pulse"
      />
    );
  }

  if (!lesson) {
    if (learned === 0) return null;
    return (
      <div
        className={cn(
          "w-full flex items-center gap-3 p-3 min-h-[64px]",
          "bg-forge-card border border-forge-success rounded-forge-xl",
        )}
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-[var(--forge-accent-success-muted)]">
          <CheckCircle2 size={20} className="text-forge-success" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-forge-success">
            All lines learned
          </p>
          <p className="text-xs text-forge-text-inactive mt-0.5">
            {learned} line{learned !== 1 ? "s" : ""} mastered
          </p>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onLearn}
      className={cn(
        "w-full flex items-center gap-3 p-3 min-h-[64px] cursor-pointer",
        "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
        "text-left active:scale-[0.98] transition-all duration-150",
        "hover:border-forge-border-default",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
      )}
    >
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-forge-elevated">
        <GraduationCap size={20} className="text-forge-primary-hover" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <StatusChip
            tone={(STAGE_CHIP[lesson.stage] ?? STAGE_CHIP[0]).tone}
            className={(STAGE_CHIP[lesson.stage] ?? STAGE_CHIP[0]).className}
          >
            {(STAGE_CHIP[lesson.stage] ?? STAGE_CHIP[0]).label}
          </StatusChip>
          <p className="text-sm font-black text-forge-text-primary truncate">
            {lesson.chapterName ?? "Learn a line"}
          </p>
        </div>
        <p className="text-xs text-forge-text-inactive">
          {lesson.frequency > 0 && `Seen in your games ${lesson.frequency}× · `}
          ~{lesson.estMinutes} min
        </p>
      </div>
      <div className="text-forge-text-muted shrink-0">›</div>
    </button>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
