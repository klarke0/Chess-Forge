import React, { useEffect, useState } from "react";
import { Play, Film, BookOpen, Flame, RefreshCw, Loader2, Target, CheckCircle2, Circle, GraduationCap } from "lucide-react";
import { Chessboard } from "react-chessboard";
import { cn } from "@/utils/cn";
import { useRepertoireStore } from "@/stores/repertoireStore";
import { useBackgroundStore } from "@/stores/backgroundStore";
import { BackgroundAnalysisQueue } from "@/services/background_analysis";
import * as api from "@/services/api";
import { BOARD_THEME_MUTED } from "@/design/tokens";

export type TrainingMode = "blunder" | "repertoire";
export type PhaseFilter = "all" | "opening" | "endgame";

interface HomeScreenProps {
  onTrainNow: (mode: TrainingMode, phase: PhaseFilter) => void;
  onGames: () => void;
  onLearn: () => void;
}

const STAGE_CHIP: Record<number, string> = {
  0: "NEW",
  1: "WATCHED",
  2: "GUIDED",
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
      api
        .getTrainNowCounts(repertoireId, phase)
        .catch(
          () =>
            ({
              total: 0,
              blunders: 0,
              deviations: 0,
              review: 0,
            }) as api.TrainNowCounts,
        ),
      api.getProgressStats(repertoireId).catch(() => null),
      api.getWeakestPosition(repertoireId).catch(() => null),
    ])
      .then(([counts, stats, weak]) => {
        setCount(counts);
        if (stats) {
          setStreak(stats.streak);
          setDailyGoalDone(stats.dailyGoalDone ?? false);
          setLastReviewed(stats.lastReviewed ?? null);
        }
        setWeakest(weak);
      })
      .finally(() => setLoading(false));
  }, [repertoireId, phase]);

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
    <div className="flex-1 flex flex-col px-6 pt-10 pb-24 overflow-y-auto">
      {/* Greeting + meta row */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-slate-100 tracking-tight">
          {greeting}
        </h1>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {streak > 0 && (
            <div className="flex items-center gap-1.5 bg-forge-card border border-forge-border-subtle rounded-full px-3 py-1">
              <Flame size={13} className="text-forge-warm" />
              <span className="text-xs font-black text-slate-200">{streak}</span>
              <span className="text-xs text-slate-500">day streak</span>
            </div>
          )}
          {lastSeenLabel && (
            <span className="text-xs text-slate-600">{lastSeenLabel}</span>
          )}
          {availableRepertoires.length > 1 && (
            <select
              value={repertoireId}
              onChange={(e) => setActiveRepertoire(Number(e.target.value))}
              className="ml-auto text-xs font-semibold bg-forge-border-subtle border border-forge-border-default text-slate-300 rounded-lg px-2 py-1 appearance-none cursor-pointer"
            >
              {availableRepertoires.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Learn Card */}
      <LearnCard state={lessonState} onLearn={onLearn} />

      {/* Train Now Card */}
      <div className="bg-forge-card border border-forge-border-subtle rounded-[2.5rem] p-8 mb-5">
        {loading ? (
          <div className="space-y-3">
            <div className="h-4 w-40 bg-forge-border-subtle rounded-full motion-safe:animate-pulse" />
            <div className="h-4 w-24 bg-forge-border-subtle rounded-full motion-safe:animate-pulse" />
          </div>
        ) : count && count.total > 0 ? (
          <div className="mb-6">
            <p className="text-sm font-black text-slate-200 mb-1">12-position session</p>
            <p className="text-xs text-slate-500 leading-relaxed">
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
        ) : (
          <p className="text-sm text-slate-400 mb-6">
            No positions due — check back after your next game
          </p>
        )}

        <button
          onClick={() => onTrainNow("blunder", phase)}
          className={cn(
            "w-full flex items-center justify-center gap-3 cursor-pointer",
            "bg-forge-primary hover:bg-forge-primary-hover active:scale-[0.98]",
            "text-white font-black text-lg uppercase tracking-widest",
            "py-5 rounded-forge-md transition-all duration-150",
            "shadow-xl shadow-[var(--forge-accent-primary-shadow)]",
            "border border-indigo-400/20",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-forge-card",
          )}
        >
          <Play size={22} fill="currentColor" />
          Train Now
        </button>
      </div>

      {/* Daily Challenge */}
      <DailyChallenge
        streak={streak}
        done={dailyGoalDone}
        onTrain={() => onTrainNow("blunder", phase)}
      />

      {/* Phase filter */}
      <div className="flex gap-2 justify-center mb-5">
        {(["opening", "all", "endgame"] as PhaseFilter[]).map((v) => (
          <button
            key={v}
            onClick={() => setPhase(v)}
            className={cn(
              "px-4 py-2 min-h-[36px] rounded-full text-xs font-bold uppercase tracking-wide cursor-pointer",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
              phase === v
                ? "bg-forge-primary text-white"
                : "bg-forge-card text-slate-500 border border-forge-border-subtle hover:text-slate-300 hover:border-forge-border-default",
            )}
          >
            {v === "opening" ? "Opening/Mid" : v === "endgame" ? "Endgame" : "All"}
          </button>
        ))}
      </div>

      {/* Weakest position preview */}
      {weakest && (
        <button
          onClick={() => onTrainNow("blunder", "all")}
          className={cn(
            "w-full flex items-center gap-4 p-4 mb-5 cursor-pointer",
            "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
            "text-left active:scale-[0.98] transition-all duration-150",
            "hover:border-forge-border-default",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
          )}
        >
          <div className="w-16 aspect-square rounded-lg overflow-hidden border border-forge-border-subtle shrink-0">
            <Chessboard
              position={weakest.fen}
              arePiecesDraggable={false}
              boardWidth={64}
              animationDuration={0}
              {...BOARD_THEME_MUTED}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Target size={12} className="text-rose-400 shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Weakest position
              </span>
            </div>
            <p className="text-sm font-black text-slate-200">
              {weakest.correctSan}
            </p>
            <p className="text-xs text-rose-400 font-semibold mt-0.5">
              {weakest.accuracy}% accuracy
            </p>
          </div>
          <div className="text-slate-600 shrink-0">›</div>
        </button>
      )}

      {/* Secondary Cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <button
          onClick={onGames}
          className={cn(
            "flex flex-col items-center justify-center gap-3 p-6 min-h-[88px] cursor-pointer",
            "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
            "text-slate-400 hover:text-slate-200 hover:border-forge-border-default",
            "transition-colors duration-150 active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
          )}
        >
          <Film size={24} />
          <span className="text-xs font-black uppercase tracking-wider">
            Review Games
          </span>
        </button>

        <button
          onClick={() => onTrainNow("repertoire", "all")}
          className={cn(
            "flex flex-col items-center justify-center gap-3 p-6 min-h-[88px] cursor-pointer",
            "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
            "text-slate-400 hover:text-slate-200 hover:border-forge-border-default",
            "transition-colors duration-150 active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
          )}
        >
          <BookOpen size={24} />
          <span className="text-xs font-black uppercase tracking-wider">
            Drill Lines
          </span>
        </button>
      </div>

      {/* Analysis status + refresh */}
      {isAnalyzing ? (
        <div className="flex items-center gap-2 px-2 py-2 text-xs text-slate-500">
          <Loader2 size={12} className="motion-safe:animate-spin text-indigo-400 shrink-0" />
          <span className="truncate">
            {activeGameName
              ? `Analyzing ${analyzedCount}/${totalInQueue} — ${activeGameName}`
              : "Analyzing games..."}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-2">
          <button
            onClick={handleRefreshAnalysis}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors duration-150 disabled:opacity-40 cursor-pointer min-h-[44px] px-2"
          >
            {refreshing
              ? <Loader2 size={11} className="motion-safe:animate-spin" />
              : <RefreshCw size={11} />}
            Refresh analysis
          </button>
          {refreshMsg && (
            <span className="text-xs text-slate-500">{refreshMsg}</span>
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

  if (loading) return null;

  if (!lesson) {
    if (learned === 0) return null;
    return (
      <div
        className={cn(
          "w-full flex items-center gap-4 p-4 mb-5",
          "bg-forge-card border border-forge-success rounded-forge-xl",
        )}
      >
        <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-[var(--forge-accent-success-muted)]">
          <CheckCircle2 size={22} className="text-forge-success" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-forge-success">
            All lines learned
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
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
        "w-full flex items-center gap-4 p-4 mb-5 cursor-pointer",
        "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
        "text-left active:scale-[0.98] transition-all duration-150",
        "hover:border-forge-border-default",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
      )}
    >
      <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-forge-elevated">
        <GraduationCap size={22} className="text-indigo-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-forge-sm bg-indigo-600 text-white shrink-0">
            {STAGE_CHIP[lesson.stage] ?? "NEW"}
          </span>
          <p className="text-sm font-black text-slate-200 truncate">
            {lesson.chapterName ?? "Learn a line"}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          {lesson.frequency > 0 && `Seen in your games ${lesson.frequency}× · `}
          ~{lesson.estMinutes} min
        </p>
      </div>
      <div className="text-slate-600 shrink-0">›</div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Daily Challenge sub-component
// ---------------------------------------------------------------------------

interface DailyChallengeProps {
  streak: number;
  done: boolean;
  onTrain: () => void;
}

function DailyChallenge({ streak, done, onTrain }: DailyChallengeProps) {
  return (
    <button
      onClick={done ? undefined : onTrain}
      disabled={done}
      className={cn(
        "w-full flex items-center gap-4 p-4 mb-5",
        "border rounded-forge-xl text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
        done
          ? "bg-forge-card border-forge-success cursor-default transition-colors duration-150"
          : "bg-forge-card border-forge-border-subtle cursor-pointer active:scale-[0.98] hover:border-indigo-400/30 transition-all duration-150",
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "w-11 h-11 rounded-full flex items-center justify-center shrink-0",
          done
            ? "bg-[var(--forge-accent-success-muted)]"
            : "bg-forge-elevated",
        )}
      >
        {done ? (
          <CheckCircle2 size={22} className="text-forge-success" />
        ) : (
          <Circle size={22} className="text-slate-500" />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-black",
            done ? "text-forge-success" : "text-slate-200",
          )}
        >
          {done ? "Daily goal complete!" : "Daily goal"}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {done
            ? "Come back tomorrow to keep the streak going"
            : "Complete 1 training session today"}
        </p>
      </div>

      {/* Streak badge */}
      {streak > 0 && (
        <div className="flex flex-col items-center shrink-0">
          <Flame
            size={18}
            className={cn(done ? "text-forge-warm" : "text-slate-600")}
          />
          <span
            className={cn(
              "text-xs font-black mt-0.5 tabular-nums",
              done ? "text-forge-warm" : "text-slate-600",
            )}
          >
            {streak}
          </span>
        </div>
      )}
    </button>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
