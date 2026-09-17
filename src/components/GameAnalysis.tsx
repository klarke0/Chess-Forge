import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  Zap,
  Cpu,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { UniversalBoard } from "./UniversalBoard";
import { ParsedGame } from "../services/pgn_parser";
import { useEngineStore } from "../stores/engineStore";
import { useRepertoireStore } from "../stores/repertoireStore";
import { useGameReview } from "../hooks/useGameReview";
import { cn } from "../utils/cn";
import { Chess } from "chess.js";
import { request } from "../services/api";

// --- Types ---
export interface Deviation {
  moveNumber: number;
  fen: string;
  playedSan: string;
  repertoireSan: string;
  evalDiff: number;
  side: "player" | "opponent";
}

export interface AnalyzedGame {
  id: string;
  white: string;
  black: string;
  result: string;
  date: string;
  deviations: Deviation[];
  analysis_json?: string | null;
  userColor?: "white" | "black";
  game_shape?: string | null;
}

interface GameAnalysisProps {
  game: AnalyzedGame;
  parsedGame?: ParsedGame;
  initialMoveIdx?: number;
  onClose: () => void;
  onDrillDeviation: (deviation: Deviation) => void;
  onViewOnPlatform?: () => void;
  onSwitchToSummary?: () => void;
}

// --- Grade config (chess.com style) ---

interface GradeConfig {
  label: string;
  symbol: string;
  dot: string;     // bg color for dot
  text: string;    // text color for move token
  bg: string;      // bg for selected / highlight
}

const GRADE_CONFIG: Record<string, GradeConfig> = {
  blunder: {
    label: "Blunder",
    symbol: "??",
    dot: "bg-rose-500",
    text: "text-rose-400",
    bg: "bg-rose-500/20",
  },
  mistake: {
    label: "Mistake",
    symbol: "?",
    dot: "bg-orange-400",
    text: "text-orange-400",
    bg: "bg-orange-500/20",
  },
  inaccuracy: {
    label: "Inaccuracy",
    symbol: "?!",
    dot: "bg-yellow-300",
    text: "text-yellow-300",
    bg: "bg-yellow-500/15",
  },
  good: {
    label: "Good",
    symbol: "",
    dot: "bg-slate-400",
    text: "text-slate-300",
    bg: "",
  },
  best: {
    label: "Best",
    symbol: "✓",
    dot: "bg-green-400",
    text: "text-green-400",
    bg: "bg-green-500/15",
  },
  excellent: {
    label: "Great",
    symbol: "!",
    dot: "bg-[#5b8dd9]",
    text: "text-[#5b8dd9]",
    bg: "bg-[#5b8dd9]/15",
  },
};

const formatEval = (cp: number | null | undefined, mate: number | null | undefined): string => {
  if (mate != null) return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  if (cp == null) return "0.0";
  const v = cp / 100;
  if (Math.abs(v) < 0.05) return "0.0";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
};

// --- Player Header ---
const PlayerHeader: React.FC<{
  username: string;
  isOpponent: boolean;
  accuracy?: number;
  userColor: "white" | "black";
}> = ({ username, isOpponent, accuracy, userColor }) => {
  // The opponent is above the board; figure out their piece color
  const pieceColor = isOpponent
    ? userColor === "white" ? "black" : "white"
    : userColor;

  const initials = username.slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center justify-between px-2 py-1.5 shrink-0">
      <div className="flex items-center gap-2">
        {/* Piece color indicator */}
        <div
          className={cn(
            "w-5 h-5 rounded-full border-2 shrink-0",
            pieceColor === "white"
              ? "bg-slate-100 border-slate-300"
              : "bg-[#1a1a2e] border-slate-600",
          )}
        />
        {/* Avatar */}
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0",
            isOpponent ? "bg-[#1a1a2e] text-[#5b8dd9]" : "bg-[#1a2e1a] text-[#6eb966]",
          )}
        >
          {initials}
        </div>
        <span className="text-[13px] font-bold text-slate-200 truncate max-w-[120px]">
          {username}
        </span>
      </div>
      {accuracy != null && (
        <span
          className={cn(
            "text-[13px] font-black tabular-nums",
            accuracy >= 85
              ? "text-[#6eb966]"
              : accuracy >= 70
                ? "text-yellow-300"
                : "text-rose-400",
          )}
        >
          {accuracy.toFixed(1)}%
        </span>
      )}
    </div>
  );
};

