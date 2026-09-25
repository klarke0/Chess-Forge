import React, { useMemo, useState, useEffect, useRef } from "react";
import { X, Play, Brain, Lightbulb, ChevronDown } from "lucide-react";
import { cn } from "@/utils/cn";
import type { AnalyzedGame } from "@/components/GameAnalysis";
import type { ReviewedMove } from "@/hooks/useGameReview";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GameReviewSummaryProps {
  game: AnalyzedGame;
  reviewedMoves: ReviewedMove[];
  onClose: () => void;
  onStartReview: () => void;
  onSwitchToReview?: () => void;
}

// ─── AI Coach Summary Types ───────────────────────────────────────────────────

interface CoachMoment {
  moveNumber: number;
  san: string;
  insight: string;
  type: "blunder" | "best" | "missed" | "turning_point";
}

// ─── Move quality categories (chess.com style) ───────────────────────────────
// Deliberately mimics chess.com's own palette, so these literals are exempt
// from the forge-token lint rule. Reused by the review move strip / caption.

/* eslint-disable no-restricted-syntax */
export const MOVE_CATEGORIES = [
  {
    key: "brilliant",
    label: "Brilliant",
    bg: "bg-[#1baaa0]",
    text: "text-[#1baaa0]",
    border: "border-[#1baaa0]",
    tint: "bg-[#1baaa0]/25",
    tintSoft: "bg-[#1baaa0]/12",
    hex: "#1baaa0",
    grades: [] as string[], // not yet computed by engine, show 0
  },
  {
    key: "great",
    label: "Great",
    bg: "bg-[#5b8dd9]",
    text: "text-[#5b8dd9]",
    border: "border-[#5b8dd9]",
    tint: "bg-[#5b8dd9]/25",
    tintSoft: "bg-[#5b8dd9]/12",
    hex: "#5b8dd9",
    grades: ["excellent"],
  },
  {
    key: "best",
    label: "Best",
    bg: "bg-[#6eb966]",
    text: "text-[#6eb966]",
    border: "border-[#6eb966]",
    tint: "bg-[#6eb966]/25",
    tintSoft: "bg-[#6eb966]/12",
    hex: "#6eb966",
    grades: ["best"],
  },
  {
    key: "mistake",
    label: "Mistake",
    bg: "bg-[#e07b38]",
    text: "text-[#e07b38]",
    border: "border-[#e07b38]",
    tint: "bg-[#e07b38]/25",
    tintSoft: "bg-[#e07b38]/12",
    hex: "#e07b38",
    grades: ["mistake", "inaccuracy"],
  },
  {
    key: "miss",
    label: "Miss",
    bg: "bg-[#e05c5c]",
    text: "text-[#e05c5c]",
    border: "border-[#e05c5c]",
    tint: "bg-[#e05c5c]/25",
    tintSoft: "bg-[#e05c5c]/12",
    hex: "#e05c5c",
    // No direct equivalent in our grading — always 0
    grades: [] as string[],
  },
  {
    key: "blunder",
    label: "Blunder",
    bg: "bg-[#cc3333]",
    text: "text-[#cc3333]",
    border: "border-[#cc3333]",
    tint: "bg-[#cc3333]/25",
    tintSoft: "bg-[#cc3333]/12",
    hex: "#cc3333",
    grades: ["blunder"],
  },
];

const categoryByKey = (key: string) => MOVE_CATEGORIES.find((c) => c.key === key)!;

export interface GradeStyle {
  /** Human label for the engine grade (never colour-only). */
  label: string;
  text: string;
  border: string;
  /** Background tint for chips; softer for lower-severity grades. */
  tint: string;
  hex: string;
}

/** Per-engine-grade style, derived from the chess.com category palette above. */
export const GRADE_STYLE: Record<string, GradeStyle> = {
  excellent: { label: "Great", text: categoryByKey("great").text, border: categoryByKey("great").border, tint: categoryByKey("great").tintSoft, hex: categoryByKey("great").hex },
  best: { label: "Best", text: categoryByKey("best").text, border: categoryByKey("best").border, tint: categoryByKey("best").tintSoft, hex: categoryByKey("best").hex },
  good: { label: "Good", text: "text-forge-text-secondary", border: "border-transparent", tint: "", hex: "#94a3b8" },
  inaccuracy: { label: "Inaccuracy", text: categoryByKey("mistake").text, border: categoryByKey("mistake").border, tint: categoryByKey("mistake").tintSoft, hex: categoryByKey("mistake").hex },
  mistake: { label: "Mistake", text: categoryByKey("mistake").text, border: categoryByKey("mistake").border, tint: categoryByKey("mistake").tint, hex: categoryByKey("mistake").hex },
  blunder: { label: "Blunder", text: categoryByKey("blunder").text, border: categoryByKey("blunder").border, tint: categoryByKey("blunder").tint, hex: categoryByKey("blunder").hex },
};

