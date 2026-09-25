import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, Sparkles } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * Step shape mirrors the server's CoachStep. Repeated here (rather than
 * imported from server code) to keep the frontend bundle clean of server-side
 * imports — types are tiny and stable.
 */
export type CoachStepAction =
  | { type: "playMove"; san: string; highlight?: "red" | "green" | "amber" }
  | {
      type: "highlight";
      squares: string[];
      color?: "red" | "green" | "amber" | "blue";
    }
  | {
      type: "arrow";
      from: string;
      to: string;
      color?: "red" | "green" | "amber" | "blue";
    }
  | { type: "noop" };

export interface CoachStep {
  text: string;
  action: CoachStepAction;
}

export interface InteractiveCoachCallbacks {
  /** Reset the board to the original blunder FEN, no highlights, no arrows. */
  onResetBoard: () => void;
  /** Play a SAN move on the current board state (cumulative). */
  onPlayMove: (san: string, highlight?: "red" | "green" | "amber") => void;
  /** Highlight squares (replaces any prior highlight set). */
  onHighlight: (squares: string[], color?: "red" | "green" | "amber" | "blue") => void;
  /** Draw an arrow (replaces any prior arrow). */
  onArrow: (from: string, to: string, color?: "red" | "green" | "amber" | "blue") => void;
}

interface InteractiveCoachProps extends InteractiveCoachCallbacks {
  steps: CoachStep[];
  /** Indices in `steps` that mark the start of a new "segment" — the board
   *  is reset before dispatching these beats. By default the penultimate
   *  beat (index = steps.length - 2) is treated as a reset point so the
   *  correct-move replay starts from the original FEN, not from the
   *  refutation position. */
  resetIndices?: number[];
  /** Auto-advance interval in ms. Default 3500. */
  autoAdvanceMs?: number;
}

const STEP_INDEX_BG: Record<string, string> = {
  red: "bg-forge-danger-muted border-forge-danger-border text-forge-danger",
  green: "bg-forge-success-muted border-forge-success-border text-forge-success",
  amber: "bg-forge-warning-muted border-forge-warning-border text-forge-warning",
  blue: "bg-forge-primary-muted border-forge-primary-border text-forge-primary-hover",
};

function resolveBeatTone(step: CoachStep): "red" | "green" | "amber" | "blue" {
  const a = step.action;
  if (a.type === "playMove") return a.highlight ?? "amber";
  if (a.type === "highlight") return a.color ?? "blue";
  if (a.type === "arrow") return a.color ?? "blue";
  return "blue";
}

/**
 * InteractiveCoach — caption strip + auto-play controller for the structured
 * walkthrough. The board itself lives in the parent (TrainNowScreen /
 * MistakeCoachPanel) and is driven through the four imperative callbacks.
 *
 * Rendering split:
 *   - Parent owns the board (already wired with arrows/highlights/animated FEN).
 *   - This component owns the caption + step dots + chevrons + auto-advance
 *     timer, and dispatches each beat's action via callbacks.
 */
