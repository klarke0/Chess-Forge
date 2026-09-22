import React, { useMemo, useState, useEffect, useRef } from "react";
import { X, Settings, Play, Brain, Lightbulb } from "lucide-react";
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

const MOVE_CATEGORIES = [
  {
    key: "brilliant",
    label: "Brilliant",
    symbol: "!!",
    bg: "bg-[#1baaa0]",
    text: "text-[#1baaa0]",
    border: "border-[#1baaa0]",
    grades: [] as string[], // not yet computed by engine, show 0
  },
  {
    key: "great",
    label: "Great",
    symbol: "!",
    bg: "bg-[#5b8dd9]",
    text: "text-[#5b8dd9]",
    border: "border-[#5b8dd9]",
    grades: ["excellent"],
  },
  {
    key: "best",
    label: "Best",
    symbol: "★",
    bg: "bg-[#6eb966]",
    text: "text-[#6eb966]",
    border: "border-[#6eb966]",
    grades: ["best"],
  },
  {
    key: "mistake",
    label: "Mistake",
    symbol: "?",
    bg: "bg-[#e07b38]",
    text: "text-[#e07b38]",
    border: "border-[#e07b38]",
    grades: ["mistake", "inaccuracy"],
  },
  {
    key: "miss",
    label: "Miss",
    symbol: "✗",
    bg: "bg-[#e05c5c]",
    text: "text-[#e05c5c]",
    border: "border-[#e05c5c]",
    // No direct equivalent in our grading — always 0
    grades: [] as string[],
  },
  {
    key: "blunder",
    label: "Blunder",
    symbol: "??",
    bg: "bg-[#cc3333]",
    text: "text-[#cc3333]",
    border: "border-[#cc3333]",
    grades: ["blunder"],
  },
];

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
}> = ({ username, isUser, size = "lg" }) => {
  const initials = username.slice(0, 2).toUpperCase();
  const dim = size === "lg" ? "w-20 h-20" : "w-14 h-14";
  const textSize = size === "lg" ? "text-2xl" : "text-base";
  const ring = isUser
    ? "ring-2 ring-[#6eb966] ring-offset-2 ring-offset-[#0d1117]"
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

const AICoachSummary: React.FC<{
  game: AnalyzedGame;
  reviewedMoves: ReviewedMove[];
  userColor: "white" | "black";
  visible: boolean;
}> = ({ game, reviewedMoves, userColor, visible }) => {
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
    <div className="px-4 pb-6 shrink-0">
      <div className="bg-forge-surface rounded-2xl border border-forge-border-subtle overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-forge-border-subtle">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600/30 to-indigo-600/30 border border-forge-insight-border flex items-center justify-center shrink-0">
            <Brain size={14} className="text-forge-insight" />
          </div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-forge-text-primary">
              AI Coach Summary
            </p>
            <p className="text-[9px] text-forge-text-muted font-medium">
              Key moments from your game
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-3 space-y-2">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-6 animate-pulse">
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
                    <span className={cn("text-[9px] font-black", style.text)}>
                      M{moment.moveNumber}
                    </span>
                  </div>

                  {/* Insight */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className={cn("text-[13px] font-black", style.text)}>
                        {moment.san}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-wider text-forge-text-muted">
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

        {/* Powered by tag */}
        {!loading && !error && moments.length > 0 && (
          <div className="flex items-center justify-center gap-1.5 py-2 border-t border-forge-border-subtle">
            <Lightbulb size={9} className="text-forge-text-muted" />
            <span className="text-[8px] text-forge-text-muted uppercase tracking-widest font-black">
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

  return (
    <div className="absolute inset-0 z-50 bg-forge-base text-forge-text-primary font-outfit flex flex-col animate-in fade-in duration-300 overflow-y-auto">
      {/* ── Header ── */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-forge-border-subtle hover:bg-forge-border-default text-forge-text-secondary hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
          <h1 className="text-lg font-black text-white tracking-tight">
            Game Review
          </h1>
          <div className="flex items-center gap-2">
            <button className="w-9 h-9 flex items-center justify-center rounded-full bg-forge-border-subtle hover:bg-forge-border-default text-forge-text-secondary hover:text-white transition-colors">
              <Settings size={16} />
            </button>
          </div>
        </div>

        {/* View toggle */}
        {onSwitchToReview && (
          <div className="flex items-center justify-center">
            <div className="flex bg-forge-base rounded-xl p-0.5 gap-0.5 border border-forge-border-subtle">
              <button
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all bg-forge-primary text-white shadow-lg shadow-indigo-600/20"
              >
                Summary
              </button>
              <button
                onClick={onSwitchToReview}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all text-forge-text-inactive hover:text-forge-text-primary"
              >
                Review
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Coach section ── */}
      <div className="flex items-start gap-3 px-4 pt-2 pb-4 shrink-0">
        {/* Coach avatar */}
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600/30 to-violet-600/30 border border-forge-primary-border flex items-center justify-center shrink-0 text-2xl">
          🧙
        </div>

        {/* Speech bubble */}
        <div className="relative flex-1 min-w-0">
          {/* Tail pointing left */}
          <div className="absolute -left-2 top-4 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-white" />
          <div className="bg-white text-forge-text-muted rounded-2xl rounded-tl-sm px-4 py-3 shadow-lg">
            <p className="text-[13px] font-semibold leading-snug">{coachMessage}</p>
          </div>
        </div>
      </div>

      {/* ── Eval graph ── */}
      <div className="px-4 pb-4 shrink-0">
        <div className="w-full h-[64px] rounded-xl overflow-hidden border border-forge-border-subtle bg-forge-surface relative">
          {hasAnalysis ? (
            <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="w-full h-full">
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

      {/* ── Player comparison ── */}
      <div className="px-4 pb-4 shrink-0">
        <div className="bg-forge-surface rounded-2xl border border-forge-border-subtle p-4">
          {/* Labels row */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center mb-3">
            <p className="text-[11px] font-black text-forge-text-inactive uppercase tracking-wider truncate text-center">
              {opponentUsername}
            </p>
            <div className="w-16" />
            <p className="text-[11px] font-black text-forge-text-inactive uppercase tracking-wider truncate text-center">
              {userUsername}
            </p>
          </div>

          {/* Avatars row */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mb-4">
            <div className="flex justify-center">
              <PlayerAvatar username={opponentUsername} isUser={false} />
            </div>
            <p className="text-[10px] font-black text-forge-text-muted uppercase tracking-widest text-center w-16">
              Players
            </p>
            <div className="flex justify-center">
              <PlayerAvatar username={userUsername} isUser={true} />
            </div>
          </div>

          {/* Accuracy row */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div
              className={cn(
                "rounded-xl py-3 text-center",
                "bg-forge-elevated border border-forge-border-subtle",
              )}
            >
              <p
                className={cn(
                  "text-2xl font-black tabular-nums",
                  hasAnalysis ? "text-white" : "text-forge-text-muted",
                )}
              >
                {hasAnalysis ? opponentAccuracy.toFixed(1) : "—"}
              </p>
            </div>
            <p className="text-[10px] font-black text-forge-text-muted uppercase tracking-widest text-center w-16">
              Accuracy
            </p>
            <div
              className={cn(
                "rounded-xl py-3 text-center",
                "bg-[#1a2e1a] border border-[#6eb966]/20",
              )}
            >
              <p
                className={cn(
                  "text-2xl font-black tabular-nums",
                  hasAnalysis ? "text-[#6eb966]" : "text-forge-text-muted",
                )}
              >
                {hasAnalysis ? userAccuracy.toFixed(1) : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Move quality breakdown ── */}
      <div className="px-4 pb-4 shrink-0">
        <div className="bg-forge-surface rounded-2xl border border-forge-border-subtle overflow-hidden">
          {MOVE_CATEGORIES.map((cat, idx) => {
            const opponentCount = countMoves(reviewedMoves, opponentColor, cat.grades);
            const userCount = countMoves(reviewedMoves, userColor, cat.grades);

            return (
              <div
                key={cat.key}
                className={cn(
                  "grid grid-cols-[1fr_56px_1fr] items-center px-4 py-3",
                  idx < MOVE_CATEGORIES.length - 1 &&
                    "border-b border-white/[0.04]",
                )}
              >
                {/* Left: opponent count */}
                <p
                  className={cn(
                    "text-lg font-black tabular-nums text-center",
                    opponentCount > 0 ? cat.text : "text-forge-text-muted",
                  )}
                >
                  {opponentCount}
                </p>

                {/* Center: badge */}
                <div className="flex flex-col items-center gap-0.5">
                  <div
                    className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center border-2 shrink-0",
                      cat.bg,
                      cat.border,
                    )}
                  >
                    <span className="text-white text-[11px] font-black leading-none">
                      {cat.symbol}
                    </span>
                  </div>
                  <span className="text-[8px] font-black uppercase tracking-wider text-forge-text-muted">
                    {cat.label}
                  </span>
                </div>

                {/* Right: user count */}
                <p
                  className={cn(
                    "text-lg font-black tabular-nums text-center",
                    userCount > 0 ? cat.text : "text-forge-text-muted",
                  )}
                >
                  {userCount}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── AI Coach Summary ── */}
      <AICoachSummary
        game={game}
        reviewedMoves={reviewedMoves}
        userColor={userColor}
        visible={true}
      />

      {/* ── Start Review CTA ── */}
      <div className="px-4 pb-6 shrink-0">
        <button
          onClick={onStartReview}
          className="w-full py-4 bg-[#5c9e3b] hover:bg-[#6ab544] active:bg-[#4e8832] text-white font-black text-base uppercase tracking-wide rounded-2xl transition-colors shadow-lg shadow-green-900/30 flex items-center justify-center gap-2"
        >
          <Play size={18} fill="white" />
          Start Review
        </button>
      </div>
    </div>
  );
};