/** Arrow colours for the review board: engine best move vs the move played. */
export const REVIEW_ARROW_BEST = categoryByKey("best").hex;
export const REVIEW_ARROW_PLAYED = categoryByKey("miss").hex;
/* eslint-enable no-restricted-syntax */

// ─── Accuracy calculation ────────────────────────────────────────────────────

function computeAccuracy(moves: ReviewedMove[], side: "white" | "black"): number {
  if (!moves.length) return 0;
  const sideIdxs = moves.reduce<number[]>((acc, _m, i) => {
    if ((i % 2 === 0 && side === "white") || (i % 2 === 1 && side === "black")) {
      acc.push(i);
    }
    return acc;
  }, []);

  if (!sideIdxs.length) return 0;

  const gradeScore: Record<string, number> = {
    best: 100,
    excellent: 90,
    good: 75,
    inaccuracy: 50,
    mistake: 25,
    blunder: 0,
  };

  const total = sideIdxs.reduce((sum, i) => {
    return sum + (gradeScore[moves[i].grade] ?? 50);
  }, 0);

  return Math.round((total / sideIdxs.length) * 10) / 10;
}

// ─── Count moves per category per side ───────────────────────────────────────

function countMoves(
  moves: ReviewedMove[],
  side: "white" | "black",
  grades: readonly string[],
): number {
  if (!grades.length) return 0;
  return moves.filter((m, i) => {
    const isSide =
      (i % 2 === 0 && side === "white") || (i % 2 === 1 && side === "black");
    return isSide && grades.includes(m.grade);
  }).length;
}

// ─── Eval graph points ────────────────────────────────────────────────────────

function buildGraphPath(moves: ReviewedMove[]): { pts: string; whitePoints: string; blackPoints: string } {
  if (!moves.length) return { pts: "", whitePoints: "", blackPoints: "" };
  const coords = moves.map((m, i) => ({
    x: ((i + 0.5) / moves.length) * 1000,
    y: 50 * (1 - Math.tanh(m.eval / 400)),
  }));
  const pts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  // White area: polygon from left-center through points to right-center, back along top
  const whitePoints = `0,50 ${pts} 1000,50 1000,0 0,0`;
  // Black area: polygon from left-center through points to right-center, back along bottom
  const blackPoints = `0,50 ${pts} 1000,50 1000,100 0,100`;
  return { pts, whitePoints, blackPoints };
}

// ─── Player avatar ────────────────────────────────────────────────────────────

const PlayerAvatar: React.FC<{
  username: string;
  isUser?: boolean;
  size?: "sm" | "lg";
}> = ({ username, isUser, size = "sm" }) => {
  const initials = username.slice(0, 2).toUpperCase();
  const dim = size === "lg" ? "w-14 h-14" : "w-10 h-10";
  const textSize = size === "lg" ? "text-xl" : "text-sm";
  const ring = isUser
    ? "ring-2 ring-[#6eb966] ring-offset-1 ring-offset-[#0d1117]"
    : "";

  return (
    <div
      className={cn(
        dim,
        textSize,
        ring,
        "rounded-xl flex items-center justify-center font-black uppercase shrink-0",
        isUser
          ? "bg-[#1a2e1a] text-[#6eb966]"
          : "bg-[#1a1a2e] text-[#5b8dd9]",
      )}
    >
      {initials}
    </div>
  );
};

// ─── Coach bubble ─────────────────────────────────────────────────────────────

