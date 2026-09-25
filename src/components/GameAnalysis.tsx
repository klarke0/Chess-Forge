import React, { useState, useEffect, useMemo } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  Zap,
  Sparkles,
  AlertTriangle,
  GitBranch,
  ArrowUpDown,
  LayoutList,
  MoveUpRight,
} from "lucide-react";
import { UniversalBoard } from "./UniversalBoard";
import { ParsedGame } from "../services/pgn_parser";
import { useEngineStore } from "../stores/engineStore";
import { useRepertoireStore } from "../stores/repertoireStore";
import { useGameReview } from "../hooks/useGameReview";
import { cn } from "../utils/cn";
import { normalizeFen } from "../utils/normalizeFen";
import { Chess } from "chess.js";
import { request } from "../services/api";
import {
  GRADE_STYLE,
  REVIEW_ARROW_BEST,
  REVIEW_ARROW_PLAYED,
} from "../v2/GameReviewSummary";
import {
  ReviewMoveStrip,
  ReviewSheet,
  gradeChipClass,
  plyLabel,
  type StripMove,
} from "../v2/ReviewMoveStrip";

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

const formatEval = (cp: number | null | undefined, mate: number | null | undefined): string => {
  if (mate != null) return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  if (cp == null) return "0.0";
  const v = cp / 100;
  if (Math.abs(v) < 0.05) return "0.0";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
};

// Stored mate scores are clamped to +/-2000cp; show them as mate rather than "+20.0".
const formatStoredEval = (cp: number | null | undefined): string => {
  if (cp == null) return "0.0";
  if (Math.abs(cp) >= 2000) return cp > 0 ? "+M" : "-M";
  return formatEval(cp, null);
};

const FLAGGED_GRADES = new Set(["inaccuracy", "mistake", "miss", "blunder"]);
const ARROWS_PREF_KEY = "review-arrows";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Parse an engine UCI move ("e2e4", "e7e8q"); null when malformed. */
function parseUci(uci?: string | null) {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length === 5 ? uci[4] : undefined };
}

// --- Eval Bar (vertical, slim) ---
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
    <div
      role="img"
      aria-label={`Evaluation ${evalText}`}
      className="w-1.5 self-stretch bg-forge-elevated rounded-full overflow-hidden border border-forge-border-default flex flex-col shrink-0"
    >
      {/* Black section (top) */}
      <div
        className="w-full bg-forge-elevated motion-safe:transition-all motion-safe:duration-700 ease-out"
        style={{ height: `${100 - whitePct}%` }}
      />
      {/* White section (bottom) */}
      <div
        className="w-full bg-slate-100 motion-safe:transition-all motion-safe:duration-700 ease-out"
        style={{ height: `${whitePct}%` }}
      />
    </div>
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

const PieceDot: React.FC<{ color: "white" | "black" }> = ({ color }) => (
  <span
    aria-label={`${color} pieces`}
    role="img"
    className={cn(
      "inline-block w-2.5 h-2.5 rounded-full border shrink-0",
      color === "white" ? "bg-slate-100 border-slate-300" : "bg-forge-base border-forge-text-muted",
    )}
  />
);

const ctrlBtn =
  "h-12 min-w-[48px] flex items-center justify-center rounded-forge-md bg-forge-card border border-forge-border-subtle text-forge-text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer motion-safe:transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

const accuracyTone = (acc: number) =>
  acc >= 85 ? "text-forge-success" : acc >= 70 ? "text-forge-warning" : "text-forge-danger";

