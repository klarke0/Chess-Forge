import React, { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { ArrowLeft, Check, X, RotateCcw } from "lucide-react";
import { cn } from "@/utils/cn";
import { useRepertoireStore } from "@/stores/repertoireStore";
import { normalizeFen } from "@/utils/normalizeFen";
import { BOARD_THEME } from "@/design/tokens";
import { looseSan } from "@/utils/san";
import { useSound } from "@/hooks/useSound";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Pick one item at random from an array. Returns undefined if array is empty. */
function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Anti-repeat key for a line. Uses the full FEN path, not a prefix: every
 * line in a repertoire shares its opening moves, so a prefix key collides
 * across all variations and makes the dedup inert. Both the producer
 * (pickNewLine) and the consumer (selectRandomLine) must derive keys the
 * same way or nothing ever matches.
 */
function lineKey(line: string[]): string {
  return line.map(normalizeFen).join("|");
}

/**
 * Pre-select a random complete line through the repertoire tree.
 *
 * A "line" is a sequence of FENs from the starting position to a leaf (a
 * position where either side has no further moves stored). At opponent
 * junctions we pick randomly from mainline moves; at Kevin's junctions we
 * also pick randomly so different variations are drilled each run.
 *
 * Returns an array of FEN strings representing each position in the line,
 * starting from STARTING_FEN. The caller uses these to know which opponent
 * move to play at each turn, preventing the drill from always following the
 * same path.
 */
function selectRandomLine(
  positions: Record<string, { san: string; nextFen: string; isMainLine?: boolean; depth?: number }[]>,
  recentLineKeys: Set<string>,
  side: "white" | "black",
): string[] {
  const kevinsColor = side === "white" ? "w" : "b";
  const MAX_DEPTH = 50;
  const MAX_ATTEMPTS = 20;

  function traceOneLine(): string[] {
    const fenSequence: string[] = [STARTING_FEN];
    let currentFen = normalizeFen(STARTING_FEN);
    const visited = new Set<string>();

    for (let d = 0; d < MAX_DEPTH; d++) {
      if (visited.has(currentFen)) break; // cycle guard
      visited.add(currentFen);

      const available = positions[currentFen];
      if (!available || available.length === 0) break;

      const sideToMove = currentFen.split(" ")[1]; // 'w' or 'b'

      let pick: typeof available[0] | undefined;
      if (sideToMove !== kevinsColor) {
        // Opponent turn: prefer mainline moves to avoid refutation-bait lines.
        const mainline = available.filter((m) => m.isMainLine);
        const pool = mainline.length > 0 ? mainline : available;
        pick = pickRandom(pool);
      } else {
        // Kevin's turn: pick any move so we drill different variations.
        pick = pickRandom(available);
      }

      if (!pick) break;

      const nextFen = normalizeFen(pick.nextFen);
      fenSequence.push(pick.nextFen); // keep the full FEN for the board
      currentFen = nextFen;
    }

    return fenSequence;
  }

  // Try up to MAX_ATTEMPTS to pick a line we haven't seen recently.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const line = traceOneLine();
    if (!recentLineKeys.has(lineKey(line)) || attempt === MAX_ATTEMPTS - 1) {
      return line;
    }
  }

  return traceOneLine(); // fallback
}

interface RunStats {
  moves: number;
  correct: number;
  wrong: number;
}

type RunState = "playing" | "opponent" | "complete";

interface RepertoireRunScreenProps {
  onBack: () => void;
}