function buildCoachMessage(
  reviewedMoves: ReviewedMove[],
  userAccuracy: number,
  userColor: "white" | "black",
): string {
  if (!reviewedMoves.length) {
    return "Let's take a look at your game together. Ready to review?";
  }

  const brilliantCount = 0; // not tracked yet
  const blunders = reviewedMoves.filter(
    (m, i) =>
      m.grade === "blunder" &&
      ((i % 2 === 0 && userColor === "white") ||
        (i % 2 === 1 && userColor === "black")),
  ).length;

  const bestMoves = reviewedMoves.filter(
    (m, i) =>
      m.grade === "best" &&
      ((i % 2 === 0 && userColor === "white") ||
        (i % 2 === 1 && userColor === "black")),
  ).length;

  if (brilliantCount > 0) {
    return `You had a brilliant move in this game! Let's see what else happened.`;
  }
  if (blunders === 0 && userAccuracy >= 85) {
    return `Clean game! Your accuracy of ${userAccuracy} is impressive. Let's review the highlights.`;
  }
  if (blunders >= 3) {
    return `A tough game — ${blunders} blunders to learn from. Every mistake is a lesson. Let's review!`;
  }
  if (bestMoves >= 10) {
    return `You played a lot of best moves in this game. Let's review and find the key moments.`;
  }
  return `You had a nice game here. Let's review the key moments together!`;
}

// ─── AI Coach Summary fetch ───────────────────────────────────────────────────

async function fetchAICoachSummary(
  game: AnalyzedGame,
  reviewedMoves: ReviewedMove[],
  userColor: "white" | "black",
): Promise<CoachMoment[]> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey || !reviewedMoves.length) return [];

  // Build a compact move list for the prompt
  const moveLines: string[] = [];
  for (let i = 0; i < reviewedMoves.length; i++) {
    const moveNum = Math.floor(i / 2) + 1;
    const side = i % 2 === 0 ? "White" : "Black";
    const m = reviewedMoves[i];
    moveLines.push(`${moveNum}${side === "White" ? "." : "..."} ${m.san} [${m.grade}, eval=${(m.eval / 100).toFixed(2)}]`);
  }

  const userUsername = userColor === "white" ? game.white : game.black;
  const opponentUsername = userColor === "white" ? game.black : game.white;

  const prompt = `You are a chess coach reviewing a game. The player "${userUsername}" (${userColor}) played against "${opponentUsername}". Result: ${game.result}.

Moves with grades and evaluations:
${moveLines.join("\n")}

Identify 3 to 5 key moments in this game. For each moment, provide:
- The move number and SAN notation
- A brief one-sentence plain-language insight about WHY this moment mattered

Focus on: the biggest blunder (if any), the best move played, and key missed opportunities.

Respond ONLY with a JSON array, no markdown, no code blocks, just raw JSON like this:
[{"moveNumber": 12, "san": "Nxf7", "type": "blunder", "insight": "This knight sacrifice loses a piece for nothing — the king was never actually in danger."},{"moveNumber": 18, "san": "Bd3", "type": "best", "insight": "A strong defensive move that plugged the diagonal and kept equality."}]

Valid types: "blunder", "best", "missed", "turning_point"`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
      }),
    },
  );

  if (!response.ok) throw new Error(`Gemini error: ${response.status}`);

  const data = await response.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Strip any accidental markdown fences
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned) as CoachMoment[];
}

// ─── Moment type styles ───────────────────────────────────────────────────────

const MOMENT_STYLES: Record<string, { bg: string; text: string; icon: string; border: string }> = {
  blunder: {
    bg: "bg-forge-danger-muted",
    text: "text-forge-danger",
    icon: "??",
    border: "border-forge-danger-border",
  },
  best: {
    bg: "bg-green-500/10",
    text: "text-[#6eb966]",
    icon: "★",
    border: "border-green-500/20",
  },
  missed: {
    bg: "bg-forge-warning-muted",
    text: "text-forge-warning",
    icon: "?!",
    border: "border-forge-warning-border",
  },
  turning_point: {
    bg: "bg-forge-primary-muted",
    text: "text-forge-primary-hover",
    icon: "⚡",
    border: "border-forge-primary-border",
  },
};

// ─── AI Coach Summary Section ─────────────────────────────────────────────────

