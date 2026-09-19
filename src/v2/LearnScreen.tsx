import React, { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
// Square/Arrow aren't re-exported from the package root — reach into dist
// for the type only (erased at build time, no runtime import).
import type { Square as BoardSquare, Arrow as BoardArrow } from "react-chessboard/dist/chessboard/types";
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  ChevronsRight,
  Lightbulb,
  Check,
  Trophy,
  PartyPopper,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useRepertoireStore } from "@/stores/repertoireStore";
import { BOARD_THEME } from "@/design/tokens";
import * as api from "@/services/api";
import type { Lesson, LearnMove } from "@/services/api";

type Square = BoardSquare;

interface LearnScreenProps {
  onBack: () => void;
}

type Phase =
  | "loading"
  | "empty"
  | "watch"
  | "guided"
  | "blind"
  | "blind-failed"
  | "success"
  | "error";

/** Sub-step within the WATCH stage's per-move cadence. */
type WatchSub = "pre" | "caption";

/** Resolve the {from,to} squares chess.js used to play `san` from `fen`. */
function sanMoveSquares(fen: string, san: string): { from: Square; to: Square } | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    if (!move) return null;
    return { from: move.from as Square, to: move.to as Square };
  } catch {
    return null;
  }
}

/** Apply `san` to `fen` and return the resulting FEN, or null if illegal. */
function computeFenAfter(fen: string, san: string): string | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    if (!move) return null;
    return chess.fen();
  } catch {
    return null;
  }
}

/** The FEN reached after playing moves[idx]. Uses the next move's stored
 * "before" FEN when available (cheap lookup); only replays through chess.js
 * for the final move in the line, which has no successor to borrow from. */
function fenAfterStep(moves: LearnMove[], idx: number): string | null {
  const next = moves[idx + 1];
  if (next) return next.fen;
  const move = moves[idx];
  return computeFenAfter(move.fen, move.san);
}

function stageForLessonStage(stage: number): Phase {
  if (stage <= 0) return "watch";
  if (stage === 1) return "guided";
  return "blind"; // stage 2 (about to learn blind) and stage 3 (refresh) both drill blind
}

const STAGE_LABELS: { key: "watch" | "guided" | "blind"; label: string }[] = [
  { key: "watch", label: "Watch" },
  { key: "guided", label: "Guided" },
  { key: "blind", label: "Blind" },
];

