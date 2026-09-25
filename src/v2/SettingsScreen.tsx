import React, { useEffect, useState } from "react";
import { Settings, RotateCcw, Eye, EyeOff, ChevronRight, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/utils/cn";
import * as api from "@/services/api";
import { useRepertoireStore } from "@/stores/repertoireStore";

// ---------------------------------------------------------------------------
// localStorage key for disabled repertoire IDs
// ---------------------------------------------------------------------------
const DISABLED_KEY = "forge:disabled_repertoires";

function loadDisabled(): Set<number> {
  try {
    const raw = localStorage.getItem(DISABLED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

function saveDisabled(ids: Set<number>) {
  localStorage.setItem(DISABLED_KEY, JSON.stringify(Array.from(ids)));
}

export function isRepertoireEnabled(id: number): boolean {
  return !loadDisabled().has(id);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepertoireStats {
  id: number;
  name: string;
  side: "white" | "black";
  positionCount: number;
  drilledCount: number;
  accuracy: number; // 0-100
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export const SettingsScreen: React.FC = () => {
  const [stats, setStats] = useState<RepertoireStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState<Set<number>>(loadDisabled);
  const [resetTarget, setResetTarget] = useState<RepertoireStats | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const selectedId = useRepertoireStore((s) => s.repertoireId);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    setLoading(true);
    try {
      const repertoires = await api.listRepertoires();
      const results = await Promise.all(
        repertoires.map(async (r) => {
          const [posData, progressStats] = await Promise.all([
            api.getPositions(r.id).catch(() => ({} as api.PositionTree)),
            api.getProgressStats(r.id).catch(() => null),
          ]);
          const positionCount = Object.keys(posData).length;
          return {
            id: r.id,
            name: r.name,
            side: r.side,
            positionCount,
            drilledCount: progressStats?.totalTracked ?? 0,
            accuracy: Math.round((progressStats?.weeklyAccuracy ?? 0) * 100),
          } satisfies RepertoireStats;
        }),
      );
      setStats(results);
    } catch {
      // silently fail — UI shows loading skeleton already
    } finally {
      setLoading(false);
    }
  }

  function toggleEnabled(id: number) {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveDisabled(next);
      return next;
    });
  }

  async function handleConfirmReset() {
    if (!resetTarget) return;
    setResetLoading(true);
    setResetMsg(null);
    try {
      await api.deleteRepertoireProgress(resetTarget.id);
      setResetMsg(`Progress cleared for ${resetTarget.name}`);
      // Refresh stats so counts go to 0
      await loadStats();
      // Close dialog after showing success message
      setTimeout(() => {
        setResetMsg(null);
        setResetTarget(null);
      }, 2500);
    } catch {
      // Show error in-dialog; close after a pause
      setResetMsg("Failed to reset — try again");
      setTimeout(() => {
        setResetMsg(null);
        setResetTarget(null);
      }, 3000);
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col px-6 pt-10 pb-24 overflow-y-auto">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-forge-elevated flex items-center justify-center shrink-0">
          <Settings size={18} className="text-forge-primary-hover" />
        </div>
        <div>
          <h1 className="text-xl font-black text-forge-text-primary tracking-tight">Settings</h1>
          <p className="text-xs text-forge-text-inactive mt-0.5">Manage your repertoires</p>
        </div>
      </div>

      {/* Repertoire cards */}
      <div className="space-y-4 mb-8">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : stats.length === 0 ? (
          <p className="text-sm text-forge-text-inactive text-center py-8">No repertoires found</p>
        ) : (
          stats.map((r) => (
            <RepertoireCard
              key={r.id}
              stat={r}
              enabled={!disabled.has(r.id)}
              selected={r.id === selectedId}
              onToggleEnabled={() => toggleEnabled(r.id)}
              onResetProgress={() => setResetTarget(r)}
            />
          ))
        )}
      </div>

      {/* Info section */}
      <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-5 mb-4">
        <h2 className="text-xs font-black uppercase tracking-widest text-forge-text-inactive mb-3">How it works</h2>
        <div className="space-y-3">
          <InfoRow
            icon={<EyeOff size={13} className="text-forge-text-inactive" />}
            text="Disabled repertoires are excluded from drill sessions. Re-enable them at any time."
          />
          <InfoRow
            icon={<RotateCcw size={13} className="text-forge-danger" />}
            text="Reset progress clears all SM-2 state so positions start fresh, as if never drilled."
          />
        </div>
      </div>

      {/* Reset confirm overlay */}
      {resetTarget && (
        <ResetConfirmSheet
          name={resetTarget.name}
          loading={resetLoading}
          msg={resetMsg}
          onConfirm={handleConfirmReset}
          onCancel={() => { setResetTarget(null); setResetMsg(null); }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Repertoire card
// ---------------------------------------------------------------------------

interface RepertoireCardProps {
  stat: RepertoireStats;
  enabled: boolean;
  selected: boolean;
  onToggleEnabled: () => void;
  onResetProgress: () => void;
}

function RepertoireCard({ stat, enabled, selected, onToggleEnabled, onResetProgress }: RepertoireCardProps) {
  const drilledPct = stat.positionCount > 0
    ? Math.round((stat.drilledCount / stat.positionCount) * 100)
    : 0;

  const sideLabel = stat.side === "white" ? "White" : "Black";
  const sideColor = stat.side === "white" ? "text-forge-text-primary" : "text-forge-text-secondary";

  const accuracyColor =
    stat.accuracy >= 80
      ? "text-forge-success"
      : stat.accuracy >= 60
      ? "text-forge-warning"
      : stat.drilledCount === 0
      ? "text-forge-text-inactive"
      : "text-forge-danger";

  return (
    <div
      className={cn(
        "bg-forge-card border rounded-forge-xl p-5 transition-all",
        enabled ? "border-forge-border-subtle" : "border-forge-border-subtle opacity-60",
      )}
    >
      {/* Name + side */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-black text-forge-text-primary leading-tight">
            {stat.name}
            {selected && (
              <span className="ml-2 align-middle text-[10px] font-black uppercase tracking-wider text-forge-primary-hover">
                Active
              </span>
            )}
          </h3>
          <span className={cn("text-xs font-semibold mt-0.5 block", sideColor)}>
            Playing as {sideLabel}
          </span>
        </div>
        {/* Enable/Disable toggle */}
        <button
          onClick={onToggleEnabled}
          aria-pressed={enabled}
          aria-label={`${enabled ? "Exclude" : "Include"} ${stat.name} in drill sessions`}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-full text-xs font-black uppercase tracking-wider cursor-pointer shrink-0",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
            enabled
              ? "bg-forge-elevated text-forge-text-primary border border-forge-border-default hover:border-forge-primary-border"
              : "bg-forge-elevated text-forge-text-inactive border border-forge-border-subtle hover:text-forge-text-secondary",
          )}
        >
          {enabled ? (
            <><Eye size={11} /> In drills</>
          ) : (
            <><EyeOff size={11} /> Off</>
          )}
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatPill
          label="Positions"
          value={stat.positionCount.toLocaleString()}
          color="text-forge-text-primary"
        />
        <StatPill
          label="Drilled"
          value={`${stat.drilledCount} / ${stat.positionCount}`}
          color="text-forge-primary-hover"
          sub={`${drilledPct}%`}
        />
        <StatPill
          label="Accuracy"
          value={stat.drilledCount > 0 ? `${stat.accuracy}%` : "—"}
          color={accuracyColor}
        />
      </div>

      {/* Drilled progress bar */}
      {stat.positionCount > 0 && (
        <div className="h-1 bg-forge-elevated rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-forge-primary rounded-full transition-all"
            style={{ width: `${drilledPct}%` }}
          />
        </div>
      )}

      {/* Reset button */}
      <button
        onClick={onResetProgress}
        className={cn(
          "w-full flex items-center justify-between px-4 py-3 min-h-[44px] cursor-pointer",
          "bg-forge-elevated border border-forge-border-subtle rounded-xl",
          "text-xs font-black uppercase tracking-wider text-forge-danger",
          "hover:border-forge-danger-border active:scale-[0.98] transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400",
        )}
      >
        <div className="flex items-center gap-2">
          <RotateCcw size={12} />
          Reset SM-2 Progress
        </div>
        <ChevronRight size={13} className="text-forge-text-muted" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatPill({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-forge-elevated rounded-xl px-3 py-2.5 text-center">
      <p className={cn("text-sm font-black leading-tight", color)}>{value}</p>
      {sub && <p className="text-[10px] text-forge-text-inactive mt-0.5">{sub}</p>}
      <p className="text-[10px] text-forge-text-inactive mt-1 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function InfoRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-xs text-forge-text-secondary leading-relaxed">{text}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-forge-card border border-forge-border-subtle rounded-forge-xl p-5 space-y-3">
      <div className="h-4 w-36 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
      <div className="h-3 w-24 bg-forge-elevated rounded-full motion-safe:animate-pulse" />
      <div className="grid grid-cols-3 gap-3">
        <div className="h-14 bg-forge-elevated rounded-xl motion-safe:animate-pulse" />
        <div className="h-14 bg-forge-elevated rounded-xl motion-safe:animate-pulse" />
        <div className="h-14 bg-forge-elevated rounded-xl motion-safe:animate-pulse" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reset confirm sheet (bottom drawer style)
// ---------------------------------------------------------------------------

interface ResetConfirmSheetProps {
  name: string;
  loading: boolean;
  msg: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function ResetConfirmSheet({ name, loading, msg, onConfirm, onCancel }: ResetConfirmSheetProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={!loading ? onCancel : undefined}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full max-w-[430px] bg-forge-surface border-t border-forge-border-subtle rounded-t-[2rem] px-6 pt-6 pb-10">
        {/* Handle */}
        <div className="w-10 h-1 bg-forge-border-default rounded-full mx-auto mb-6" />

        {/* Icon + title */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-[var(--forge-accent-danger-muted)] flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-forge-danger" />
          </div>
          <h2 className="text-base font-black text-forge-text-primary">Reset Progress</h2>
        </div>

        <p className="text-sm text-forge-text-secondary leading-relaxed mb-6">
          This will permanently clear all SM-2 data for{" "}
          <span className="text-forge-text-primary font-bold">{name}</span>. Positions
          will start fresh as if never drilled. This cannot be undone.
        </p>

        {/* Message */}
        {msg && (
          <div className={cn(
            "flex items-center gap-2 text-xs rounded-xl px-3 py-2.5 mb-4",
            msg.includes("Failed")
              ? "bg-[var(--forge-accent-danger-muted)] text-forge-danger"
              : "bg-[var(--forge-accent-success-muted)] text-forge-success",
          )}>
            <CheckCircle2 size={12} />
            {msg}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className={cn(
              "flex-1 py-3.5 min-h-[52px] rounded-xl text-sm font-black uppercase tracking-wider cursor-pointer",
              "bg-forge-elevated text-forge-text-primary border border-forge-border-subtle",
              "hover:border-forge-border-default active:scale-[0.98] transition-colors duration-150",
              "disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
            )}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "flex-1 py-3.5 min-h-[52px] rounded-xl text-sm font-black uppercase tracking-wider cursor-pointer",
              "bg-forge-danger text-white border border-forge-danger-border",
              "hover:bg-forge-danger active:scale-[0.98] transition-colors duration-150",
              "disabled:opacity-40 flex items-center justify-center gap-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400",
            )}
          >
            {loading ? (
              <><Loader2 size={14} className="motion-safe:animate-spin" /> Clearing…</>
            ) : (
              "Yes, Reset"
            )}
          </button>
        </div>
      </div>
    </>
  );
}