// Collapsed by default: the (paid) Gemini request only fires once the user
// expands it, and the summary screen stays one phone-screen tall.
const AICoachSummary: React.FC<{
  game: AnalyzedGame;
  reviewedMoves: ReviewedMove[];
  userColor: "white" | "black";
}> = ({ game, reviewedMoves, userColor }) => {
  const [open, setOpen] = useState(false);
  const visible = open;
  const [moments, setMoments] = useState<CoachMoment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!visible || fetchedRef.current || !reviewedMoves.length) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(null);

    fetchAICoachSummary(game, reviewedMoves, userColor)
      .then((result) => {
        setMoments(result);
      })
      .catch((e) => {
        console.error("AI Coach Summary error:", e);
        setError("Could not load AI insights. Check your Gemini API key.");
      })
      .finally(() => setLoading(false));
  }, [visible, reviewedMoves.length]);

  if (!import.meta.env.VITE_GEMINI_API_KEY) {
    return null;
  }

  return (
    <div className="px-3 pb-2 shrink-0">
      <div className="bg-forge-surface rounded-2xl border border-forge-border-subtle overflow-hidden">
        {/* Header (disclosure) */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="ai-coach-summary-body"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "w-full min-h-[44px] flex items-center gap-2.5 px-3 py-1.5 text-left cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400",
            open && "border-b border-forge-border-subtle",
          )}
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600/30 to-indigo-600/30 border border-forge-insight-border flex items-center justify-center shrink-0">
            <Brain size={14} className="text-forge-insight" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-forge-text-primary">
              AI Coach Summary
            </p>
            <p className="text-[10px] text-forge-text-muted font-medium truncate">
              Key moments from your game
            </p>
          </div>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn(
              "shrink-0 text-forge-text-muted motion-safe:transition-transform motion-safe:duration-200",
              open && "rotate-180",
            )}
          />
        </button>

        {/* Content */}
        {open && (
        <div id="ai-coach-summary-body" className="p-3 space-y-2">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-6 motion-safe:animate-pulse">
              <Brain size={28} className="text-forge-insight" />
              <p className="text-[10px] font-black uppercase tracking-widest text-forge-text-muted">
                Analyzing key moments...
              </p>
            </div>
          ) : error ? (
            <div className="py-4 text-center">
              <p className="text-[11px] text-forge-text-inactive italic">{error}</p>
            </div>
          ) : moments.length === 0 && !loading ? (
            <div className="py-4 text-center">
              <p className="text-[11px] text-forge-text-muted italic">
                {reviewedMoves.length
                  ? "No key moments identified."
                  : "Run analysis first to get AI insights."}
              </p>
            </div>
          ) : (
            moments.map((moment, idx) => {
              const style = MOMENT_STYLES[moment.type] ?? MOMENT_STYLES.turning_point;
              return (
                <div
                  key={idx}
                  className={cn(
                    "flex gap-3 p-3 rounded-xl border",
                    style.bg,
                    style.border,
                  )}
                >
                  {/* Move badge */}
                  <div className="shrink-0 flex flex-col items-center gap-1 pt-0.5">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-[11px]",
                        style.bg,
                        "border",
                        style.border,
                      )}
                    >
                      {style.icon}
                    </div>
                    <span className={cn("text-[10px] font-black", style.text)}>
                      M{moment.moveNumber}
                    </span>
                  </div>

                  {/* Insight */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className={cn("text-[13px] font-black", style.text)}>
                        {moment.san}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-wider text-forge-text-muted">
                        {moment.type.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-[12px] text-forge-text-primary leading-snug">
                      {moment.insight}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
        )}

        {/* Powered by tag */}
        {open && !loading && !error && moments.length > 0 && (
          <div className="flex items-center justify-center gap-1.5 py-2 border-t border-forge-border-subtle">
            <Lightbulb size={9} className="text-forge-text-muted" />
            <span className="text-[10px] text-forge-text-muted uppercase tracking-widest font-black">
              Powered by Gemini
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const GameReviewSummary: React.FC<GameReviewSummaryProps> = ({
  game,
  reviewedMoves,
  onClose,
  onStartReview,
  onSwitchToReview,
}) => {
  const userColor = game.userColor ?? "white";
  const opponentColor = userColor === "white" ? "black" : "white";

  const userUsername =
    userColor === "white" ? game.white : game.black;
  const opponentUsername =
    opponentColor === "white" ? game.white : game.black;

  const userAccuracy = useMemo(
    () => computeAccuracy(reviewedMoves, userColor),
    [reviewedMoves, userColor],
  );
  const opponentAccuracy = useMemo(
    () => computeAccuracy(reviewedMoves, opponentColor),
    [reviewedMoves, opponentColor],
  );

  const graphPath = useMemo(
    () => buildGraphPath(reviewedMoves),
    [reviewedMoves],
  );

  const coachMessage = useMemo(
    () => buildCoachMessage(reviewedMoves, userAccuracy, userColor),
    [reviewedMoves, userAccuracy, userColor],
  );

  const hasAnalysis = reviewedMoves.length > 0;

  // Blunder dots only — keep graph clean
  const blunderDots = useMemo(() => {
    if (!hasAnalysis) return [];
    return reviewedMoves
      .map((m, i) => {
        if (m.grade !== "blunder") return null;
        const cx = ((i + 0.5) / reviewedMoves.length) * 1000;
        const cy = 50 * (1 - Math.tanh(m.eval / 400));
        return { cx, cy, key: i };
      })
      .filter(Boolean) as { cx: number; cy: number; key: number }[];
  }, [reviewedMoves, hasAnalysis]);

  const FOCUS =
    "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-forge-base";

  const sides = [
    { key: "opp", name: opponentUsername, accuracy: opponentAccuracy, isUser: false },
    { key: "you", name: userUsername, accuracy: userAccuracy, isUser: true },
  ];

  return (
    <div className="absolute inset-0 z-50 bg-forge-base text-forge-text-primary font-outfit flex flex-col motion-safe:animate-in motion-safe:fade-in duration-300 overflow-y-auto">
      {/* ── Header: close + Summary/Review toggle (one 44px row) ── */}
      <div className="shrink-0 flex items-center gap-2 px-3 pt-2 pb-1">
        <button
          onClick={onClose}
          aria-label="Close game review"
          className={cn(
            FOCUS,
            "min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-forge-border-subtle hover:bg-forge-border-default text-forge-text-secondary hover:text-white transition-colors",
          )}
        >
          <X size={18} />
        </button>
        <h1 className="sr-only">Game Review</h1>
        <div className="flex-1 flex items-center justify-center">
          {onSwitchToReview ? (
            <div className="flex bg-forge-base rounded-xl p-0.5 gap-0.5 border border-forge-border-subtle">
              <button
                aria-pressed="true"
                className={cn(
                  FOCUS,
                  "min-h-[44px] flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all bg-forge-primary text-white shadow-lg shadow-indigo-600/20",
                )}
              >
                Summary
              </button>
              <button
                onClick={onSwitchToReview}
                className={cn(
                  FOCUS,
                  "min-h-[44px] flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all text-forge-text-inactive hover:text-forge-text-primary",
                )}
              >
                Review
              </button>
            </div>
          ) : (
            <span className="text-sm font-black text-white tracking-tight" aria-hidden="true">
              Game Review
            </span>
          )}
        </div>
        {/* Spacer so the toggle stays centred against the close button */}
        <div className="w-11 shrink-0" aria-hidden="true" />
      </div>

      {/* ── Coach one-liner ── */}
      <div className="flex items-center gap-2.5 px-3 py-1.5 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600/30 to-violet-600/30 border border-forge-primary-border flex items-center justify-center shrink-0 text-lg" aria-hidden="true">
          🧙
        </div>
        <div className="relative flex-1 min-w-0">
          <div className="absolute -left-1.5 top-3 w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-r-[6px] border-r-white" />
          <div className="bg-white text-forge-text-muted rounded-xl rounded-tl-sm px-3 py-1.5 shadow-lg">
            <p className="text-[12px] font-semibold leading-snug">{coachMessage}</p>
          </div>
        </div>
      </div>

      {/* ── Eval graph ── */}
      <div className="px-3 py-1.5 shrink-0">
        <div
          className="w-full h-[48px] rounded-xl overflow-hidden border border-forge-border-subtle bg-forge-surface relative"
          role="img"
          aria-label={hasAnalysis ? "Evaluation graph across the game" : "Analysis not yet available"}
        >
          {hasAnalysis ? (
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="w-full h-full" aria-hidden="true">
              <defs>
                <clipPath id="clip-white"><rect x="0" y="0" width="1000" height="50" /></clipPath>
                <clipPath id="clip-black"><rect x="0" y="50" width="1000" height="50" /></clipPath>
              </defs>
              {/* White advantage area (above center) */}
              <polygon
                points={graphPath.whitePoints}
                fill="rgba(240,240,240,0.82)"
                clipPath="url(#clip-white)"
              />
              {/* Black advantage area (below center) */}
              <polygon
                points={graphPath.blackPoints}
                fill="rgba(30,30,40,0.95)"
                clipPath="url(#clip-black)"
              />
              {/* Eval line */}
              <polyline
                points={graphPath.pts}
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth="1.5"
              />
              {/* Center line */}
              <line x1="0" y1="50" x2="1000" y2="50" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
              {/* Blunder dots only */}
              {blunderDots.map((d) => (
                <circle key={d.key} cx={d.cx} cy={d.cy} r="5" fill="#cc3333" fillOpacity="0.85" />
              ))}
            </svg>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-[11px] text-forge-text-muted uppercase tracking-widest font-black">
                Analysis not yet available
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Players + accuracy (one compact row) ── */}
      <div className="px-3 py-1.5 shrink-0">
        <div className="grid grid-cols-2 gap-2">
          {sides.map((side) => (
            <div
              key={side.key}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-2.5 py-2 min-w-0",
                side.isUser
                  ? "bg-[#1a2e1a] border-[#6eb966]/20"
                  : "bg-forge-surface border-forge-border-subtle",
              )}
            >
              <PlayerAvatar username={side.name} isUser={side.isUser} />
              <div className="min-w-0">
                <p className="text-[10px] font-black text-forge-text-inactive uppercase tracking-wider truncate">
                  {side.name}
                </p>
                <p
                  className={cn(
                    "text-xl font-black tabular-nums leading-tight",
                    hasAnalysis
                      ? side.isUser
                        ? "text-[#6eb966]"
                        : "text-white"
                      : "text-forge-text-muted",
                  )}
                  aria-label={hasAnalysis ? `Accuracy ${side.accuracy.toFixed(1)}` : "Accuracy unavailable"}
                >
                  {hasAnalysis ? side.accuracy.toFixed(1) : "—"}
                  <span className="ml-1 text-[10px] font-black uppercase tracking-wider text-forge-text-muted">
                    acc
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Move quality: 3x2 tiles (you / opponent) ── */}
      <div className="px-3 py-1.5 shrink-0">
        <p className="text-[10px] font-black uppercase tracking-widest text-forge-text-muted mb-1.5">
          Move quality <span className="text-forge-text-inactive">· you / opponent</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {MOVE_CATEGORIES.map((cat) => {
            const opponentCount = countMoves(reviewedMoves, opponentColor, cat.grades);
            const userCount = countMoves(reviewedMoves, userColor, cat.grades);
            return (
              <div
                key={cat.key}
                role="group"
                aria-label={`${cat.label}: you ${userCount}, opponent ${opponentCount}`}
                className="min-h-[56px] rounded-xl border border-forge-border-subtle bg-forge-surface px-2.5 py-2 flex flex-col justify-between"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", cat.bg)} aria-hidden="true" />
                  <span className="text-[10px] font-black uppercase tracking-wider text-forge-text-muted truncate">
                    {cat.label}
                  </span>
                </div>
                <p className="tabular-nums leading-none">
                  <span
                    className={cn(
                      "text-xl font-black",
                      userCount > 0 ? cat.text : "text-forge-text-muted",
                    )}
                  >
                    {userCount}
                  </span>
                  <span className="text-[12px] font-bold text-forge-text-muted"> / {opponentCount}</span>
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── AI Coach Summary (collapsed until asked for) ── */}
      <div className="pt-1.5 shrink-0">
        <AICoachSummary
          game={game}
          reviewedMoves={reviewedMoves}
          userColor={userColor}
        />
      </div>

      {/* ── Start Review CTA (pinned to the thumb zone) ── */}
      <div className="px-3 pt-1.5 pb-3 mt-auto shrink-0">
        <button
          onClick={onStartReview}
          className={cn(
            FOCUS,
            "w-full min-h-[52px] bg-[#5c9e3b] hover:bg-[#6ab544] active:bg-[#4e8832] text-white font-black text-base uppercase tracking-wide rounded-2xl transition-colors shadow-lg shadow-green-900/30 flex items-center justify-center gap-2",
          )}
        >
          <Play size={18} fill="white" />
          Start Review
        </button>
      </div>
    </div>
  );
};