// --- Eval Bar (vertical, left side) ---
const VerticalEvalBar: React.FC<{ cp: number | null; mate: number | null }> = ({
  cp,
  mate,
}) => {
  const getWhitePct = () => {
    if (mate != null) return mate > 0 ? 100 : 0;
    if (cp == null) return 50;
    const clamped = Math.max(-500, Math.min(500, cp));
    return 50 + clamped / 10;
  };
  const whitePct = getWhitePct();
  const evalText = formatEval(cp, mate);

  return (
    <div className="w-5 flex-1 bg-[#1a1a2e] rounded-forge-sm overflow-hidden border border-white/5 flex flex-col relative shrink-0">
      {/* Black section (top) */}
      <div
        className="w-full bg-[#1a1a2e] transition-all duration-700 ease-out"
        style={{ height: `${100 - whitePct}%` }}
      />
      {/* White section (bottom) */}
      <div
        className="w-full bg-slate-100 transition-all duration-700 ease-out"
        style={{ height: `${whitePct}%` }}
      />
      {/* Eval text — pinned to whichever half is bigger */}
      <div
        className={cn(
          "absolute left-0 right-0 text-[8px] font-black text-center px-0.5 pointer-events-none",
          whitePct > 50 ? "bottom-1 text-slate-700" : "top-1 text-slate-300",
        )}
      >
        {evalText}
      </div>
    </div>
  );
};

// --- Move quality dot ---
const GradeDot: React.FC<{ grade: string }> = ({ grade }) => {
  const cfg = GRADE_CONFIG[grade];
  if (!cfg || !cfg.symbol) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-black text-white shrink-0",
        cfg.dot,
      )}
    >
      {cfg.symbol}
    </span>
  );
};

// Accuracy calculation (mirrors GameReviewSummary)
function computeAccuracy(
  moves: Array<{ grade: string }>,
  side: "white" | "black",
): number {
  if (!moves.length) return 0;
  const gradeScore: Record<string, number> = {
    best: 100,
    excellent: 90,
    good: 75,
    inaccuracy: 50,
    mistake: 25,
    blunder: 0,
  };
  const sideIdxs = moves.reduce<number[]>((acc, _m, i) => {
    if (
      (i % 2 === 0 && side === "white") ||
      (i % 2 === 1 && side === "black")
    ) {
      acc.push(i);
    }
    return acc;
  }, []);
  if (!sideIdxs.length) return 0;
  const total = sideIdxs.reduce(
    (sum, i) => sum + (gradeScore[moves[i].grade] ?? 50),
    0,
  );
  return Math.round((total / sideIdxs.length) * 10) / 10;
}

// --- Main Component ---