export const RepertoireRunScreen: React.FC<RepertoireRunScreenProps> = ({ onBack }) => {
  const positions = useRepertoireStore((s) => s.positions);
  const repertoireSide = useRepertoireStore((s) => s.repertoireSide);
  const repertoireName = useRepertoireStore((s) => s.repertoireName);
  const { playSound } = useSound();

  // Recent line keys prevent the same line from repeating — persisted to
  // localStorage so dedup survives component remounts and navigation.
  const LS_KEY = `chess-forge-recent-lines-${repertoireName ?? "default"}`;
  const recentLineKeys = useRef<Set<string>>((() => {
    try {
      const raw = localStorage.getItem(
        `chess-forge-recent-lines-${repertoireName ?? "default"}`,
      );
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  })());

  // Pre-selected line for this drill run: array of FENs from start to leaf.
  // Opponent picks are locked in upfront so the drill is deterministic and varied.
  const selectedLineRef = useRef<string[]>([]);

  // Visited FENs (normalized) for the current drill run — used to detect runtime
  // cycles so autoPlayOpponent never loops back to a position already seen.
  const visitedFensRef = useRef<Set<string>>(new Set());

  function pickNewLine() {
    const line = selectRandomLine(positions, recentLineKeys.current, repertoireSide);
    selectedLineRef.current = line;
    recentLineKeys.current.add(lineKey(line));
    // Keep the recent set bounded to last 30 lines.
    if (recentLineKeys.current.size > 30) {
      const [first] = recentLineKeys.current;
      recentLineKeys.current.delete(first);
    }
    // Persist to localStorage so dedup survives navigation.
    try {
      localStorage.setItem(LS_KEY, JSON.stringify([...recentLineKeys.current]));
    } catch { /* quota exceeded — ignore */ }
    return line;
  }

  const [fen, setFen] = useState(() => {
    pickNewLine();
    visitedFensRef.current = new Set([normalizeFen(STARTING_FEN)]);
    return STARTING_FEN;
  });
  const [state, setState] = useState<RunState>("playing");
  const [shaking, setShaking] = useState(false);
  const [wrongMove, setWrongMove] = useState<string | null>(null);
  const [revealMode, setRevealMode] = useState(false);
  const [stats, setStats] = useState<RunStats>({ moves: 0, correct: 0, wrong: 0 });
  const [moveHistory, setMoveHistory] = useState<string[]>([]);

  const chessRef = useRef(new Chess());

  // Pending "Show correct" timer. Held in a ref so a restart or unmount can
  // cancel it — otherwise it fires against a board that has already moved on.
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
  }, []);

  // Side to move derived from FEN
  const sideToMove = fen.split(" ")[1] === "w" ? "white" : "black";
  const isKevinsTurn = sideToMove === repertoireSide;

  const boardOrientation = repertoireSide;

  // On mount and whenever fen changes: auto-advance opponent using the
  // pre-selected line, OR if it's Kevin's turn and the position is a leaf
  // (no repertoire moves), end the line gracefully.
  useEffect(() => {
    if (state !== "playing") return;
    const currentFen = fen; // capture for this effect invocation
    const nfen = normalizeFen(currentFen);
    const available = positions[nfen];
    if (!isKevinsTurn) {
      autoPlayOpponent(currentFen);
      return;
    }
    // Kevin's turn — if there's nothing stored here, the line has run out.
    if (!available || available.length === 0) {
      console.warn("[RepertoireRun] No repertoire moves at Kevin's FEN — completing line", nfen);
      setState("complete");
      return;
    }
    // Kevin's turn — if we're at the last position in the pre-selected line,
    // the drill is done even if the DB has more moves (avoids off-script extension).
    const line = selectedLineRef.current;
    const currentIdx = line.findIndex((f) => normalizeFen(f) === nfen);
    if (currentIdx !== -1 && currentIdx === line.length - 1) {
      console.warn("[RepertoireRun] End of selected line (Kevin's turn) — completing", nfen);
      setState("complete");
    }
  }, [fen, state, isKevinsTurn, positions]); // eslint-disable-line react-hooks/exhaustive-deps

  function autoPlayOpponent(currentFen: string) {
    const nfen = normalizeFen(currentFen);
    const available = positions[nfen];
    if (!available || available.length === 0) {
      // Leaf node on opponent's side — no more moves
      console.warn("[RepertoireRun] No opponent moves stored at FEN — completing line", nfen);
      setState("complete");
      return;
    }

    // Find the pre-selected opponent move for this position in the chosen line.
    // The selectedLine is an array of FENs: [startFen, afterMove1, afterMove2, ...].
    // The FEN *after* the opponent's move is what we look for in selectedLine.
    const line = selectedLineRef.current;
    const currentIdx = line.findIndex((f) => normalizeFen(f) === nfen);

    // If we've reached the last FEN in the pre-selected line, the line is done.
    // Don't fall through to the fallback pool — that would extend the drill past
    // the intended endpoint, leaving Kevin stuck at an off-script position.
    if (currentIdx !== -1 && currentIdx + 1 >= line.length) {
      console.warn("[RepertoireRun] End of selected line reached — completing", nfen);
      setState("complete");
      return;
    }

    setState("opponent");

    let preSelectedSan: string | null = null;
    if (currentIdx !== -1 && currentIdx + 1 < line.length) {
      const nextFen = normalizeFen(line[currentIdx + 1]);
      // Find the move in available that leads to the pre-selected next FEN.
      const preSelected = available.find((m) => normalizeFen(m.nextFen) === nextFen);
      if (preSelected) preSelectedSan = preSelected.san;
    }

    // Build candidate list: pre-selected first, then mainline fallbacks, then all.
    // This ensures we follow the pre-selected line but gracefully fall back if
    // the FEN lookup misses (e.g. transposition).
    // Exclude any move whose resulting FEN was already visited this run — this
    // prevents perpetual-check / bishop-bounce loops (e.g. Kh7/Kh8 in the 1...c5
    // variation) from cycling the drill indefinitely.
    const mainline = available.filter((m) => m.isMainLine);
    const fallbackPool = mainline.length > 0 ? mainline : available;
    // Shuffle fallback so repeated restarts don't always pick the same fallback.
    const shuffledFallback = [...fallbackPool].sort(() => Math.random() - 0.5);

    const candidates: typeof available = [];
    if (preSelectedSan) {
      const preSelectedMove = available.find((m) => m.san === preSelectedSan);
      if (preSelectedMove) candidates.push(preSelectedMove);
    }
    for (const m of shuffledFallback) {
      if (!candidates.some((c) => c.san === m.san)) candidates.push(m);
    }

    setTimeout(() => {
      // Try each candidate in order until one applies cleanly. Some PGN-derived
      // SANs occasionally fail chess.js's strict parse (annotations, ambiguity);
      // never let that freeze the drill — fall through and complete if all fail.
      for (const pick of candidates) {
        try {
          const chess = new Chess(currentFen);
          const m = chess.move(pick.san);
          if (!m) continue;

          // Cycle guard: if this move would revisit a FEN already seen in this
          // drill run, end the line gracefully instead of looping indefinitely.
          const resultNfen = normalizeFen(chess.fen());
          if (visitedFensRef.current.has(resultNfen)) {
            console.warn(
              "[RepertoireRun] Cycle detected — opponent move leads to visited FEN, completing",
              pick.san, resultNfen,
            );
            setState("complete");
            return;
          }

          if (m.flags.includes("c")) playSound("capture");
          else playSound("move");
          const newFen = chess.fen();
          visitedFensRef.current.add(resultNfen);
          chessRef.current = chess;
          setFen(newFen);
          setMoveHistory((h) => [...h, pick.san]);
          const nextNfen = resultNfen;
          const nextMoves = positions[nextNfen];
          if (!nextMoves || nextMoves.length === 0) {
            setState("complete");
          } else {
            setState("playing");
          }
          return;
        } catch (e) {
          console.warn("[RepertoireRun] opponent move failed, trying next", pick.san, e);
          continue;
        }
      }
      // No candidate played cleanly — end the line rather than freezing.
      console.warn("[RepertoireRun] No opponent move applied at FEN — completing", nfen);
      setState("complete");
    }, 600);
  }

  const onDrop = useCallback(
    (source: string, target: string) => {
      // revealMode means a "Show correct" replay is pending — the board must
      // stay frozen until it lands, or the two writes race over the same FEN.
      if (state !== "playing" || !isKevinsTurn || revealMode) return false;

      const nfen = normalizeFen(fen);
      const available = positions[nfen];
      if (!available || available.length === 0) {
        setState("complete");
        return false;
      }

      // Try the move in chess.js
      const chess = new Chess(fen);
      let move;
      try {
        move = chess.move({ from: source, to: target, promotion: "q" });
      } catch {
        return false;
      }
      if (!move) return false;

      // Check if this matches any repertoire move
      const correct = available.find((m) => {
        try {
          const ref = new Chess(fen);
          const refMove = ref.move(m.san);
          return refMove && move.from === refMove.from && move.to === refMove.to;
        } catch {
          return looseSan(move.san) === looseSan(m.san);
        }
      });

      if (correct) {
        if (move.flags.includes("c")) playSound("capture");
        else if (chess.inCheck()) playSound("check");
        else playSound("move");

        chessRef.current = chess;
        const newFen = chess.fen();
        visitedFensRef.current.add(normalizeFen(newFen));
        setFen(newFen);
        setWrongMove(null);
        setRevealMode(false);
        setMoveHistory((h) => [...h, move.san]);
        setStats((s) => ({ ...s, moves: s.moves + 1, correct: s.correct + 1 }));
        return true;
      }

      // Wrong move
      playSound("wrong");
      setWrongMove(move.san);
      setStats((s) => ({ ...s, moves: s.moves + 1, wrong: s.wrong + 1 }));
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      return false;
    },
    [state, isKevinsTurn, revealMode, fen, positions, playSound],
  );

  function handleReveal() {
    if (revealTimerRef.current) return; // already revealing
    setRevealMode(true);
    const revealFen = fen; // pin the position this reveal belongs to
    const nfen = normalizeFen(revealFen);
    const available = positions[nfen];
    if (!available || available.length === 0) {
      setRevealMode(false); // nothing to show — don't leave the board frozen
      return;
    }

    // Prefer the pre-selected line's move for this position so "Show correct"
    // stays consistent with the line being drilled, not always the first move.
    const line = selectedLineRef.current;
    const currentIdx = line.findIndex((f) => normalizeFen(f) === nfen);
    let correct = available[0];
    if (currentIdx !== -1 && currentIdx + 1 < line.length) {
      const nextFen = normalizeFen(line[currentIdx + 1]);
      const preSelected = available.find((m) => normalizeFen(m.nextFen) === nextFen);
      if (preSelected) correct = preSelected;
    }

    revealTimerRef.current = setTimeout(() => {
      revealTimerRef.current = null;
      try {
        const chess = new Chess(revealFen);
        chess.move(correct.san);
        chessRef.current = chess;
        const newFen = chess.fen();
        visitedFensRef.current.add(normalizeFen(newFen));
        setFen(newFen);
        setWrongMove(null);
        setRevealMode(false);
        setMoveHistory((h) => [...h, correct.san]);
      } catch {
        setState("complete");
      }
    }, 1200);
  }

  function handleRestart() {
    // Kill any pending reveal so it can't land on the fresh board.
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    // Pick a fresh line so each "Run Again" drills a different variation.
    pickNewLine();
    // Reset the visited-FENs tracker so cycle detection starts fresh.
    visitedFensRef.current = new Set([normalizeFen(STARTING_FEN)]);
    chessRef.current = new Chess();
    setFen(STARTING_FEN);
    setState("playing");
    setWrongMove(null);
    setRevealMode(false);
    setStats({ moves: 0, correct: 0, wrong: 0 });
    setMoveHistory([]);
  }

  const acc = stats.moves > 0 ? Math.round((stats.correct / stats.moves) * 100) : 100;
  const depth = moveHistory.length;

  return (
    <div className="flex-1 flex flex-col bg-forge-base overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-forge-surface border-b border-forge-border-subtle shrink-0">
        <button
          onClick={onBack}
          aria-label="Back"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 -ml-2 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base  text-forge-text-secondary hover:text-white transition-all active:scale-95"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-black text-forge-text-primary uppercase tracking-wider">
            {repertoireName}
          </h2>
          <p className="text-[10px] text-forge-text-inactive font-semibold">Move {depth}</p>
        </div>
        {stats.moves > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-forge-success font-black">{stats.correct}</span>
            <span className="text-forge-text-muted">/</span>
            <span className="text-forge-text-secondary font-semibold">{stats.moves}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {state === "complete" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 pt-8 pb-24">
            <div className="flex flex-col items-center gap-3">
              <div className="w-20 h-20 rounded-[2rem] border-2 flex items-center justify-center bg-forge-success-muted border-forge-success-border">
                <Check size={36} className="text-forge-success" />
              </div>
              <p className="text-sm font-black uppercase tracking-wider text-forge-success">
                Line complete
              </p>
              <div className="text-xs text-forge-text-inactive">
                {depth} moves · {acc}% accuracy
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center w-full">
              <div className="bg-forge-card border border-forge-border-subtle rounded-2xl py-4">
                <p className="text-2xl font-black text-forge-text-primary">{depth}</p>
                <p className="text-[10px] text-forge-text-inactive font-semibold uppercase tracking-wider mt-1">moves</p>
              </div>
              <div className="bg-forge-card border border-forge-border-subtle rounded-2xl py-4">
                <p className="text-2xl font-black text-forge-success">{stats.correct}</p>
                <p className="text-[10px] text-forge-text-inactive font-semibold uppercase tracking-wider mt-1">correct</p>
              </div>
              <div className="bg-forge-card border border-forge-border-subtle rounded-2xl py-4">
                <p className="text-2xl font-black text-forge-danger">{stats.wrong}</p>
                <p className="text-[10px] text-forge-text-inactive font-semibold uppercase tracking-wider mt-1">missed</p>
              </div>
            </div>

            <button
              onClick={handleRestart}
              className={cn(
                "w-full max-w-xs flex items-center justify-center gap-2 py-4 rounded-2xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base",
                "bg-forge-primary hover:bg-forge-primary active:scale-[0.98]",
                "text-white font-black text-base uppercase tracking-widest",
                "shadow-xl shadow-indigo-600/30 border border-forge-primary-border transition-all",
              )}
            >
              <RotateCcw size={16} />
              Run Again
            </button>
          </div>
        ) : (
          <>
            {/* Board */}
            <div
              className={cn(
                "flex-1 flex items-center justify-center p-4 relative",
                shaking && "motion-safe:animate-shake",
              )}
            >
              <div className="w-full aspect-square rounded-xl overflow-hidden shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] bg-forge-board p-[6px]">
                <div className="w-full h-full rounded-lg overflow-hidden">
                  <Chessboard
                    position={fen}
                    onPieceDrop={state === "playing" && isKevinsTurn && !revealMode ? onDrop : () => false}
                    boardOrientation={boardOrientation}
                    animationDuration={state === "opponent" ? 500 : 150}
                    arePiecesDraggable={state === "playing" && isKevinsTurn && !revealMode}
                    {...BOARD_THEME}
                  />
                </div>
              </div>
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between px-6 py-3 bg-forge-surface border-t border-forge-border-subtle shrink-0">
              {state === "opponent" ? (
                <p className="text-xs text-forge-text-inactive italic">Opponent thinking...</p>
              ) : isKevinsTurn ? (
                wrongMove ? (
                  <div className="flex items-center gap-2 text-sm">
                    <X size={14} className="text-forge-danger" />
                    <span className="text-forge-danger font-semibold">Not in repertoire</span>
                  </div>
                ) : (
                  <p className="text-xs text-forge-text-inactive">
                    {repertoireSide === "white" ? "Play White's move" : "Play Black's move"}
                  </p>
                )
              ) : (
                <p className="text-xs text-forge-text-inactive">Waiting...</p>
              )}
              {wrongMove && !revealMode && isKevinsTurn && (
                <button
                  onClick={handleReveal}
                  className="min-h-[44px] min-w-[44px] flex items-center gap-1.5 text-xs text-forge-text-inactive hover:text-forge-text-primary transition-all ml-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base"
                >
                  Show correct
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