export const LearnScreen: React.FC<LearnScreenProps> = ({ onBack }) => {
  const repertoireId = useRepertoireStore((s) => s.repertoireId);
  const repertoireSide = useRepertoireStore((s) => s.repertoireSide);

  const [phase, setPhase] = useState<Phase>("loading");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [totals, setTotals] = useState<{ lines: number; learned: number; quarantined: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Shared board/step state across watch/guided/blind. `stepIdx` is the index
  // of the move in lesson.moves that has not yet been fully applied.
  const [fen, setFen] = useState<string>("");
  const [stepIdx, setStepIdx] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [missCount, setMissCount] = useState(0);
  const [hintShown, setHintShown] = useState(false);
  const [lastKevinSquares, setLastKevinSquares] = useState<{ from: Square; to: Square } | null>(null);

  // Watch-stage state
  const [watchSub, setWatchSub] = useState<WatchSub>("pre");
  const [watchPaused, setWatchPaused] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);

  // Success-stage result
  const [promoted, setPromoted] = useState(0);

  // Every setTimeout used by this screen is tracked here so a restart, phase
  // change, or unmount can cancel it — otherwise a stale timer fires against
  // a board that has already moved on (see RepertoireRunScreen precedent).
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (autoRevealTimerRef.current) {
      clearTimeout(autoRevealTimerRef.current);
      autoRevealTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const resetStepState = useCallback((startFen: string) => {
    setFen(startFen);
    setStepIdx(0);
    setMissCount(0);
    setHintShown(false);
    setLastKevinSquares(null);
    setWatchSub("pre");
    setWatchPaused(false);
    setCaption(null);
  }, []);

  const loadLesson = useCallback(async () => {
    clearTimers();
    setPhase("loading");
    setErrorMsg(null);
    try {
      const result = await api.getNextLesson(repertoireId);
      setTotals(result.totals);
      if (!result.lesson) {
        setLesson(null);
        setPhase("empty");
        return;
      }
      setLesson(result.lesson);
      resetStepState(result.lesson.moves[0]?.fen ?? "");
      setPhase(stageForLessonStage(result.lesson.stage));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to load lesson");
      setPhase("error");
    }
  }, [repertoireId, clearTimers, resetStepState]);

  useEffect(() => {
    if (repertoireId) loadLesson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repertoireId]);

  const boardOrientation = repertoireSide;
  const moves = React.useMemo(() => lesson?.moves ?? [], [lesson]);
  const currentMove = moves[stepIdx];

  // --- WATCH stage: auto-play the line ---
  useEffect(() => {
    if (phase !== "watch" || !lesson) return;
    if (watchPaused) return;

    if (stepIdx >= moves.length) {
      // Line finished — mark watch complete and hand off to guided.
      (async () => {
        try {
          await api.completeLesson(repertoireId, lesson.lineKey, 1, true);
        } catch {
          // Non-fatal — the ladder can still progress client-side this session.
        }
        resetStepState(moves[0]?.fen ?? "");
        setPhase("guided");
      })();
      return;
    }

    const move = moves[stepIdx];

    if (watchSub === "pre") {
      const t = setTimeout(() => {
        const squares = sanMoveSquares(move.fen, move.san);
        const nextFen = fenAfterStep(moves, stepIdx);
        if (nextFen) setFen(nextFen);
        setLastKevinSquares(move.isKevinMove ? squares : null);
        if (move.comment) {
          setCaption(move.comment);
          setWatchSub("caption");
        } else {
          setStepIdx((i) => i + 1);
        }
      }, 1200);
      timerRef.current = t;
      return () => clearTimeout(t);
    }

    // watchSub === "caption": hold on the comment before continuing.
    const t = setTimeout(() => {
      setCaption(null);
      setWatchSub("pre");
      setStepIdx((i) => i + 1);
    }, 2500);
    timerRef.current = t;
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepIdx, watchSub, watchPaused, lesson]);

  // --- GUIDED / BLIND stages: opponent auto-reply ---
  useEffect(() => {
    if ((phase !== "guided" && phase !== "blind") || !lesson) return;

    if (stepIdx >= moves.length) {
      const targetStage = phase === "guided" ? 2 : 3;
      (async () => {
        try {
          const res = await api.completeLesson(repertoireId, lesson.lineKey, targetStage as 1 | 2 | 3, true);
          if (phase === "guided") {
            resetStepState(moves[0]?.fen ?? "");
            setPhase("blind");
          } else {
            setPromoted(res.promoted);
            setPhase("success");
          }
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : "Failed to save progress");
          setPhase("error");
        }
      })();
      return;
    }

    const move = moves[stepIdx];
    if (move.isKevinMove) return; // wait for the drag drop below

    const t = setTimeout(() => {
      const nextFen = fenAfterStep(moves, stepIdx);
      if (nextFen) setFen(nextFen);
      setLastKevinSquares(null); // opponent moves get no highlight
      setStepIdx((i) => i + 1);
      setMissCount(0);
      setHintShown(false);
    }, 500);
    timerRef.current = t;
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepIdx, lesson]);

  const handleDrop = useCallback(
    (source: string, target: string) => {
      if ((phase !== "guided" && phase !== "blind") || !lesson) return false;
      if (!currentMove || !currentMove.isKevinMove) return false;
      if (autoRevealTimerRef.current) return false; // an auto-reveal is already pending

      let chess: Chess;
      let move;
      try {
        chess = new Chess(fen);
        move = chess.move({ from: source, to: target, promotion: "q" });
      } catch {
        return false;
      }
      if (!move) return false;

      const expected = sanMoveSquares(currentMove.fen, currentMove.san);
      const correct = expected && move.from === expected.from && move.to === expected.to;

      if (correct) {
        const nextFen = fenAfterStep(moves, stepIdx);
        if (nextFen) setFen(nextFen);
        setLastKevinSquares(expected);
        setStepIdx((i) => i + 1);
        setMissCount(0);
        setHintShown(false);
        return true;
      }

      setShaking(true);
      setTimeout(() => setShaking(false), 500);

      if (phase === "blind") {
        clearTimers();
        setPhase("blind-failed");
        return false;
      }

      // Guided: two misses trigger an auto-played correction.
      const nextMissCount = missCount + 1;
      setMissCount(nextMissCount);
      if (nextMissCount >= 2) {
        // Pin the move/index this reveal belongs to — stepIdx may have moved
        // on by the time the timer fires (it won't here, since the board is
        // frozen via `draggable`, but this keeps the pattern consistent with
        // RepertoireRunScreen's reveal-pinning discipline).
        const pinnedIdx = stepIdx;
        autoRevealTimerRef.current = setTimeout(() => {
          autoRevealTimerRef.current = null;
          const squares = sanMoveSquares(currentMove.fen, currentMove.san);
          const nextFen = fenAfterStep(moves, pinnedIdx);
          if (nextFen) setFen(nextFen);
          setLastKevinSquares(squares);
          setStepIdx(pinnedIdx + 1);
          setMissCount(0);
          setHintShown(false);
        }, 900);
      }
      return false;
    },
    [phase, lesson, currentMove, fen, stepIdx, moves, missCount, clearTimers],
  );

  function handleWatchTogglePause() {
    setWatchPaused((p) => !p);
  }

  function handleWatchRestart() {
    clearTimers();
    resetStepState(moves[0]?.fen ?? "");
    setPhase("watch");
  }

  async function handleSkipToGuided() {
    if (!lesson) return;
    clearTimers();
    try {
      await api.completeLesson(repertoireId, lesson.lineKey, 1, true);
    } catch {
      // Non-fatal
    }
    resetStepState(moves[0]?.fen ?? "");
    setPhase("guided");
  }

  function handleBlindRetry() {
    clearTimers();
    resetStepState(moves[0]?.fen ?? "");
    setPhase("blind");
  }

  async function handleNextLesson() {
    await loadLesson();
  }

  const isKevinTurn = !!currentMove?.isKevinMove;
  const draggable =
    (phase === "guided" || phase === "blind") && isKevinTurn && !autoRevealTimerRef.current;

  const hintArrow =
    phase === "guided" && hintShown && currentMove
      ? sanMoveSquares(currentMove.fen, currentMove.san)
      : null;

  const squareStyles = lastKevinSquares
    ? {
        [lastKevinSquares.from]: { backgroundColor: "rgba(52,211,153,0.35)" },
        [lastKevinSquares.to]: { backgroundColor: "rgba(52,211,153,0.35)" },
      }
    : undefined;

  return (
    <div className="flex-1 flex flex-col bg-forge-base overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-forge-surface border-b border-forge-border-subtle shrink-0">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-xl text-slate-400 hover:text-white transition-all active:scale-95"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-black text-slate-200 uppercase tracking-wider truncate">
            {lesson?.chapterName ?? "Learn"}
          </h2>
          {lesson && (
            <p className="text-[10px] text-slate-500 font-semibold truncate">
              {lesson.moves.slice(0, 3).map((m) => m.san).join(" ")}
              {lesson.moves.length > 3 ? "…" : ""}
            </p>
          )}
        </div>
      </div>

      {(phase === "watch" || phase === "guided" || phase === "blind" || phase === "blind-failed") &&
        lesson && (
          <div className="px-4 py-3 bg-forge-surface border-b border-forge-border-subtle shrink-0">
            <div className="flex items-center justify-center gap-2">
              {STAGE_LABELS.map((s, i) => {
                const active =
                  s.key === "watch" || s.key === "guided" || s.key === "blind"
                    ? (phase === "blind-failed" ? "blind" : phase) === s.key
                    : false;
                return (
                  <React.Fragment key={s.key}>
                    {i > 0 && <div className="w-4 h-px bg-forge-border-default" />}
                    <span
                      className={cn(
                        "text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-forge-sm",
                        active
                          ? "text-white bg-indigo-600"
                          : "text-slate-500 bg-forge-card",
                      )}
                    >
                      {s.label}
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-3 mt-2 text-[10px] text-slate-500 font-semibold">
              {lesson.frequency > 0 && <span>Seen in your games {lesson.frequency}×</span>}
              <span>~{lesson.estMinutes} min</span>
            </div>
          </div>
        )}

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {phase === "loading" && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Loading…</p>
          </div>
        )}

        {phase === "error" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <p className="text-xs text-rose-400 font-semibold text-center">{errorMsg}</p>
            <button
              onClick={loadLesson}
              className="px-4 py-2 rounded-forge-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-widest transition-all active:scale-95"
            >
              Retry
            </button>
          </div>
        )}

        {phase === "empty" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="w-20 h-20 rounded-[2rem] border-2 flex items-center justify-center bg-emerald-400/10 border-emerald-400/30">
              <PartyPopper size={36} className="text-emerald-400" />
            </div>
            <p className="text-sm font-black uppercase tracking-wider text-emerald-400">
              All lines learned
            </p>
            {totals && (
              <p className="text-xs text-slate-500">
                {totals.learned} of {totals.lines} lines mastered
                {totals.quarantined > 0 ? ` · ${totals.quarantined} flagged` : ""}
              </p>
            )}
            <button
              onClick={onBack}
              className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-black uppercase tracking-widest transition-all active:scale-95"
            >
              Done
            </button>
          </div>
        )}

        {phase === "blind-failed" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="w-20 h-20 rounded-[2rem] border-2 flex items-center justify-center bg-rose-400/10 border-rose-400/30">
              <RotateCcw size={32} className="text-rose-400" />
            </div>
            <p className="text-sm font-black uppercase tracking-wider text-rose-400">
              Line broken — again?
            </p>
            <button
              onClick={handleBlindRetry}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-black uppercase tracking-widest transition-all active:scale-95"
            >
              <RotateCcw size={16} />
              Retry blind
            </button>
          </div>
        )}

        {phase === "success" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="w-20 h-20 rounded-[2rem] border-2 flex items-center justify-center bg-emerald-400/10 border-emerald-400/30">
              <Trophy size={36} className="text-emerald-400" />
            </div>
            <p className="text-sm font-black uppercase tracking-wider text-emerald-400">
              Line learned
            </p>
            <p className="text-xs text-slate-500">
              {promoted > 0
                ? `${promoted} position${promoted === 1 ? "" : "s"} promoted to your drill rotation.`
                : "This line is holding steady."}
            </p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <button
                onClick={handleNextLesson}
                className="w-full py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white font-black text-sm uppercase tracking-widest shadow-xl shadow-indigo-600/30 border border-indigo-400/20 transition-all"
              >
                Next lesson
              </button>
              <button
                onClick={onBack}
                className="w-full py-3 rounded-2xl bg-forge-card border border-forge-border-subtle text-slate-300 font-black text-sm uppercase tracking-widest transition-all active:scale-95"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {(phase === "watch" || phase === "guided" || phase === "blind") && lesson && (
          <>
            {/* Board */}
            <div
              className={cn(
                "flex-1 flex items-center justify-center p-4 relative",
                shaking && "animate-shake",
              )}
            >
              <div className="w-full aspect-square rounded-xl overflow-hidden shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] bg-forge-board p-[6px]">
                <div className="w-full h-full rounded-lg overflow-hidden">
                  <Chessboard
                    position={fen}
                    onPieceDrop={draggable ? handleDrop : () => false}
                    boardOrientation={boardOrientation}
                    animationDuration={phase === "watch" ? 400 : 200}
                    arePiecesDraggable={draggable}
                    customSquareStyles={squareStyles}
                    customArrows={
                      hintArrow
                        ? ([[hintArrow.from, hintArrow.to, "#4f46e5"]] as BoardArrow[])
                        : []
                    }
                    {...BOARD_THEME}
                  />
                </div>
              </div>
            </div>

            {/* Caption / status bar */}
            <div className="px-6 py-3 bg-forge-surface border-t border-forge-border-subtle shrink-0">
              {phase === "watch" && caption && (
                <div className="mb-2 px-3 py-2 rounded-forge-md bg-forge-card border border-forge-border-subtle text-xs text-slate-300 italic">
                  {caption}
                </div>
              )}
              <div className="flex items-center justify-between">
                {phase === "watch" ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleWatchTogglePause}
                      className="p-2 rounded-xl text-slate-400 hover:text-white transition-all active:scale-95"
                    >
                      {watchPaused ? <Play size={16} /> : <Pause size={16} />}
                    </button>
                    <button
                      onClick={handleWatchRestart}
                      className="p-2 rounded-xl text-slate-400 hover:text-white transition-all active:scale-95"
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button
                      onClick={handleSkipToGuided}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-all"
                    >
                      Skip to guided
                      <ChevronsRight size={14} />
                    </button>
                  </div>
                ) : isKevinTurn ? (
                  missCount > 0 ? (
                    <p className="text-xs text-rose-400 font-semibold">Not quite — try again</p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {repertoireSide === "white" ? "Play White's move" : "Play Black's move"}
                    </p>
                  )
                ) : (
                  <p className="text-xs text-slate-500 italic">Opponent replying…</p>
                )}

                {phase === "guided" && isKevinTurn && (
                  <button
                    onClick={() => setHintShown((h) => !h)}
                    className={cn(
                      "flex items-center gap-1.5 text-xs font-semibold transition-all ml-auto",
                      hintShown ? "text-indigo-400" : "text-slate-500 hover:text-slate-300",
                    )}
                  >
                    <Lightbulb size={14} />
                    Hint
                  </button>
                )}
                {phase === "blind" && isKevinTurn && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-600 ml-auto">
                    <Check size={12} />
                    No hints
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
