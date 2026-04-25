import React, { useEffect, useState } from "react";
import { Play, Film, BookOpen, Flame } from "lucide-react";
import { cn } from "@/utils/cn";
import { useRepertoireStore } from "@/stores/repertoireStore";
import * as api from "@/services/api";

export type TrainingMode = "blunder" | "repertoire";
export type PhaseFilter = "all" | "opening" | "endgame";

interface HomeScreenProps {
  onTrainNow: (mode: TrainingMode, phase: PhaseFilter) => void;
  onGames: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onTrainNow,
  onGames,
}) => {
  const repertoireId = useRepertoireStore((s) => s.repertoireId);
  const availableRepertoires = useRepertoireStore(
    (s) => s.availableRepertoires,
  );
  const setActiveRepertoire = useRepertoireStore((s) => s.setActiveRepertoire);
  const [count, setCount] = useState<api.TrainNowCounts | null>(null);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<PhaseFilter>("all");

  useEffect(() => {
    if (!repertoireId) return;
    setLoading(true);

    // Fetch train-now counts and progress stats in parallel
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
    ])
      .then(([counts, stats]) => {
        setCount(counts);
        if (stats) {
          setStreak(stats.streak);
        }
      })
      .finally(() => setLoading(false));
  }, [repertoireId, phase]);

  const greeting = getGreeting();

  return (
    <div className="flex-1 flex flex-col px-6 pt-12 pb-24 overflow-y-auto">
      {/* Greeting + Streak */}
      <div className="mb-10">
        <h1 className="text-2xl font-black text-slate-100 tracking-tight">
          {greeting}
        </h1>
        <div className="flex items-center gap-3 mt-2">
          {streak > 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Flame size={16} className="text-forge-warm" />
              <span className="font-semibold">{streak} day streak</span>
            </div>
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

      {/* Train Now Card */}
      <div className="bg-forge-card border border-forge-border-subtle rounded-[2.5rem] p-8 mb-6">
        {loading ? (
          <div className="space-y-3">
            <div className="h-4 w-40 bg-forge-border-subtle rounded-full animate-pulse" />
            <div className="h-4 w-24 bg-forge-border-subtle rounded-full animate-pulse" />
          </div>
        ) : count && count.total > 0 ? (
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            {[
              count.blunders > 0 && (
                <span key="b" className="text-forge-danger font-semibold">
                  {count.blunders} blunder{count.blunders !== 1 ? "s" : ""}
                </span>
              ),
              count.deviations > 0 && (
                <span key="d" className="text-forge-warning font-semibold">
                  {count.deviations} deviation
                  {count.deviations !== 1 ? "s" : ""}
                </span>
              ),
              count.review > 0 && (
                <span key="r" className="text-forge-text-primary font-semibold">
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
        ) : (
          <p className="text-sm text-slate-400 mb-6">
            No positions due — check back after your next game
          </p>
        )}

        {/* Phase filter */}
        <div className="flex gap-1 mb-5 bg-forge-border-subtle rounded-xl p-1">
          {(
            [
              { value: "opening" as PhaseFilter, label: "Opening/Mid" },
              { value: "all" as PhaseFilter, label: "All" },
              { value: "endgame" as PhaseFilter, label: "Endgame" },
            ] as { value: PhaseFilter; label: string }[]
          ).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPhase(value)}
              className={cn(
                "flex-1 py-2 text-xs font-black uppercase tracking-wide rounded-lg transition-all",
                phase === value
                  ? "bg-forge-primary text-white"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => onTrainNow("blunder", phase)}
          className={cn(
            "w-full flex items-center justify-center gap-3",
            "bg-forge-primary hover:bg-forge-primary-hover active:scale-[0.98]",
            "text-white font-black text-lg uppercase tracking-widest",
            "py-5 rounded-forge-md transition-all",
            "shadow-xl shadow-[var(--forge-accent-primary-shadow)]",
            "border border-indigo-400/20",
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
            "flex flex-col items-center justify-center gap-3 p-6",
            "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
            "text-slate-400 hover:text-slate-200 transition-all active:scale-[0.98]",
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
            "flex flex-col items-center justify-center gap-3 p-6",
            "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
            "text-slate-400 hover:text-slate-200 transition-all active:scale-[0.98]",
          )}
        >
          <BookOpen size={24} />
          <span className="text-xs font-black uppercase tracking-wider">
            Drill Lines
          </span>
        </button>
      </div>
    </div>
  );
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