export const InteractiveCoach: React.FC<InteractiveCoachProps> = ({
  steps,
  resetIndices,
  autoAdvanceMs = 3500,
  onResetBoard,
  onPlayMove,
  onHighlight,
  onArrow,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Default reset points: before beat 0 (always) and before the penultimate
  // beat (correct-move replay). Allow override via prop.
  // Two-beat walkthroughs are [wrong, best]: a final playMove beat is the
  // best move and must start from the original FEN, not after the wrong one.
  const defaultResetIndices =
    steps.length >= 3
      ? [0, steps.length - 2]
      : steps.length === 2 && steps[1].action.type === "playMove"
        ? [0, 1]
        : [0];
  const effectiveResets = new Set(resetIndices ?? defaultResetIndices);

  const dispatchedFor = useRef<number>(-1);

  // Dispatch the action for the current step. We track the last-dispatched
  // index in a ref so React Strict Mode double-invocation doesn't fire each
  // beat twice (which would re-play moves on top of each other).
  useEffect(() => {
    if (dispatchedFor.current === currentStep) return;
    dispatchedFor.current = currentStep;

    if (currentStep < 0 || currentStep >= steps.length) return;
    const step = steps[currentStep];
    const action = step.action;

    if (effectiveResets.has(currentStep)) {
      onResetBoard();
    }

    // Tiny defer so the reset's React state flush happens before the next
    // imperative call — keeps animations in the right order.
    const t = setTimeout(() => {
      if (action.type === "playMove") {
        onPlayMove(action.san, action.highlight);
      } else if (action.type === "highlight") {
        onHighlight(action.squares, action.color);
      } else if (action.type === "arrow") {
        onArrow(action.from, action.to, action.color);
      }
      // noop: text-only beat — no board action.
    }, 60);
    return () => clearTimeout(t);
    // We only want this to run when currentStep changes — the callbacks are
    // intentionally captured fresh per render via closure but the ref guard
    // above prevents double-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, steps]);

  // Auto-advance timer — pauses on user interaction.
  useEffect(() => {
    if (isPaused) return;
    if (currentStep >= steps.length - 1) return; // hold on last beat
    const t = setTimeout(() => {
      setCurrentStep((s) => Math.min(steps.length - 1, s + 1));
    }, autoAdvanceMs);
    return () => clearTimeout(t);
  }, [currentStep, isPaused, autoAdvanceMs, steps.length]);

  /**
   * Rebuild the board for `idx` instead of dispatching that beat alone.
   * playMove beats are cumulative, so a beat's SAN is only legal from the
   * position its predecessors produced — dispatching it against a freshly
   * reset board silently no-ops and desyncs the caption from the board.
   * Reset to the start of `idx`'s segment, then replay every playMove beat
   * up to (but not including) `idx`; the effect above dispatches `idx`.
   */
  function rebuildBoardFor(idx: number) {
    let segmentStart = 0;
    for (const r of effectiveResets) {
      if (r <= idx && r > segmentStart) segmentStart = r;
    }
    onResetBoard();
    for (let i = segmentStart; i < idx; i++) {
      const action = steps[i].action;
      if (action.type === "playMove") onPlayMove(action.san, action.highlight);
    }
    // Clear the guard so the effect dispatches the target beat itself.
    dispatchedFor.current = -1;
  }

  function handleManualNav(delta: 1 | -1) {
    setIsPaused(true);
    const next = Math.max(0, Math.min(steps.length - 1, currentStep + delta));
    if (next === currentStep) return;
    // Stepping forward one beat is already cumulative; stepping back needs
    // the board rebuilt from the segment start.
    if (delta === -1) rebuildBoardFor(next);
    setCurrentStep(next);
  }

  function handleJumpTo(idx: number) {
    if (idx === currentStep) return;
    setIsPaused(true);
    rebuildBoardFor(idx);
    setCurrentStep(idx);
  }

  if (steps.length === 0) return null;

  const step = steps[currentStep];
  const tone = resolveBeatTone(step);

  return (
    <div className="rounded-2xl border border-forge-primary-border bg-forge-primary-muted px-3 py-3 flex flex-col gap-2.5">
      {/* Header: Coach Walkthrough label + step counter */}
      <div className="flex items-center gap-1.5">
        <Sparkles size={11} className="text-forge-primary-hover shrink-0" />
        <span className="text-[10px] font-black uppercase tracking-widest text-forge-primary-hover">
          Coach Walkthrough
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-forge-text-inactive font-semibold">
          {currentStep + 1}/{steps.length}
        </span>
      </div>

      {/* Caption strip — tap to toggle pause */}
      <button
        type="button"
        onClick={() => setIsPaused((p) => !p)}
        className={cn(
          "w-full text-left rounded-xl border px-3 py-2.5 transition-all min-h-[56px] flex items-start gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-primary-hover",
          STEP_INDEX_BG[tone],
        )}
      >
        <span className="shrink-0 mt-0.5 opacity-70">
          {isPaused ? <Play size={12} /> : <Pause size={12} />}
        </span>
        <span className="text-[13px] leading-snug font-semibold flex-1">
          {step.text}
        </span>
      </button>

      {/* Step dots — tap to jump */}
      <div className="flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={() => handleManualNav(-1)}
          disabled={currentStep === 0}
          aria-label="Previous beat"
          className={cn(
            "min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-primary-hover rounded-lg text-forge-text-secondary hover:text-forge-text-primary disabled:opacity-30 transition-all active:scale-95",
            "border border-forge-border-subtle bg-forge-card",
          )}
        >
          <ChevronLeft size={14} />
        </button>

        <div className="flex items-center gap-1.5 px-2">
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleJumpTo(i)}
              aria-label={`Jump to beat ${i + 1}`}
              className={cn(
                "rounded-full transition-all bg-clip-content py-[18px] box-content min-h-0 h-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-primary-hover",
                i === currentStep
                  ? "w-6 bg-forge-primary-hover"
                  : "w-2 bg-forge-text-inactive hover:bg-forge-text-secondary",
              )}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => handleManualNav(1)}
          disabled={currentStep === steps.length - 1}
          aria-label="Next beat"
          className={cn(
            "min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forge-primary-hover rounded-lg text-forge-text-secondary hover:text-forge-text-primary disabled:opacity-30 transition-all active:scale-95",
            "border border-forge-border-subtle bg-forge-card",
          )}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};
