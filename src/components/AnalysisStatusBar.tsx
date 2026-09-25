import React from "react";
import { Cpu, Loader2, Square } from "lucide-react";
import { cn } from "../utils/cn";
import type { UseAnalysisStatus } from "../hooks/useAnalysisStatus";
import { formatCount, formatRunningLabel } from "../utils/analysisStatus";

interface AnalysisStatusBarProps {
  analysis: UseAnalysisStatus;
}

const BTN =
  "flex items-center justify-center gap-1.5 min-h-[44px] px-3 shrink-0 rounded-xl text-xs font-black uppercase tracking-wider " +
  "cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

/**
 * Server-side analysis job control for the Games tab: idle "Analyze (N left)",
 * running "Analyzing 132/1,015 · ~6h" + Stop, and a "N failed · Retry" action.
 * Renders nothing when the server job is unavailable or there is nothing to do.
 */
export const AnalysisStatusBar: React.FC<AnalysisStatusBarProps> = ({ analysis }) => {
  const { status, available, actionError, start, stop, retryFailed } = analysis;
  if (!available || !status) return null;

  const { running, current, counts } = status;
  if (!running && counts.pending === 0 && counts.failed === 0) return null;

  const currentTitle = current
    ? `${current.white} vs ${current.black} · move ${Math.ceil(current.ply / 2)} of ${Math.ceil(current.plies / 2)}`
    : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2">
        {running ? (
          <>
            <div
              className="flex flex-1 min-w-0 items-center gap-2 text-xs text-forge-text-secondary"
              title={currentTitle}
              role="status"
            >
              <Loader2
                size={12}
                className="motion-safe:animate-spin text-forge-primary-hover shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">{formatRunningLabel(status)}</span>
            </div>
            {counts.failed > 0 && <RetryButton failed={counts.failed} onRetry={retryFailed} />}
            <button
              onClick={stop}
              aria-label="Stop server analysis"
              className={cn(
                BTN,
                "bg-forge-danger-muted text-forge-danger border border-forge-danger-border hover:bg-forge-elevated",
              )}
            >
              <Square size={11} fill="currentColor" aria-hidden="true" />
              Stop
            </button>
          </>
        ) : (
          <>
            {counts.pending > 0 && (
              <button
                onClick={start}
                aria-label={`Analyze ${formatCount(counts.pending)} remaining games on the server`}
                className={cn(
                  BTN,
                  "bg-forge-elevated text-forge-primary-hover border border-forge-primary-border hover:bg-forge-card",
                )}
              >
                <Cpu size={12} aria-hidden="true" />
                Analyze ({formatCount(counts.pending)} left)
              </button>
            )}
            {counts.failed > 0 && <RetryButton failed={counts.failed} onRetry={retryFailed} />}
          </>
        )}
      </div>
      {actionError && (
        <p role="alert" className="text-[10px] text-forge-danger">
          {actionError}
        </p>
      )}
    </div>
  );
};

function RetryButton({ failed, onRetry }: { failed: number; onRetry: () => void }) {
  return (
    <button
      onClick={onRetry}
      aria-label={`Retry ${formatCount(failed)} failed game analyses`}
      className="min-h-[44px] px-2 shrink-0 text-xs font-bold text-forge-text-inactive hover:text-forge-text-primary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-lg"
    >
      {formatCount(failed)} failed · <span className="underline">Retry</span>
    </button>
  );
}