export const GameAnalysis: React.FC<GameAnalysisProps> = ({
  game,
  parsedGame,
  initialMoveIdx,
  onClose,
  onDrillDeviation,
  onSwitchToSummary,
}) => {
  const [currentMoveIdx, setCurrentMoveIdx] = useState(initialMoveIdx ?? -1);
  const [previewFen, setPreviewFen] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [sheet, setSheet] = useState<"moves" | "coach" | null>(null);
  const [arrowsOn, setArrowsOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ARROWS_PREF_KEY) !== "off";
    } catch {
      return true;
    }
  });

  const toggleArrows = () => {
    setArrowsOn((on) => {
      const next = !on;
      try {
        localStorage.setItem(ARROWS_PREF_KEY, next ? "on" : "off");
      } catch {
        /* storage unavailable — preference just isn't remembered */
      }
      return next;
    });
  };

  // Jump to the initial move on mount (the strip centres it itself)
  useEffect(() => {
    if (initialMoveIdx !== undefined && initialMoveIdx !== null && initialMoveIdx >= 0) {
      setCurrentMoveIdx(initialMoveIdx);
    }
  }, [initialMoveIdx]);

  // Stores
  const { engine, evaluate, evaluation } = useEngineStore();
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

  const baseFen = useMemo(() => {
    if (currentMoveIdx === -1) return STARTING_FEN;
    return movesList[currentMoveIdx]?.fenAfter || STARTING_FEN;
  }, [currentMoveIdx, movesList]);

  const currentFen = useMemo(() => previewFen || baseFen, [previewFen, baseFen]);

  // Only the user's own deviations are drillable (opponent deviations aren't
  // the user's decision to fix).
  const playerDeviations = useMemo(
    () => (game.deviations || []).filter((d) => d.side === "player"),
    [game.deviations],
  );

  // Jump the board to the position *before* the deviating move — the point
  // where the user had the choice.
  const goToDeviation = (dev: Deviation) => {
    const idx = movesList.findIndex(
      (m) => normalizeFen(m.fenBefore) === normalizeFen(dev.fen),
    );
    if (idx === -1) return;
    setPreviewFen(null);
    setCurrentMoveIdx(idx - 1);
    setSheet(null);
  };

  const userColor = game.userColor ?? (repertoireSide as "white" | "black");
  const opponentColor: "white" | "black" = userColor === "white" ? "black" : "white";
  const userUsername = userColor === "white" ? game.white : game.black;
  const opponentUsername = opponentColor === "white" ? game.white : game.black;
  const ratingFor = (color: "white" | "black") => {
    const r = parsedGame?.headers?.[color === "white" ? "WhiteElo" : "BlackElo"];
    return r && r !== "?" ? r : null;
  };
  const userRating = ratingFor(userColor);
  const opponentRating = ratingFor(opponentColor);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movesList.length]);

  // Keep the active move visible inside the full-list sheet while it's open
  useEffect(() => {
    if (sheet !== "moves" || currentMoveIdx < 0) return;
    const el = document.getElementById(`rv-move-${currentMoveIdx}`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [sheet, currentMoveIdx]);

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

  // Flat move data shared by the strip and the full-list sheet.
  const stripMoves = useMemo<StripMove[]>(
    () =>
      movesList.map((m, i) => ({
        idx: i,
        san: m.san,
        grade: getEffectiveGrade(i),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [movesList, reviewedMoves, repertoirePositions],
  );

  // Everything the caption + arrows need about the current move.
  const currentReview = useMemo(() => {
    if (currentMoveIdx < 0) return null;
    const played = movesList[currentMoveIdx];
    const reviewed = reviewedMoves[currentMoveIdx];
    const grade = getEffectiveGrade(currentMoveIdx);
    const flagged = !!grade && FLAGGED_GRADES.has(grade);

    let bestSan: string | null = null;
    let bestSquares: { from: string; to: string } | null = null;
    let playedSquares: { from: string; to: string } | null = null;
    // 401 older stored games have no bestMove — everything below no-ops.
    const best = flagged ? parseUci(reviewed?.bestMove) : null;
    const fenBefore =
      played?.fenBefore ??
      (currentMoveIdx === 0 ? STARTING_FEN : reviewedMoves[currentMoveIdx - 1]?.fen);
    if (fenBefore && played) {
      try {
        const m = new Chess(fenBefore).move(played.san);
        if (m) playedSquares = { from: m.from, to: m.to };
      } catch {
        /* unparseable SAN — no red arrow */
      }
    }
    if (best && fenBefore) {
      const samePlayed =
        playedSquares && playedSquares.from === best.from && playedSquares.to === best.to;
      if (!samePlayed) {
        bestSquares = { from: best.from, to: best.to };
        try {
          const m = new Chess(fenBefore).move({ from: best.from, to: best.to, promotion: best.promotion });
          bestSan = m?.san ?? null;
        } catch {
          /* leave bestSan null */
        }
      }
    }
    return {
      san: played?.san ?? reviewed?.san ?? "",
      grade,
      flagged,
      evalCp: reviewed?.eval,
      hasReview: !!reviewed,
      bestSan,
      bestSquares,
      playedSquares,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMoveIdx, movesList, reviewedMoves, repertoirePositions]);

  // Green = engine's best, red = what was played; only on flagged moves.
  const boardArrows = useMemo<[string, string, string][]>(() => {
    if (!arrowsOn || previewFen || !currentReview?.bestSquares) return [];
    const out: [string, string, string][] = [
      [currentReview.bestSquares.from, currentReview.bestSquares.to, REVIEW_ARROW_BEST],
    ];
    if (currentReview.playedSquares) {
      out.push([currentReview.playedSquares.from, currentReview.playedSquares.to, REVIEW_ARROW_PLAYED]);
    }
    return out;
  }, [arrowsOn, previewFen, currentReview]);

  const gradeStyle = currentReview?.grade ? GRADE_STYLE[currentReview.grade] : undefined;

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

  // The coach sheet only makes sense while the current move is a flagged one.
  useEffect(() => {
    if (sheet === "coach" && !mistakeCoachData) setSheet(null);
  }, [sheet, mistakeCoachData]);

  const selectMove = (idx: number) => {
    setPreviewFen(null);
    setCurrentMoveIdx(idx);
  };

  // Two-column move list data for the full-list sheet: [[white, black], ...]
  const moveRows = useMemo(() => {
    const rows: Array<{ moveNumber: number; white: StripMove; black: StripMove | null }> = [];
    for (let i = 0; i < stripMoves.length; i += 2) {
      rows.push({
        moveNumber: Math.floor(i / 2) + 1,
        white: stripMoves[i],
        black: stripMoves[i + 1] ?? null,
      });
    }
    return rows;
  }, [stripMoves]);

  const atStart = currentMoveIdx <= -1;
  const atEnd = currentMoveIdx >= movesList.length - 1;
  const hasAnalysis = reviewedMoves.length > 0;
  const boardOrientation = flipped ? opponentColor : userColor;

  return (
    <div className="absolute inset-0 z-50 bg-forge-base text-slate-200 font-outfit flex flex-col motion-safe:animate-in motion-safe:fade-in duration-300 overflow-hidden">
      {/* ── (1) Header: back · players · accuracy · summary ── */}
      <div className="shrink-0 flex items-center gap-0.5 px-1 min-h-[48px] bg-forge-surface border-b border-forge-border-subtle">
        <button
          onClick={onClose}
          aria-label="Close review"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-forge-md text-forge-text-secondary hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <X size={18} aria-hidden="true" />
        </button>

        <div className="flex-1 min-w-0 py-1">
          <p className="flex items-center gap-1.5 text-[12px] leading-tight min-w-0">
            <PieceDot color={userColor} />
            <span className="font-black text-forge-success truncate">
              {userUsername}
              {userRating && <span className="font-semibold"> ({userRating})</span>}
            </span>
            <span className="text-forge-text-muted shrink-0">vs</span>
            <PieceDot color={opponentColor} />
            <span className="font-bold text-forge-text-secondary truncate">
              {opponentUsername}
              {opponentRating && <span className="font-medium"> ({opponentRating})</span>}
            </span>
          </p>
          <p className="flex items-center gap-2 text-[10px] leading-tight mt-0.5">
            <span
              className={cn(
                "px-1.5 rounded-full border font-black uppercase",
                game.result === "win"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : game.result === "loss"
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    : "bg-slate-500/10 text-slate-400 border-slate-500/20",
              )}
            >
              {game.result}
            </span>
            {userAccuracy != null && opponentAccuracy != null ? (
              <span
                className="font-black tabular-nums"
                aria-label={`Accuracy: you ${Math.round(userAccuracy)}, opponent ${Math.round(opponentAccuracy)}`}
              >
                <span className="text-forge-text-muted font-bold uppercase tracking-wider">Acc </span>
                <span className={accuracyTone(userAccuracy)}>{Math.round(userAccuracy)}</span>
                <span className="text-forge-text-muted"> · </span>
                <span className="text-forge-text-secondary">{Math.round(opponentAccuracy)}</span>
              </span>
            ) : isFullAnalyzing ? (
              <span className="font-black text-indigo-400 uppercase tracking-widest tabular-nums motion-safe:animate-pulse">
                Analysing {progress.current}/{progress.total}
              </span>
            ) : null}
          </p>
        </div>

        {!isFullAnalyzing && !hasAnalysis && parsedGame && (
          <button
            onClick={() => analyzeGame(parsedGame)}
            className="min-h-[44px] flex items-center gap-1.5 px-2.5 text-indigo-400 border border-indigo-500/20 bg-indigo-600/20 hover:bg-indigo-600/30 rounded-forge-md text-[10px] font-black uppercase tracking-wider cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Zap size={12} aria-hidden="true" /> Analyze
          </button>
        )}
        {onSwitchToSummary && (
          <button
            onClick={onSwitchToSummary}
            aria-label="Back to game summary"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-forge-md text-forge-text-secondary hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <LayoutList size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* ── (2) Board: full width, slim eval bar on the left edge ── */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-2 py-1">
        <div
          className="w-full flex items-stretch gap-1.5"
          // Cap the width so the square board never outgrows a short viewport.
          style={{ maxWidth: "calc(100dvh - 240px)" }}
        >
          <VerticalEvalBar cp={evalCp} mate={evalMate} />
          <div className="flex-1 relative min-w-0">
            <UniversalBoard
              fen={currentFen}
              orientation={boardOrientation}
              playerColor={userColor}
              readonly={false}
              mobileControls
              arrows={boardArrows}
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
            {/* Return to game button when previewing */}
            {previewFen && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
                <button
                  onClick={() => setPreviewFen(null)}
                  className="min-h-[44px] flex items-center gap-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-2xl border border-indigo-400/30 cursor-pointer motion-safe:animate-in motion-safe:slide-in-from-bottom-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  <RotateCcw size={12} aria-hidden="true" /> Return to Game
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── (3) Caption: current move · quality · eval, plus arrows toggle ── */}
      <div className="shrink-0 flex items-center gap-2 pl-3 pr-1.5 min-h-[48px] bg-forge-surface border-t border-forge-border-subtle">
        <div className="flex-1 min-w-0" aria-live="polite" aria-atomic="true">
          {currentMoveIdx < 0 || !currentReview ? (
            <p className="text-[13px] font-black text-forge-text-secondary truncate">Start position</p>
          ) : (
            <>
              <p className="text-[13px] font-black truncate leading-tight">
                <span className="font-mono font-semibold text-forge-text-muted">{plyLabel(currentMoveIdx)}</span>{" "}
                <span className="text-forge-text-primary">{currentReview.san}</span>
                {gradeStyle ? (
                  <>
                    <span className="text-forge-text-muted font-semibold"> · </span>
                    <span className={gradeStyle.text}>{gradeStyle.label}</span>
                  </>
                ) : !currentReview.hasReview ? (
                  <span className="text-forge-text-muted font-semibold"> · Not analysed</span>
                ) : null}
                {currentReview.hasReview && (
                  <>
                    <span className="text-forge-text-muted font-semibold"> · </span>
                    <span className="tabular-nums text-forge-text-secondary">
                      {formatStoredEval(currentReview.evalCp)}
                    </span>
                  </>
                )}
              </p>
              {currentReview.bestSan && (
                <p className="text-[10px] leading-tight text-forge-text-muted font-semibold truncate">
                  Best was <span className={cn("font-black", GRADE_STYLE.best.text)}>{currentReview.bestSan}</span>
                </p>
              )}
            </>
          )}
        </div>

        {mistakeCoachData && (
          <button
            onClick={() => setSheet("coach")}
            aria-haspopup="dialog"
            aria-label="Explain this mistake"
            className="min-h-[44px] min-w-[52px] flex flex-col items-center justify-center gap-0.5 rounded-forge-md text-indigo-400 hover:bg-forge-card cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Sparkles size={16} aria-hidden="true" />
            <span className="text-[10px] font-black uppercase tracking-wider">Why?</span>
          </button>
        )}
        <button
          onClick={toggleArrows}
          aria-pressed={arrowsOn}
          aria-label="Show best-move arrows"
          className={cn(
            "min-h-[44px] min-w-[52px] flex flex-col items-center justify-center gap-0.5 rounded-forge-md border cursor-pointer motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
            arrowsOn
              ? "bg-forge-primary-muted text-forge-primary-hover border-forge-primary-border"
              : "bg-forge-card text-forge-text-muted border-forge-border-subtle",
          )}
        >
          <MoveUpRight size={16} aria-hidden="true" />
          <span className="text-[10px] font-black uppercase tracking-wider">
            Arrows {arrowsOn ? "on" : "off"}
          </span>
        </button>
      </div>

      {/* ── (4) Move strip: one scrollable line, full list in a sheet ── */}
      <ReviewMoveStrip
        moves={stripMoves}
        currentIdx={currentMoveIdx}
        onSelect={selectMove}
        onExpand={() => setSheet("moves")}
        expandHasBadge={playerDeviations.length > 0}
      />

      {/* ── (5) Controls: thumb-zone row ── */}
      <div className="shrink-0 grid grid-cols-5 gap-1.5 px-3 pt-2 pb-3 bg-forge-surface border-t border-forge-border-subtle">
        <button onClick={() => handleNav("start")} disabled={atStart} className={ctrlBtn} aria-label="First move"><ChevronsLeft size={20} aria-hidden="true" /></button>
        <button onClick={() => handleNav(-1)} disabled={atStart} className={ctrlBtn} aria-label="Previous move"><ChevronLeft size={20} aria-hidden="true" /></button>
        <button onClick={() => handleNav(1)} disabled={atEnd} className={ctrlBtn} aria-label="Next move"><ChevronRight size={20} aria-hidden="true" /></button>
        <button onClick={() => handleNav("end")} disabled={atEnd} className={ctrlBtn} aria-label="Last move"><ChevronsRight size={20} aria-hidden="true" /></button>
        <button onClick={() => setFlipped((f) => !f)} aria-pressed={flipped} className={ctrlBtn} aria-label="Flip board"><ArrowUpDown size={18} aria-hidden="true" /></button>
      </div>

      {/* ── Full move list (bottom sheet, closed by default) ── */}
      <ReviewSheet open={sheet === "moves"} title="Moves" onClose={() => setSheet(null)}>
        {/* Colour key — grade names are also in the caption and chip labels */}
        <div className="px-4 pt-3 flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Move quality colour key" role="group">
          {(["best", "excellent", "good", "inaccuracy", "mistake", "blunder"] as const).map((g) => (
            <span key={g} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-forge-text-muted">
              {/* Same tint + underline as the move chips, so Inaccuracy and Mistake read differently */}
              <span
                aria-hidden="true"
                className={cn("inline-block w-4 h-3 rounded-t-sm", gradeChipClass(g))}
              />
              {GRADE_STYLE[g].label}
            </span>
          ))}
        </div>

        {/* Positions where the game left the book. Tapping a row jumps the board to */}
        {/* the decision point; "Drill" queues it for spaced repetition. */}
        {playerDeviations.length > 0 && (
          <div className="px-3 pt-3">
            <div className="flex items-center gap-1.5 mb-1.5 px-1">
              <GitBranch size={11} className="text-amber-400 shrink-0" aria-hidden="true" />
              <span className="text-[10px] font-black uppercase tracking-wider text-forge-text-muted">
                Out of book
              </span>
              <span className="text-[10px] font-black text-amber-400">{playerDeviations.length}</span>
            </div>
            <div className="flex flex-col gap-1">
              {playerDeviations.map((dev) => (
                <div
                  key={`${dev.moveNumber}-${dev.playedSan}`}
                  className="flex items-center gap-2 rounded-forge-sm bg-forge-card border border-forge-border-subtle pl-2 pr-1"
                >
                  <button
                    onClick={() => goToDeviation(dev)}
                    className="flex-1 min-h-[44px] flex items-center gap-1.5 min-w-0 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <span className="text-[11px] font-mono text-forge-text-muted shrink-0">{dev.moveNumber}.</span>
                    <span className="text-[12px] font-black text-rose-400 shrink-0">{dev.playedSan}</span>
                    <span className="text-[10px] text-forge-text-muted shrink-0" aria-label="should be">→</span>
                    <span className="text-[12px] font-black text-emerald-400 truncate">{dev.repertoireSan}</span>
                  </button>
                  <button
                    onClick={() => onDrillDeviation(dev)}
                    className="shrink-0 min-h-[44px] flex items-center gap-1 rounded-forge-sm bg-indigo-500/15 border border-indigo-500/30 px-2.5 text-[10px] font-black uppercase tracking-wider text-indigo-300 hover:bg-indigo-500/25 cursor-pointer motion-safe:transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <Zap size={10} aria-hidden="true" />
                    Drill
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {moveRows.length === 0 ? (
          <p className="px-4 py-6 text-[10px] text-forge-text-muted uppercase tracking-widest font-black text-center">
            No moves yet
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-3 pt-3 leading-tight">
            {moveRows.map((row) => (
              <span key={row.moveNumber} className="inline-flex items-center gap-x-0.5">
                <span className="text-[12px] font-mono text-forge-text-muted select-none mr-0.5">{row.moveNumber}.</span>
                <MoveToken id={`rv-move-${row.white.idx}`} move={row.white} isActive={currentMoveIdx === row.white.idx} onClick={() => { selectMove(row.white.idx); }} />
                {row.black && (
                  <MoveToken id={`rv-move-${row.black.idx}`} move={row.black} isActive={currentMoveIdx === row.black.idx} onClick={() => { selectMove(row.black!.idx); }} />
                )}
              </span>
            ))}
          </div>
        )}
      </ReviewSheet>

      {/* ── Coach explanation (sheet — only mounted, and only fetched, once asked for) ── */}
      <ReviewSheet open={sheet === "coach" && !!mistakeCoachData} title="Why this move" onClose={() => setSheet(null)}>
        {mistakeCoachData && (
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
        )}
      </ReviewSheet>
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

const MISTAKE_GRADE_LABEL: Record<string, { title: string; chip: string; chipBg: string; chipText: string}> = {
  blunder: {
    title: "Why this was a blunder",
    chip: "Blunder",
    chipBg: "bg-rose-500/15 border-rose-500/30",
    chipText: "text-rose-300",
  },
  mistake: {
    title: "Why this was a mistake",
    chip: "Mistake",
    chipBg: "bg-orange-500/15 border-orange-500/30",
    chipText: "text-orange-300",
  },
  inaccuracy: {
    title: "Why this was an inaccuracy",
    chip: "Inaccuracy",
    chipBg: "bg-yellow-500/15 border-yellow-500/30",
    chipText: "text-yellow-300",
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
          {meta.chip}
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
        <div className="space-y-2 motion-safe:animate-pulse">
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

// --- Move Token (full-list sheet) ---
// Same tinted-chip language as the strip: SAN text only, grade shown by tint +
// underline (the legend and caption carry the names).
const MoveToken: React.FC<{
  id: string;
  move: StripMove;
  isActive: boolean;
  onClick: () => void;
}> = ({ id, move, isActive, onClick }) => {
  const label = move.grade ? GRADE_STYLE[move.grade]?.label : undefined;
  return (
    <button
      id={id}
      onClick={onClick}
      aria-current={isActive ? "true" : undefined}
      aria-label={`${plyLabel(move.idx)} ${move.san}${label ? `, ${label}` : ""}`}
      className={cn(
        "inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-2 rounded-t text-[13px] cursor-pointer motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
        gradeChipClass(move.grade),
        isActive
          ? "font-black text-white ring-2 ring-inset ring-forge-text-primary"
          : "font-semibold text-forge-text-primary hover:bg-forge-elevated",
      )}
    >
      {move.san}
    </button>
  );
};
