import React, { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  ArrowLeft,
  Check,
  X,
  Eye,
  Loader2,
  Timer,
  RotateCcw,
  Swords,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useRepertoireStore } from "@/stores/repertoireStore";
import { fetchTrainNowSession, recordAttempt as apiRecordAttempt } from "@/services/api";
import type { AttemptRecord } from "@/services/api";
import { normalizeFen } from "@/utils/normalizeFen";
import { BOARD_THEME } from "@/design/tokens";
import { looseSan } from "@/utils/san";
import { BlunderExplanation } from "./BlunderExplanation";
import { useSound } from "@/hooks/useSound";
import { useCoachBoard } from "./useCoachBoard";
import { StockfishEngine } from "@/services/engine";
import { useEngineStore } from "@/stores/engineStore";
import { type TrainingMode, type PhaseFilter } from "./HomeScreen";
import { useDrillSession, type TrainPosition, type TacticalPattern } from "./useDrillSession";

/** Human-readable label + colour for each tactical pattern. */
const PATTERN_META: Record<TacticalPattern, { label: string; className: string }> = {
  "back-rank": { label: "Back Rank", className: "bg-rose-500/15 text-rose-400 border-rose-500/25" },
  "fork":       { label: "Fork",      className: "bg-amber-500/15 text-amber-400 border-amber-500/25" },
  "pin":        { label: "Pin",        className: "bg-violet-500/15 text-violet-400 border-violet-500/25" },
  "discovered-attack": { label: "Discovery", className: "bg-orange-500/15 text-orange-400 border-orange-500/25" },
  "promotion":  { label: "Promotion", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  "endgame":    { label: "Endgame",   className: "bg-sky-500/15 text-sky-400 border-sky-500/25" },
  "opening":    { label: "Opening",   className: "bg-indigo-500/15 text-indigo-400 border-indigo-500/25" },
  "middlegame": { label: "Middlegame", className: "bg-slate-500/15 text-slate-400 border-slate-500/25" },
  "other":      { label: "Tactics",   className: "bg-slate-500/15 text-slate-400 border-slate-500/25" },
};

function PatternBadge({ pattern, className }: { pattern?: TacticalPattern; className?: string }) {
  if (!pattern || pattern === "other" || pattern === "middlegame") return null;
  const meta = PATTERN_META[pattern];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full border",
        "text-[9px] font-black uppercase tracking-wider",
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

function getTimerDuration(source?: string): number {
  return source === "blunder" ? 25 : 15;
}

function timerColor(fraction: number): string {
  if (fraction <= 0.25) return "#f43f5e"; // rose-500
  if (fraction <= 0.5) return "#f59e0b"; // amber-500
  return "#6366f1"; // indigo-500
}

interface CountdownRingProps {
  remaining: number;
  total: number;
}

const CountdownRing: React.FC<CountdownRingProps> = ({ remaining, total }) => {
  const size = 44;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? remaining / total : 0;
  const offset = circumference * (1 - fraction);
  const color = timerColor(fraction);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="white"
          strokeOpacity={0.07}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.3s linear, stroke 0.3s" }}
        />
      </svg>
      <span
        className="absolute text-[11px] font-black tabular-nums"
        style={{ color }}
      >
        {Math.ceil(remaining)}
      </span>
    </div>
  );
};

interface TrainNowScreenProps {
  onBack: () => void;
  singlePositionFen?: string;
  mode?: TrainingMode;
  phase?: PhaseFilter;
}

export const TrainNowScreen: React.FC<TrainNowScreenProps> = ({
  onBack,
  singlePositionFen,
  mode,
  phase,
}) => {
  const repertoireId = useRepertoireStore((s) => s.repertoireId);
  const { playSound } = useSound();
  const {
    coachArrows,
    coachSquareStyles,
    coachFen,
    isCoachAnimating,
    triggerReveal,
    triggerCoachLine,
    clearCoach,
    replayCoach,
    beatReset,
    beatPlayMove,
    beatHighlight,
    beatArrow,
  } = useCoachBoard();

  // The 11 session-state vars live in a single useReducer-backed hook so
  // every transition is atomic (a wrong-move dispatch can't leave shaking,
  // mistakes, and wrongMove in inconsistent intermediate renders).
  const [drill, dispatch] = useDrillSession();
  const {
    state,
    positions,
    currentIdx,
    fen,
    mistakes,
    wrongMove,
    revealed,
    shaking,
    stats,
    revealedPositions,
    teachingCount,
  } = drill;
  const MAX_TEACHING_PER_SESSION = 2;

  // Click-to-move (tap-to-move for mobile)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [moveSquares, setMoveSquares] = useState<Record<string, React.CSSProperties>>({});

  // Opponent punishment line — for deviation drills only
  const [punishmentSan, setPunishmentSan] = useState<string | null>(null);
  const [punishmentLoading, setPunishmentLoading] = useState(false);
  const [punishmentDismissed, setPunishmentDismissed] = useState(false);
  const [punishmentAnimated, setPunishmentAnimated] = useState(false);
  // Engine ref for punishment — shares the global engine to avoid spawning extra workers
  const punishEngineRef = useRef<StockfishEngine | null>(null);
  const ownsPunishEngineRef = useRef(false);

  // Speed mode
  const [speedMode, setSpeedMode] = useState(false);
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [timerTotal, setTimerTotal] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const positionStartRef = useRef<number>(0);
  const responseTimes = useRef<number[]>([]);

  const chessRef = useRef(new Chess());
  const currentPosition = positions[currentIdx] ?? null;

  // Board orientation follows the side the user is drilling — derived from the
  // position's ORIGINAL FEN (whose turn it is at the start of the drill), not
  // the live `fen`. The live `fen` flips after a correct move (opponent to
  // move on the post-move position), which would visually rotate the board
  // mid-drill. Lock it to the position's perspective for the whole step.
  const boardOrientation =
    ((currentPosition?.fen ?? fen).split(" ")[1] ?? "w") === "w"
      ? "white"
      : "black";

  // Fire coach reveal animation on teaching state entry
  useEffect(() => {
    if (state === "teaching" && currentPosition) {
      const t = setTimeout(() => {
        triggerReveal(
          currentPosition.fen,
          currentPosition.san ?? null,
          currentPosition.correctSan,
        );
      }, 400);
      return () => clearTimeout(t);
    }
    if (
      state === "idle" ||
      state === "drilling" ||
      state === "queued" ||
      state === "complete"
    ) {
      clearCoach();
    }
  }, [state, currentIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // When entering explanation for a deviation drill, fetch the opponent punishment move.
  // We compute the post-deviation FEN (position after Kevin's deviation san) and ask
  // the engine for its best reply — that's what the opponent "could have punished with".
  useEffect(() => {
    if (state !== "explanation" || !currentPosition || currentPosition.source !== "deviation") {
      // Reset punishment state whenever we leave explanation or change position
      setPunishmentSan(null);
      setPunishmentLoading(false);
      setPunishmentDismissed(false);
      setPunishmentAnimated(false);
      return;
    }

    // Need the deviation san (the move Kevin played in the game) to compute post-deviation FEN
    const deviationSan = currentPosition.san;
    if (!deviationSan) {
      // No recorded deviation move — can't show punishment
      return;
    }

    let cancelled = false;
    async function fetchPunishment() {
      setPunishmentLoading(true);
      try {
        // Compute the FEN after Kevin's deviation
        const chess = new Chess(currentPosition!.fen);
        chess.move(deviationSan!);
        const postDeviationFen = chess.fen();

        // Get the shared engine (prefer the global one to avoid extra workers)
        if (!punishEngineRef.current) {
          const shared = useEngineStore.getState().engine;
          if (shared) {
            punishEngineRef.current = shared;
            ownsPunishEngineRef.current = false;
          } else {
            punishEngineRef.current = new StockfishEngine();
            ownsPunishEngineRef.current = true;
          }
          await punishEngineRef.current.waitUntilReady();
        }

        // Shallow search — depth 12 is fast on mobile and sufficient for 1-move punishment
        const result = await punishEngineRef.current.evaluateOnce(postDeviationFen, 12);
        if (cancelled) return;

        if (result.bestMove && result.bestMove.length >= 4) {
          // Convert UCI to SAN
          const c2 = new Chess(postDeviationFen);
          const move = c2.move({
            from: result.bestMove.slice(0, 2),
            to: result.bestMove.slice(2, 4),
            promotion: result.bestMove[4] ?? "q",
          });
          if (move && !cancelled) {
            setPunishmentSan(move.san);
          }
        }
      } catch {
        // Engine unavailable — silently skip punishment banner
      } finally {
        if (!cancelled) setPunishmentLoading(false);
      }
    }

    fetchPunishment();
    return () => {
      cancelled = true;
    };
  }, [state, currentIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup punishment engine on unmount if we own it
  useEffect(() => {
    return () => {
      if (ownsPunishEngineRef.current) {
        punishEngineRef.current?.quit();
      }
    };
  }, []);

  useEffect(() => {
    if (singlePositionFen) {
      loadSinglePosition(singlePositionFen);
    } else {
      loadSession();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function loadSinglePosition(fenRaw: string) {
    const nfen = normalizeFen(fenRaw);
    const moves = useRepertoireStore.getState().positions[nfen];
    if (!moves || moves.length === 0) {
      dispatch({ type: "LOAD_EMPTY" });
      return;
    }
    const pos: TrainPosition = {
      id: `single-${nfen}`,
      fen: fenRaw,
      correctSan: moves[0].san,
      source: "deviation",
    };
    dispatch({ type: "LOAD_SINGLE", pos });
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function loadSession() {
    dispatch({ type: "LOAD_START" });
    try {
      const data = await fetchTrainNowSession(repertoireId, {
        fen: singlePositionFen,
        mode,
        phase,
      });
      if (data.positions.length === 0) {
        dispatch({ type: "LOAD_EMPTY" });
        return;
      }
      dispatch({ type: "LOAD_SUCCESS", positions: data.positions });
    } catch {
      dispatch({ type: "LOAD_EMPTY" });
    }
  }

  function shouldTeach(pos: TrainPosition): boolean {
    return !!(pos.firstEncounter && teachingCount < MAX_TEACHING_PER_SESSION);
  }

  function startDrilling() {
    if (positions.length === 0) return;
    // Find first drillable position
    const first = positions.findIndex(
      (p) => p.correctSan && p.correctSan.trim(),
    );
    if (first === -1) {
      dispatch({ type: "COMPLETE" });
      return;
    }
    responseTimes.current = [];
    setupPosition(positions[first]);
    if (shouldTeach(positions[first])) {
      dispatch({ type: "ENTER_TEACHING", idx: first, pos: positions[first] });
    } else {
      dispatch({ type: "ENTER_DRILLING", idx: first, pos: positions[first] });
    }
  }

  const handleRevealRef = useRef<() => void>(() => {});

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function startTimer(duration: number) {
    clearTimer();
    setTimerTotal(duration);
    setTimerRemaining(duration);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, duration - elapsed);
      setTimerRemaining(left);
      if (left <= 0) {
        clearTimer();
        handleRevealRef.current();
      }
    }, 100);
  }

  function setupPosition(pos: TrainPosition) {
    // Reset board ref + UI input state. Position-scoped session state
    // (fen, mistakes, wrongMove, revealed, shaking) is reset atomically by
    // the dispatched action that drives the transition (ENTER_DRILLING /
    // ENTER_TEACHING / TEACHING_GOT_IT) — see useDrillSession reducer.
    chessRef.current = new Chess(pos.fen);
    setSelectedSquare(null);
    setMoveSquares({});
    positionStartRef.current = Date.now();
    if (speedMode) {
      startTimer(getTimerDuration(pos.source));
    }
  }

  const onDrop = useCallback(
    (source: string, target: string) => {
      if (state !== "drilling" || !currentPosition) return false;

      const chess = new Chess(fen);
      let move;
      try {
        move = chess.move({ from: source, to: target, promotion: "q" });
      } catch {
        return false;
      }
      if (!move) return false;

      // Compare by from/to squares — avoids notation mismatches (+, #, x, disambiguation)
      let isCorrect = false;
      try {
        const refChess = new Chess(currentPosition.fen);
        const refMove = refChess.move(currentPosition.correctSan);
        if (refMove) {
          isCorrect = move.from === refMove.from && move.to === refMove.to;
        }
      } catch {
        // Fallback: loose SAN comparison
        isCorrect = looseSan(move.san) === looseSan(currentPosition.correctSan);
      }

      if (isCorrect) {
        clearTimer();
        if (speedMode) {
          responseTimes.current.push(
            (Date.now() - positionStartRef.current) / 1000,
          );
        }
        // Play sound based on move type
        if (move.flags.includes("c") || move.flags.includes("e")) {
          playSound("capture");
        } else if (move.flags.includes("k") || move.flags.includes("q")) {
          playSound("move");
        } else if (chess.inCheck()) {
          playSound("check");
        } else {
          playSound("move");
        }
        const firstTry = mistakes === 0;
        recordAttempt(currentPosition.fen, true, firstTry ? 5 : 3);
        dispatch({ type: "CORRECT_MOVE", newFen: chess.fen(), firstTry });
        return true;
      }

      // Wrong move
      playSound("wrong");
      const newMistakes = mistakes + 1;

      if (newMistakes >= 2) {
        // Reveal after 2nd miss — atomic state update + delayed transition
        recordAttempt(currentPosition.fen, false, 1);
        triggerReveal(
          currentPosition.fen,
          move.san,
          currentPosition.correctSan,
        );
        dispatch({
          type: "WRONG_MOVE_REVEAL",
          san: move.san,
          pos: currentPosition,
        });
        setTimeout(() => dispatch({ type: "SHAKING_OFF" }), 500);
        setTimeout(() => dispatch({ type: "ENTER_EXPLANATION" }), 200);
      } else {
        dispatch({ type: "WRONG_MOVE", san: move.san });
        setTimeout(() => dispatch({ type: "SHAKING_OFF" }), 500);
      }

      return false;
    },
    [state, currentPosition, fen, mistakes, triggerReveal],
  );

  const onSquareClick = useCallback(
    (square: string) => {
      if (state !== "drilling" || !currentPosition) return;

      if (selectedSquare) {
        // Second tap — attempt the move
        const moved = onDrop(selectedSquare, square);
        setSelectedSquare(null);
        setMoveSquares({});
        if (moved !== false) return;
        // If move failed and clicked a new piece of same color, re-select
      }

      // First tap — select a piece and show legal moves
      const chess = new Chess(fen);
      const piece = chess.get(square as any);
      if (!piece) {
        setSelectedSquare(null);
        setMoveSquares({});
        return;
      }
      const activeSide = fen.split(" ")[1]; // 'w' or 'b'
      if (piece.color !== activeSide) return;

      const legalMoves = chess.moves({ square: square as any, verbose: true });
      const highlights: Record<string, React.CSSProperties> = {
        [square]: { background: "rgba(99,102,241,0.4)", borderRadius: "4px" },
      };
      for (const m of legalMoves) {
        highlights[m.to] = {
          background: chess.get(m.to as any)
            ? "radial-gradient(circle, rgba(239,68,68,0.5) 60%, transparent 65%)"
            : "radial-gradient(circle, rgba(99,102,241,0.35) 30%, transparent 35%)",
          borderRadius: "50%",
        };
      }
      setSelectedSquare(square);
      setMoveSquares(highlights);
    },
    [state, currentPosition, fen, selectedSquare, onDrop],
  );

  function recordAttempt(positionFen: string, correct: boolean, grade: number) {
    if (!repertoireId) return;
    const record: AttemptRecord = {
      fen: positionFen,
      correct,
      grade,
      source: currentPosition?.source,
      cpLoss: currentPosition?.cpLoss,
    };
    // Fire-and-forget — UI advances regardless of network result, and the
    // backend is idempotent for replayed attempts.
    apiRecordAttempt(repertoireId, record).catch(() => {});
  }

  function handleNext() {
    // Cancel any in-flight coach animations before moving on
    clearCoach();
    // Find next drillable position (skip any with missing correctSan)
    let nextIdx = currentIdx + 1;
    while (
      nextIdx < positions.length &&
      (!positions[nextIdx].correctSan || !positions[nextIdx].correctSan.trim())
    ) {
      nextIdx++;
    }
    if (nextIdx >= positions.length) {
      clearTimer();
      dispatch({ type: "COMPLETE" });
      return;
    }
    const nextPos = positions[nextIdx];
    setupPosition(nextPos);
    if (shouldTeach(nextPos)) {
      dispatch({ type: "ENTER_TEACHING", idx: nextIdx, pos: nextPos });
    } else {
      dispatch({ type: "ENTER_DRILLING", idx: nextIdx, pos: nextPos });
    }
  }

  function handleReveal() {
    clearTimer();
    if (speedMode) {
      responseTimes.current.push(
        (Date.now() - positionStartRef.current) / 1000,
      );
    }
    if (!currentPosition) return;
    recordAttempt(currentPosition.fen, false, 1);
    triggerReveal(currentPosition.fen, wrongMove, currentPosition.correctSan);
    dispatch({ type: "MANUAL_REVEAL", pos: currentPosition });
    setTimeout(() => dispatch({ type: "ENTER_EXPLANATION" }), 200);
  }

  function animatePunishment() {
    if (!currentPosition || !punishmentSan) return;
    setPunishmentAnimated(true);

    // Compute post-deviation FEN to start the animation from
    const deviationSan = currentPosition.san;
    if (!deviationSan) return;
    try {
      const chess = new Chess(currentPosition.fen);
      chess.move(deviationSan);
      const postDeviationFen = chess.fen();
      triggerCoachLine(postDeviationFen, [punishmentSan]);
    } catch {
      // Ignore animation errors
    }
  }

  function handleTeachingGotIt() {
    // Don't skip the position — drill it immediately after the coaching preview
    clearCoach();
    if (!currentPosition) return;
    setupPosition(currentPosition);
    dispatch({ type: "TEACHING_GOT_IT", pos: currentPosition });
  }

  // Keep ref in sync for timer callback
  handleRevealRef.current = handleReveal;

  const avgResponseTime =
    responseTimes.current.length > 0
      ? (
          responseTimes.current.reduce((a, b) => a + b, 0) /
          responseTimes.current.length
        ).toFixed(1)
      : null;

  // Estimated time: ~1.5 min per position
  const estMinutes = Math.max(1, Math.round(positions.length * 1.5));

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
        <div className="flex-1">
          <h2 className="text-sm font-black text-slate-200 uppercase tracking-wider">
            {state === "complete"
              ? "Session Complete"
              : singlePositionFen
                ? "Practice Position"
                : "Training"}
          </h2>
        </div>
        {(state === "drilling" ||
          state === "explanation" ||
          state === "teaching") &&
          positions.length > 0 && (
            <div className="flex items-center gap-1 w-32">
              <div className="flex-1 h-1.5 bg-forge-border-default rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${((currentIdx + 1) / positions.length) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                {currentIdx + 1}/{positions.length}
              </span>
            </div>
          )}
      </div>

      {/* Content area — overflow-hidden during drill so scroll offset can't misalign the drag ghost */}
      <div className={cn(
        "flex-1 flex flex-col min-h-0",
        state === "drilling" ? "overflow-hidden" : "overflow-y-auto",
      )}>
        {/* LOADING state */}
        {state === "loading" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
            <Loader2 size={32} className="text-indigo-400 animate-spin" />
            <p className="text-sm text-slate-400 font-semibold animate-pulse">
              Building your session...
            </p>
          </div>
        )}

        {/* QUEUED state */}
        {state === "queued" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 animate-fadeIn">
            <div className="text-center">
              <p className="text-3xl font-black text-slate-100">
                {positions.length} positions
              </p>
              <p className="text-sm text-slate-500 mt-1">~{estMinutes} min</p>
            </div>

            {/* Session composition breakdown */}
            {(() => {
              const blunders = positions.filter((p) => p.source === "blunder").length;
              const deviations = positions.filter((p) => p.source === "deviation").length;
              const review = positions.filter((p) => p.source === "review").length;
              const repertoire = positions.filter((p) => p.source === "repertoire").length;
              const items = [
                blunders > 0 && { label: "blunders", count: blunders, color: "text-rose-400" },
                deviations > 0 && { label: "deviations", count: deviations, color: "text-amber-400" },
                review > 0 && { label: "review", count: review, color: "text-slate-400" },
                repertoire > 0 && { label: "repertoire", count: repertoire, color: "text-indigo-400" },
              ].filter(Boolean) as { label: string; count: number; color: string }[];
              if (items.length === 0) return null;
              return (
                <div className="flex items-center gap-4">
                  {items.map((item) => (
                    <div key={item.label} className="flex flex-col items-center gap-0.5">
                      <span className={cn("text-xl font-black", item.color)}>{item.count}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{item.label}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Pattern theme clusters — show non-generic themes present in session */}
            {(() => {
              const patternCounts = new Map<TacticalPattern, number>();
              for (const p of positions) {
                if (p.pattern && p.pattern !== "other" && p.pattern !== "middlegame") {
                  patternCounts.set(p.pattern, (patternCounts.get(p.pattern) ?? 0) + 1);
                }
              }
              if (patternCounts.size === 0) return null;
              return (
                <div className="flex flex-wrap justify-center gap-2">
                  {[...patternCounts.entries()].map(([pattern, count]) => {
                    const meta = PATTERN_META[pattern];
                    return (
                      <span
                        key={pattern}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border",
                          "text-[10px] font-bold uppercase tracking-wider",
                          meta.className,
                        )}
                      >
                        {meta.label}
                        {count > 1 && <span className="opacity-70">×{count}</span>}
                      </span>
                    );
                  })}
                </div>
              );
            })()}

            {/* Speed Mode toggle */}
            <button
              onClick={() => setSpeedMode((s) => !s)}
              className={cn(
                "flex items-center gap-3 px-5 py-3 rounded-xl transition-all",
                "border",
                speedMode
                  ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300"
                  : "bg-forge-border-subtle border-forge-border-default text-slate-400",
              )}
            >
              <Timer size={18} />
              <div className="text-left">
                <p className="text-sm font-bold">Speed Mode</p>
                <p className="text-[10px] opacity-60">~15s per position</p>
              </div>
              <div
                className={cn(
                  "ml-auto w-9 h-5 rounded-full transition-all flex items-center px-0.5",
                  speedMode ? "bg-indigo-500" : "bg-forge-border-default",
                )}
              >
                <div
                  className={cn(
                    "w-4 h-4 rounded-full bg-white transition-transform",
                    speedMode ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </div>
            </button>

            <button
              onClick={startDrilling}
              className={cn(
                "w-full max-w-xs flex items-center justify-center gap-3",
                "bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]",
                "text-white font-black text-lg uppercase tracking-widest",
                "py-5 rounded-2xl transition-all",
                "shadow-xl shadow-indigo-600/30",
                "border border-indigo-400/20",
              )}
            >
              Start
            </button>
          </div>
        )}

        {/* DRILLING state */}
        {state === "drilling" && currentPosition && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Context line */}
            {currentPosition.context && (
              <p className="text-xs text-slate-500 px-4 py-2 bg-forge-surface border-b border-forge-border-subtle shrink-0">
                {currentPosition.context}
              </p>
            )}

            {/* Coach hint — shown above the board */}
            <div className="flex items-start gap-3 px-4 pt-3 pb-1 shrink-0">
              {/* Avatar */}
              <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0 text-lg select-none">
                🧙
              </div>
              {/* Speech bubble */}
              <div className="flex-1 bg-forge-card border border-forge-border-default rounded-xl rounded-tl-sm px-3 py-2 min-h-[40px] flex items-center gap-2">
                <p className="text-xs text-slate-300 leading-snug flex-1">
                  {boardOrientation === "white" ? "White" : "Black"} to move
                  {currentPosition.source === "blunder" ? " — you missed this before" : currentPosition.source === "deviation" ? " — stay in your repertoire" : ""}
                </p>
                <PatternBadge pattern={currentPosition.pattern} />
              </div>
              {speedMode && (
                <div className="shrink-0">
                  <CountdownRing
                    remaining={timerRemaining}
                    total={timerTotal}
                  />
                </div>
              )}
            </div>

            {/* Board — no transform-creating animations on this wrapper */}
            <div
              key={`board-${currentIdx}`}
              className={cn(
                "flex-1 flex items-start justify-center px-4 pt-2 pb-2 relative",
                shaking && "animate-shake",
              )}
            >
              <div className="w-full aspect-square rounded-xl overflow-hidden shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] bg-forge-board p-[6px]">
                <div className="w-full h-full rounded-lg overflow-hidden">
                  <Chessboard
                    position={coachFen ?? fen}
                    onPieceDrop={isCoachAnimating ? () => false : onDrop}
                    onSquareClick={isCoachAnimating ? undefined : onSquareClick}
                    boardOrientation={boardOrientation}
                    animationDuration={isCoachAnimating ? 700 : 150}
                    customArrows={coachArrows}
                    customSquareStyles={{ ...coachSquareStyles, ...moveSquares }}
                    {...BOARD_THEME}
                  />
                </div>
              </div>
            </div>

            {/* Bottom nav bar */}
            <div className="flex items-center justify-between px-6 py-3 bg-forge-surface border-t border-forge-border-subtle shrink-0">
              {mistakes > 0 && !revealed && (
                <div className="flex items-center gap-2 text-sm">
                  <X size={14} className="text-rose-400" />
                  <span className="text-rose-400 font-semibold">
                    {mistakes === 1 ? "Try again — 1 more attempt" : `${mistakes} misses`}
                  </span>
                </div>
              )}
              {mistakes === 0 && (
                <p className="text-xs text-slate-500">Find the best move</p>
              )}
              <button
                onClick={handleReveal}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-all ml-auto"
              >
                <Eye size={14} />
                <span className="font-semibold">Show</span>
              </button>
            </div>
          </div>
        )}

        {/* TEACHING state */}
        {state === "teaching" && currentPosition && (
          <>
            {/* Context line — same as drill/explanation. Tightened vertical
                padding (py-1) so the sub-header doesn't steal space from the
                Coach Analysis card below the board on iPhone 12 Pro Max. */}
            {currentPosition.context && (
              <p className="text-xs text-slate-500 px-4 py-1 bg-forge-surface border-b border-forge-border-subtle shrink-0">
                {currentPosition.context}
              </p>
            )}

            {/* Board (static, no interaction) — consistent size with drill/explanation */}
            <div className="px-4 pt-1 pb-0">
              <div className="w-full aspect-square rounded-xl overflow-hidden shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] bg-forge-board p-[6px]">
                <div className="w-full h-full rounded-lg overflow-hidden">
                  <Chessboard
                    position={coachFen ?? fen}
                    boardOrientation={boardOrientation}
                    arePiecesDraggable={false}
                    animationDuration={isCoachAnimating ? 500 : 0}
                    customArrows={coachArrows}
                    customSquareStyles={coachSquareStyles}
                    {...BOARD_THEME}
                  />
                </div>
              </div>
            </div>

            {/* "New Position" / "You played X, but Y was better" banner removed —
                redundant with the PLAYED → BEST chip row and Coach Analysis text
                inside BlunderExplanation immediately below.
                Tightened wrapper padding (pt-0 pb-2, px-4) so the WHY card
                hugs the board on iPhone 12 Pro Max — every removed pixel here
                surfaces another line of Coach Analysis above the fold. */}
            <div className="animate-slideUp px-4 pt-0 pb-2">
              <BlunderExplanation
                fen={currentPosition.fen}
                wrongMove={currentPosition.san ?? null}
                correctMove={currentPosition.correctSan}
                cpLoss={currentPosition.cpLoss ?? null}
                phase={currentPosition.phase}
                revealed={true}
                mistakeContext="original"
                onNext={handleTeachingGotIt}
                nextLabel="Got it"
                onReplay={replayCoach}
                onClose={() => {
                  clearCoach();
                  handleTeachingGotIt();
                }}
                repertoireId={repertoireId ?? undefined}
                onDismiss={handleNext}
                coachCallbacks={{
                  onResetBoard: () => beatReset(currentPosition.fen),
                  onPlayMove: (san, hl) =>
                    beatPlayMove(currentPosition.fen, san, hl),
                  onHighlight: (squares, color) => beatHighlight(squares, color),
                  onArrow: (from, to, color) => beatArrow(from, to, color),
                }}
              />
            </div>
          </>
        )}

        {/* EXPLANATION state */}
        {state === "explanation" && currentPosition && (
          <>
            {/* Context line — keep game context visible in explanation.
                Tight py-1 to leave more room for the Coach Analysis card. */}
            {currentPosition.context && (
              <p className="text-xs text-slate-500 px-4 py-1 bg-forge-surface border-b border-forge-border-subtle shrink-0">
                {currentPosition.context}
              </p>
            )}

            {/* Board (static) — consistent size with drill state */}
            <div className="px-4 pt-1 pb-0">
              <div className="w-full aspect-square rounded-xl overflow-hidden shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] bg-forge-board p-[6px]">
                <div className="w-full h-full rounded-lg overflow-hidden">
                  <Chessboard
                    position={coachFen ?? fen}
                    boardOrientation={boardOrientation}
                    arePiecesDraggable={false}
                    animationDuration={isCoachAnimating ? 500 : 0}
                    customArrows={coachArrows}
                    customSquareStyles={coachSquareStyles}
                    {...BOARD_THEME}
                  />
                </div>
              </div>
            </div>

            {/* Correct indicator (only when first-try correct — "Best move" is now
                shown by the green BEST chip inside BlunderExplanation, so we no
                longer render a redundant amber line here on reveal). */}
            {!revealed && (
              <div className="flex items-center gap-2 px-6 pt-1.5 pb-0 text-emerald-400">
                <Check size={18} />
                <span className="text-sm font-black uppercase tracking-wider">
                  Correct
                </span>
              </div>
            )}

            <div className="animate-slideUp">
              <BlunderExplanation
                fen={currentPosition.fen}
                /* IMPORTANT: pass the ORIGINAL game blunder
                   (currentPosition.san), not the per-attempt drill miss
                   (drill.wrongMove). The walkthrough explains the original
                   mistake the position was queued for; the drill attempt is
                   only surfaced in the chip row above as "PLAYED →
                   BEST". */
                wrongMove={currentPosition.san ?? wrongMove}
                correctMove={currentPosition.correctSan}
                cpLoss={currentPosition.cpLoss ?? null}
                phase={currentPosition.phase}
                revealed={revealed}
                mistakeContext="drill"
                onNext={handleNext}
                onReplay={replayCoach}
                onClose={() => {
                  clearCoach();
                  handleNext();
                }}
                repertoireId={repertoireId ?? undefined}
                onDismiss={handleNext}
                coachCallbacks={{
                  onResetBoard: () => beatReset(currentPosition.fen),
                  onPlayMove: (san, hl) =>
                    beatPlayMove(currentPosition.fen, san, hl),
                  onHighlight: (squares, color) => beatHighlight(squares, color),
                  onArrow: (from, to, color) => beatArrow(from, to, color),
                }}
              />
            </div>

            {/* Punishment banner — deviation drills only. Shows the opponent's
                best reply to Kevin's deviation so he understands why the
                repertoire move matters. Dismissible; animates the punishment
                move on the board via triggerCoachLine. */}
            {currentPosition.source === "deviation" && !punishmentDismissed && (
              <div className="px-4 pb-4 animate-slideUp">
                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Swords size={14} className="text-amber-400 shrink-0" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-400 flex-1">
                      Opponent could punish
                    </span>
                    <button
                      onClick={() => {
                        clearCoach();
                        setPunishmentDismissed(true);
                      }}
                      className="p-1 rounded-lg text-slate-600 hover:text-slate-400 transition-all active:scale-90"
                      aria-label="Dismiss punishment line"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {punishmentLoading && (
                    <div className="flex items-center gap-2 text-slate-500 text-xs">
                      <Loader2 size={12} className="animate-spin shrink-0" />
                      <span>Finding punishment line...</span>
                    </div>
                  )}

                  {!punishmentLoading && punishmentSan && (
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono font-black text-amber-300">
                        {punishmentSan}
                      </span>
                      <span className="text-xs text-slate-500 flex-1">
                        After your deviation, the opponent could play this
                      </span>
                      <button
                        onClick={animatePunishment}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95",
                          punishmentAnimated
                            ? "bg-forge-border-subtle border border-forge-border-default text-slate-400 hover:text-slate-200 hover:bg-forge-border-default"
                            : "bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30",
                        )}
                      >
                        {punishmentAnimated ? (
                          <>
                            <RotateCcw size={12} />
                            Replay
                          </>
                        ) : (
                          "Show"
                        )}
                      </button>
                    </div>
                  )}

                  {!punishmentLoading && !punishmentSan && (
                    <p className="text-xs text-slate-500">
                      Engine unavailable — keep your repertoire moves sharp anyway.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* COMPLETE state */}
        {state === "complete" && (
          <div className="flex-1 flex flex-col items-center gap-6 px-6 pt-8 pb-24 overflow-y-auto">
            {stats.total === 0 ? (
              <>
                <p className="text-xl font-black text-slate-300 mt-8">
                  Nothing to train
                </p>
                <p className="text-sm text-slate-500 text-center">
                  Import some games or wait for positions to become due.
                </p>
              </>
            ) : (
              <>
                {/* Grade + accuracy */}
                {(() => {
                  const acc = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
                  const grade =
                    acc >= 90 ? { letter: "S", color: "text-yellow-400", bg: "bg-yellow-400/10 border-yellow-400/30", msg: "Exceptional" }
                    : acc >= 75 ? { letter: "A", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30", msg: "Strong session" }
                    : acc >= 60 ? { letter: "B", color: "text-indigo-400", bg: "bg-indigo-400/10 border-indigo-400/30", msg: "Good progress" }
                    : acc >= 40 ? { letter: "C", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/30", msg: "Keep drilling" }
                    :             { letter: "D", color: "text-rose-400",   bg: "bg-rose-400/10 border-rose-400/30",   msg: "Tough session — review the mistakes" };
                  return (
                    <div className="flex flex-col items-center gap-3">
                      <div className={cn("w-20 h-20 rounded-[2rem] border-2 flex items-center justify-center", grade.bg)}>
                        <span className={cn("text-5xl font-black", grade.color)}>{grade.letter}</span>
                      </div>
                      <p className={cn("text-sm font-black uppercase tracking-wider", grade.color)}>
                        {grade.msg}
                      </p>
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                        <span className="font-black text-slate-200">{acc}%</span>
                        <span>accuracy</span>
                        {avgResponseTime && (
                          <>
                            <span className="text-slate-700">·</span>
                            <span className="text-indigo-400 font-semibold">{avgResponseTime}s avg</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-3 gap-4 text-center w-full">
                  <div className="bg-forge-card border border-forge-border-subtle rounded-2xl py-4">
                    <p className="text-2xl font-black text-slate-200">{stats.total}</p>
                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">drilled</p>
                  </div>
                  <div className="bg-forge-card border border-forge-border-subtle rounded-2xl py-4">
                    <p className="text-2xl font-black text-emerald-400">{stats.correct}</p>
                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">correct</p>
                  </div>
                  <div className="bg-forge-card border border-forge-border-subtle rounded-2xl py-4">
                    <p className="text-2xl font-black text-amber-400">{stats.revealed}</p>
                    <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">revealed</p>
                  </div>
                </div>

                {/* Mistakes replay */}
                {revealedPositions.length > 0 && (
                  <div className="w-full mt-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 text-center">
                      Mistakes
                    </p>
                    <div className="flex flex-wrap justify-center gap-3">
                      {revealedPositions.map((pos, i) => {
                        const sourceBadge =
                          pos.source === "blunder"
                            ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                            : pos.source === "deviation"
                              ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                              : "bg-slate-500/15 text-slate-400 border-slate-500/30";
                        return (
                          <div
                            key={`${pos.fen}-${i}`}
                            className="flex flex-col items-center gap-1.5"
                          >
                            <div className="w-[120px] aspect-square rounded-lg overflow-hidden border-2 border-forge-board">
                              <Chessboard
                                position={pos.fen}
                                arePiecesDraggable={false}
                                boardWidth={120}
                                animationDuration={0}
                                {...BOARD_THEME}
                              />
                            </div>
                            <span className="text-xs font-black text-amber-400">
                              {pos.correctSan}
                            </span>
                            <span
                              className={cn(
                                "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                                sourceBadge,
                              )}
                            >
                              {pos.source ?? "review"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex flex-col items-center gap-3 w-full max-w-xs">
              <button
                onClick={loadSession}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-4 rounded-2xl",
                  "bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]",
                  "text-white font-black text-base uppercase tracking-widest",
                  "shadow-xl shadow-indigo-600/30 border border-indigo-400/20",
                  "transition-all",
                )}
              >
                <RotateCcw size={16} />
                Drill Again
              </button>
              <button
                onClick={onBack}
                className={cn(
                  "w-full px-8 py-3 rounded-xl",
                  "bg-forge-border-subtle border border-forge-border-default",
                  "text-slate-400 font-semibold text-sm",
                  "hover:bg-forge-border-default transition-all active:scale-[0.98]",
                )}
              >
                Back to Home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