export const GameAnalysis: React.FC<GameAnalysisProps> = ({
  game,
  parsedGame,
  initialMoveIdx,
  onClose,
  onDrillDeviation: _onDrillDeviation,
  onSwitchToSummary,
}) => {
  const [currentMoveIdx, setCurrentMoveIdx] = useState(initialMoveIdx ?? -1);
  const [previewFen, setPreviewFen] = useState<string | null>(null);

  const movesScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to initial move on mount
  useEffect(() => {
    if (initialMoveIdx !== undefined && initialMoveIdx !== null && initialMoveIdx >= 0) {
      setCurrentMoveIdx(initialMoveIdx);
      setTimeout(() => {
        const el = document.getElementById(`rv-move-${initialMoveIdx}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  }, [initialMoveIdx]);

  // Stores
  const { engine, evaluate, topLines, evaluation } = useEngineStore();
  const repertoireSide = useRepertoireStore((s) => s.repertoireSide);
  const repertoirePositions = useRepertoireStore((s) => s.positions);

  // Returns true if `san` is a repertoire move at `fenBefore` — used to suppress
  // mistake/inaccuracy/blunder flagging on book moves (e.g. 2.Nc3 in the Jobava).
  const isRepertoireMove = (fenBefore: string, san: string): boolean => {
    try {
      // normalizeFen the key the same way the store does (4-field FEN)
      const key = fenBefore.split(" ").slice(0, 4).join(" ");
      const moves = repertoirePositions[key];
      if (!moves || !moves.length) return false;
      return moves.some((m) => m.san === san);
    } catch {
      return false;
    }
  };

  const {
    reviewedMoves,
    isAnalyzing: isFullAnalyzing,
    progress,
    analyzeGame,
  } = useGameReview(game.id, game.analysis_json);

  // Derived
  const movesList = useMemo(() => parsedGame?.moves || [], [parsedGame]);

  const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const baseFen = useMemo(() => {
    if (currentMoveIdx === -1) return STARTING_FEN;
    return movesList[currentMoveIdx]?.fenAfter || STARTING_FEN;
  }, [currentMoveIdx, movesList]);

  const currentFen = useMemo(() => previewFen || baseFen, [previewFen, baseFen]);

  const userColor = game.userColor ?? (repertoireSide as "white" | "black");
  const opponentColor: "white" | "black" = userColor === "white" ? "black" : "white";
  const userUsername = userColor === "white" ? game.white : game.black;
  const opponentUsername = opponentColor === "white" ? game.white : game.black;

  const userAccuracy = useMemo(
    () => (reviewedMoves.length ? computeAccuracy(reviewedMoves, userColor) : undefined),
    [reviewedMoves, userColor],
  );
  const opponentAccuracy = useMemo(
    () => (reviewedMoves.length ? computeAccuracy(reviewedMoves, opponentColor) : undefined),
    [reviewedMoves, opponentColor],
  );

  // Evaluate current position for eval bar
  // Track the FEN we last requested so we ignore stale engine results
  const [evaluatingFen, setEvaluatingFen] = useState<string | null>(null);
  useEffect(() => {
    if (engine && !previewFen) {
      setEvaluatingFen(baseFen);
      evaluate(baseFen);
    }
  }, [baseFen, engine, evaluate, previewFen]);

  // Eval bar: use live engine result only when it's for the current position,
  // otherwise fall back to pre-analysed white-perspective eval (no sign flip).
  const evalCp = useMemo(() => {
    const liveIsForCurrentFen = evaluatingFen === baseFen && evaluation.cp !== null;
    if (liveIsForCurrentFen) return evaluation.cp;
    if (currentMoveIdx >= 0 && reviewedMoves[currentMoveIdx]) {
      return reviewedMoves[currentMoveIdx].eval;
    }
    return null;
  }, [evaluation.cp, evaluatingFen, baseFen, currentMoveIdx, reviewedMoves]);

  const evalMate = useMemo(() => {
    if (evaluatingFen === baseFen) return evaluation.mate;
    return null;
  }, [evaluation.mate, evaluatingFen, baseFen]);

  // Best engine line for the right panel
  const bestLine = topLines[0];
  const bestMoveSan = useMemo(() => {
    if (!bestLine?.pv) return null;
    const uci = bestLine.pv.split(" ")[0];
    if (!uci) return null;
    try {
      const g = new Chess(currentFen);
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const prom = uci.length === 5 ? uci[4] : undefined;
      const m = g.move({ from, to, promotion: prom });
      return m?.san ?? uci;
    } catch {
      return uci;
    }
  }, [bestLine, currentFen]);

  // Navigation
  const handleNav = (delta: number | "start" | "end") => {
    setPreviewFen(null);
    if (delta === "start") setCurrentMoveIdx(-1);
    else if (delta === "end") setCurrentMoveIdx(movesList.length - 1);
    else setCurrentMoveIdx((prev) => Math.max(-1, Math.min(movesList.length - 1, prev + delta)));
  };

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); handleNav(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); handleNav(1); }
      if (e.key === "ArrowUp") { e.preventDefault(); handleNav("start"); }
      if (e.key === "ArrowDown") { e.preventDefault(); handleNav("end"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [movesList.length]);

  // Auto-scroll move list to active move
  useEffect(() => {
    if (currentMoveIdx >= 0) {
      const el = document.getElementById(`rv-move-${currentMoveIdx}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentMoveIdx]);

  // Returns the grade for a given move index, with repertoire-book-move
  // suppression: if the played move is in the user's repertoire at fenBefore,
  // any inaccuracy/mistake/blunder flag is downgraded to "best" (it's a book move,
  // not an analysis error).
  // NOTE: must be declared before moveRows useMemo (arrow functions are not hoisted)
  const getEffectiveGrade = (idx: number): string | undefined => {
    if (idx < 0) return undefined;
    const r = reviewedMoves[idx];
    if (!r) return undefined;
    const flagged =
      r.grade === "blunder" || r.grade === "mistake" || r.grade === "inaccuracy";
    if (!flagged) return r.grade;
    const fenBefore =
      idx === 0 ? STARTING_FEN : reviewedMoves[idx - 1]?.fen ?? STARTING_FEN;
    if (isRepertoireMove(fenBefore, r.san)) return "best";
    return r.grade;
  };

  // Two-column move list data: [[white, black], ...]
  const moveRows = useMemo(() => {
    const rows: Array<{
      moveNumber: number;
      white: { idx: number; san: string; grade?: string } | null;
      black: { idx: number; san: string; grade?: string } | null;
    }> = [];
    for (let i = 0; i < movesList.length; i += 2) {
      rows.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: {
          idx: i,
          san: movesList[i].san,
          grade: getEffectiveGrade(i),
        },
        black:
          i + 1 < movesList.length
            ? {
                idx: i + 1,
                san: movesList[i + 1].san,
                grade: getEffectiveGrade(i + 1),
              }
            : null,
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movesList, reviewedMoves, repertoirePositions]);

  // Current grade info for the badge shown above the board
  const currentGrade =
    currentMoveIdx >= 0 ? getEffectiveGrade(currentMoveIdx) : undefined;
  const currentGradeConfig = currentGrade ? GRADE_CONFIG[currentGrade] : undefined;

  // Mistake coach panel data — surfaces when current move is flagged.
  // Uses the per-move analysis already cached in reviewedMoves (no extra engine work)
  // and calls the same /analyze/blunder endpoint the drill failure UI uses.
  const mistakeCoachData = useMemo(() => {
    if (currentMoveIdx < 0) return null;
    const reviewed = reviewedMoves[currentMoveIdx];
    if (!reviewed) return null;
    const isFlagged =
      reviewed.grade === "blunder" ||
      reviewed.grade === "mistake" ||
      reviewed.grade === "inaccuracy";
    if (!isFlagged) return null;
    if (!reviewed.bestMove) return null;

    // Position BEFORE the move was played
    const fenBefore =
      currentMoveIdx === 0
        ? STARTING_FEN
        : reviewedMoves[currentMoveIdx - 1]?.fen ?? STARTING_FEN;

    // Repertoire-aware override: if the played move is a book move in the
    // loaded repertoire, suppress mistake flagging entirely.
    if (isRepertoireMove(fenBefore, reviewed.san)) return null;

    // Convert engine's bestMove (UCI from prev position) → SAN
    let correctSan = reviewed.bestMove;
    try {
      const g = new Chess(fenBefore);
      const uci = reviewed.bestMove;
      const m = g.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length === 5 ? uci[4] : undefined,
      });
      if (m) correctSan = m.san;
    } catch {
      /* fall back to UCI string */
    }

    // Side that played this move (white plays even indices, 0-based)
    const side: "White" | "Black" = currentMoveIdx % 2 === 0 ? "White" : "Black";
    const moveNumber = Math.floor(currentMoveIdx / 2) + 1;

    return {
      fenBefore,
      wrongMoveSan: reviewed.san,
      correctMoveSan: correctSan,
      cpLossPawns: (reviewed.cpLoss ?? 0) / 100,
      grade: reviewed.grade,
      side,
      moveNumber,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMoveIdx, reviewedMoves, repertoirePositions]);

  return (
    <div className="absolute inset-0 z-50 bg-forge-base text-slate-200 font-outfit flex flex-col animate-in fade-in duration-300">
      {/* ── Top bar ── */}
      <div className="border-b border-forge-border-subtle bg-forge-surface shrink-0">
        {/* View toggle row */}
        {onSwitchToSummary && (
          <div className="flex items-center justify-center pt-2 pb-1 px-3">
            <div className="flex bg-forge-base rounded-xl p-0.5 gap-0.5 border border-forge-border-subtle">
              <button
                onClick={onSwitchToSummary}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all text-slate-500 hover:text-slate-300"
              >
                Summary
              </button>
              <button
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
              >
                Review
              </button>
            </div>
          </div>
        )}
        {/* Info row */}
        <div className="h-10 flex items-center justify-between px-3">
          <div className="flex items-center gap-3">
            <span className="font-black uppercase tracking-widest text-[10px] text-slate-400">
              Board Review
            </span>
            <div
              className={cn(
                "px-2 py-0.5 rounded-full border text-[9px] font-black uppercase",
                game.result === "win"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : game.result === "loss"
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    : "bg-slate-500/10 text-slate-400 border-slate-500/20",
              )}
            >
              {game.result}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isFullAnalyzing && (
              <div className="flex items-center gap-2 bg-indigo-500/5 px-3 py-1 rounded-xl border border-indigo-500/10">
                <div className="w-16 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${(progress.current / (progress.total || 1)) * 100}%` }}
                  />
                </div>
                <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest animate-pulse">
                  {progress.current}/{progress.total}
                </span>
              </div>
            )}
            {!isFullAnalyzing && reviewedMoves.length === 0 && parsedGame && (
              <button
                onClick={() => analyzeGame(parsedGame)}
                className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/20 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all"
              >
                <Zap size={11} /> Analyze
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-slate-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      {/* ── BOARD AREA: full width ── */}
      <div className="shrink-0 flex flex-col">
        {/* Opponent header */}
        <PlayerHeader
          username={opponentUsername}
          isOpponent
          accuracy={opponentAccuracy}
          userColor={userColor}
        />

        {/* Eval bar + board side by side */}
        <div className="flex items-stretch gap-1.5 px-2 py-1">
          <div className="py-1 flex self-stretch">
            <VerticalEvalBar cp={evalCp} mate={evalMate} />
          </div>
          <div className="flex-1 relative min-w-0">
            <UniversalBoard
              fen={currentFen}
              orientation={userColor}
              playerColor={userColor}
              readonly={false}
              mobileControls
              onDrop={(source, target) => {
                const g = new Chess(currentFen);
                try {
                  const m = g.move({ from: source, to: target, promotion: "q" });
                  if (!m) return false;
                  setPreviewFen(g.fen());
                  return true;
                } catch {
                  return false;
                }
              }}
              mobileSquare
            />
            {/* Move quality badge overlay */}
            {currentGradeConfig && currentGradeConfig.symbol && (
              <div className="absolute bottom-2 right-2 z-10">
                <div
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black text-white shadow-lg",
                    currentGradeConfig.dot,
                  )}
                >
                  <span>{currentGradeConfig.symbol}</span>
                  <span className="uppercase tracking-widest">{currentGradeConfig.label}</span>
                </div>
              </div>
            )}
            {/* Return to game button when previewing */}
            {previewFen && (
              <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20">
                <button
                  onClick={() => setPreviewFen(null)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-[9px] uppercase tracking-[0.2em] shadow-2xl border border-indigo-400/30 animate-in slide-in-from-bottom-4 transition-all"
                >
                  <RotateCcw size={10} /> Return to Game
                </button>
              </div>
            )}
          </div>
        </div>

        {/* User header */}
        <PlayerHeader
          username={userUsername}
          isOpponent={false}
          accuracy={userAccuracy}
          userColor={userColor}
        />
      </div>

      {/* ── ENGINE LINE + NAV CONTROLS ── */}
      <div className="shrink-0 flex items-center border-t border-forge-border-subtle bg-forge-surface px-3 py-2 gap-3">
        {/* Engine best line */}
        <div className="flex-1 flex items-center gap-1.5 min-w-0">
          <Cpu size={11} className={bestLine ? "text-indigo-400 shrink-0" : "text-slate-600 animate-pulse shrink-0"} />
          {bestLine ? (
            <>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 shrink-0">Best:</span>
              <span className="text-[13px] font-black text-slate-200 shrink-0">{bestMoveSan}</span>
              <span className="text-[11px] font-mono text-indigo-300">{formatEval(bestLine.cp, bestLine.mate)}</span>
            </>
          ) : (
            <span className="text-[10px] text-slate-600 uppercase tracking-wider font-black">Thinking…</span>
          )}
        </div>
        {/* Nav buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => handleNav("start")} disabled={currentMoveIdx <= -1} className="p-2 rounded-forge-sm bg-forge-card border border-forge-border-subtle text-slate-400 hover:text-white disabled:opacity-20 transition-all active:scale-95" aria-label="Start"><ChevronsLeft size={16} /></button>
          <button onClick={() => handleNav(-1)} disabled={currentMoveIdx <= -1} className="p-2 rounded-forge-sm bg-forge-card border border-forge-border-subtle text-slate-400 hover:text-white disabled:opacity-20 transition-all active:scale-95" aria-label="Previous"><ChevronLeft size={16} /></button>
          <button onClick={() => handleNav(1)} disabled={currentMoveIdx >= movesList.length - 1} className="p-2 rounded-forge-sm bg-forge-card border border-forge-border-subtle text-slate-400 hover:text-white disabled:opacity-20 transition-all active:scale-95" aria-label="Next"><ChevronRight size={16} /></button>
          <button onClick={() => handleNav("end")} disabled={currentMoveIdx >= movesList.length - 1} className="p-2 rounded-forge-sm bg-forge-card border border-forge-border-subtle text-slate-400 hover:text-white disabled:opacity-20 transition-all active:scale-95" aria-label="End"><ChevronsRight size={16} /></button>
        </div>
      </div>

      {/* ── MISTAKE COACH (above move list — keeps text in view on mobile) ── */}
      {/* Lifted out of the scrollable move list so the auto-scroll-to-active-move */}
      {/* doesn't push the coach text below the fold. Self-scrolls if content is tall. */}
      {mistakeCoachData && (
        <div className="flex-1 min-h-0 border-t border-forge-border-subtle bg-forge-surface overflow-y-auto">
          <MistakeCoachPanel
            key={`${mistakeCoachData.fenBefore}|${mistakeCoachData.wrongMoveSan}`}
            fenBefore={mistakeCoachData.fenBefore}
            wrongMoveSan={mistakeCoachData.wrongMoveSan}
            correctMoveSan={mistakeCoachData.correctMoveSan}
            cpLossPawns={mistakeCoachData.cpLossPawns}
            grade={mistakeCoachData.grade}
            side={mistakeCoachData.side}
            moveNumber={mistakeCoachData.moveNumber}
          />
        </div>
      )}

      {/* ── MOVE LIST (scrollable, below board) ── */}
      {/* When coach panel is showing, ledger is capped to ~3 rows so coach stays visible. */}
      {/* When no coach (browsing good moves), ledger expands to flex-1 as before. */}
      <div
        ref={movesScrollRef}
        className={cn(
          "overflow-y-auto bg-forge-surface",
          mistakeCoachData
            ? "shrink-0 max-h-[160px] border-t border-forge-border-subtle"
            : "flex-1 min-h-[120px]",
        )}
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
      >
        {moveRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-2 opacity-50">
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black text-center px-4">No moves yet</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1 px-2 py-2.5 leading-tight">
            {moveRows.map((row) => (
              <span key={row.moveNumber} className="inline-flex items-baseline gap-x-0.5">
                <span className="text-[12px] font-mono text-slate-600 select-none mr-0.5">{row.moveNumber}.</span>
                {row.white && (
                  <MoveToken id={`rv-move-${row.white.idx}`} san={row.white.san} grade={row.white.grade} isActive={currentMoveIdx === row.white.idx} onClick={() => { setPreviewFen(null); setCurrentMoveIdx(row.white!.idx); }} />
                )}
                {row.black && (
                  <MoveToken id={`rv-move-${row.black.idx}`} san={row.black.san} grade={row.black.grade} isActive={currentMoveIdx === row.black.idx} onClick={() => { setPreviewFen(null); setCurrentMoveIdx(row.black!.idx); }} />
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Mistake Coach Panel ---
// Surfaced when the user navigates to a flagged move (blunder/mistake/inaccuracy).
// Calls the same /analyze/blunder endpoint used by the drill failure UI.

interface BlunderAnalysisPayload {
  concept: string;
  analysis: string;
  steps?: unknown;
}

const MISTAKE_GRADE_LABEL: Record<string, { title: string; chip: string; chipBg: string; chipText: string; symbol: string }> = {
  blunder: {
    title: "Why this was a blunder",
    chip: "Blunder",
    chipBg: "bg-rose-500/15 border-rose-500/30",
    chipText: "text-rose-300",
    symbol: "??",
  },
  mistake: {
    title: "Why this was a mistake",
    chip: "Mistake",
    chipBg: "bg-orange-500/15 border-orange-500/30",
    chipText: "text-orange-300",
    symbol: "?",
  },
  inaccuracy: {
    title: "Why this was an inaccuracy",
    chip: "Inaccuracy",
    chipBg: "bg-yellow-500/15 border-yellow-500/30",
    chipText: "text-yellow-300",
    symbol: "?!",
  },
};

const MistakeCoachPanel: React.FC<{
  fenBefore: string;
  wrongMoveSan: string;
  correctMoveSan: string;
  cpLossPawns: number;
  grade: string;
  moveNumber: number;
  side: "White" | "Black";
}> = ({ fenBefore, wrongMoveSan, correctMoveSan, cpLossPawns, grade, moveNumber, side }) => {
  const [analysis, setAnalysis] = useState<BlunderAnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Cache key — invalidates when the user moves to a different mistake
  const key = `${fenBefore}|${wrongMoveSan}|${correctMoveSan}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setAnalysis(null);

    request<BlunderAnalysisPayload>("/analyze/blunder", {
      method: "POST",
      body: JSON.stringify({
        fen: fenBefore,
        wrongMove: wrongMoveSan,
        correctMove: correctMoveSan,
        cpLoss: cpLossPawns,
      }),
    })
      .then((res) => {
        if (cancelled) return;
        setAnalysis(res);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const meta = MISTAKE_GRADE_LABEL[grade] ?? MISTAKE_GRADE_LABEL.blunder;

  return (
    <div className="mx-3 my-3 p-5 bg-forge-card border border-forge-border-subtle rounded-2xl flex flex-col gap-4">
      {/* Title row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={14} className="text-indigo-400 shrink-0" />
          <span className="text-[12px] font-black uppercase tracking-wider text-slate-100 truncate">
            {meta.title}
          </span>
        </div>
        <span
          className={cn(
            "shrink-0 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider",
            meta.chipBg,
            meta.chipText,
          )}
        >
          {meta.symbol} {meta.chip}
        </span>
      </div>

      {/* Played → Best chip row (mirrors drill failure UI) */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Played chip (red) */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
          <span className="text-[10px] uppercase tracking-wider text-rose-300/80 font-sans font-black">
            {side} {moveNumber} played
          </span>
          <span className="text-[14px] text-rose-300 font-mono font-bold">
            {wrongMoveSan}
          </span>
        </div>
        <ChevronRight size={14} className="text-slate-600 shrink-0" />
        {/* Best chip (green) */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-[10px] uppercase tracking-wider text-emerald-300/80 font-sans font-black">
            Best
          </span>
          <span className="text-[14px] text-emerald-300 font-mono font-bold">
            {correctMoveSan}
          </span>
        </div>
        {cpLossPawns > 0 && (
          <span className="text-[11px] tabular-nums text-slate-500 ml-auto">
            -{cpLossPawns.toFixed(1)} pawns
          </span>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-4 w-24 bg-forge-border-subtle rounded-full" />
          <div className="h-3 w-full bg-forge-border-subtle rounded-full" />
          <div className="h-3 w-3/4 bg-forge-border-subtle rounded-full" />
        </div>
      )}

      {/* Error fallback */}
      {!loading && error && (
        <div className="flex items-start gap-2 text-xs text-slate-400">
          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <p>
            Coach unavailable. Engine still recommends{" "}
            <span className="text-emerald-400 font-mono font-bold">{correctMoveSan}</span>.
          </p>
        </div>
      )}

      {/* Analysis content */}
      {!loading && !error && analysis && (
        <>
          {analysis.concept && (
            <span className="inline-flex self-start px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {analysis.concept}
            </span>
          )}

          {/* Coach prose — the user already has the main review board above
              for navigation, so we no longer render a duplicate mini-board
              walkthrough here. Steps (if returned) collapse to the same
              prose card. */}
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/30 px-4 py-3.5">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles size={12} className="text-indigo-400 shrink-0" />
              <span className="text-[11px] font-black uppercase tracking-widest text-indigo-400">
                Coach Analysis
              </span>
            </div>
            <p className="text-[14px] text-slate-300 leading-relaxed">
              {analysis.analysis}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

// --- Move Token ---
const MoveToken: React.FC<{
  id: string;
  san: string;
  grade?: string;
  isActive: boolean;
  onClick: () => void;
}> = ({ id, san, grade, isActive, onClick }) => {
  const cfg = grade ? GRADE_CONFIG[grade] : undefined;

  return (
    <button
      id={id}
      onClick={onClick}
      className={cn(
        "inline-flex items-baseline gap-0.5 px-1.5 py-0.5 rounded text-[13px] font-medium transition-colors",
        isActive
          ? "bg-indigo-500/25 text-white font-semibold"
          : cn(
              "hover:bg-white/5",
              cfg ? cfg.text : "text-slate-300",
            ),
      )}
    >
      <span>{san}</span>
      {cfg && cfg.symbol && !isActive && (
        <GradeDot grade={grade!} />
      )}
    </button>
  );
};
