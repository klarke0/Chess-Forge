import React, { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  AlertTriangle,
  Sparkles,
  RotateCcw,
  X,
  ShieldQuestion,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Chess } from "chess.js";
import { cn } from "@/utils/cn";
import { request } from "@/services/api";
import { StockfishEngine } from "@/services/engine";
import { useLichessMasters } from "@/hooks/useLichessMasters";

interface BlunderExplanationProps {
  fen: string;
  wrongMove: string | null;
  correctMove: string;
  cpLoss: number | null;
  phase?: string;
  revealed: boolean;
  onNext: () => void;
  nextLabel?: string;
  moveNumber?: number;
  onReplay?: () => void;
  onClose?: () => void;
  onDismiss?: () => void;
  repertoireId?: number;
}

interface BlunderAnalysis {
  concept: string;
  analysis: string;
}

interface ChallengeLine {
  rank: number;
  cp: number | null;
  mate: number | null;
  firstSan: string;
  pvSan: string;
}

type ChallengeState = "idle" | "loading" | "confirmed" | "ambiguous";

function uciPvToSan(fen: string, uciPv: string, maxMoves = 3): string {
  const uciMoves = uciPv.split(" ").slice(0, maxMoves);
  try {
    const chess = new Chess(fen);
    const sanMoves: string[] = [];
    for (const uci of uciMoves) {
      if (uci.length < 4) break;
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] ?? "q",
      });
      if (!move) break;
      sanMoves.push(move.san);
    }
    return sanMoves.join(" ");
  } catch {
    return "";
  }
}

function formatCp(cp: number | null, mate: number | null): string {
  if (mate !== null) return mate > 0 ? `+M${mate}` : `-M${Math.abs(mate)}`;
  if (cp === null) return "?";
  const pawns = cp / 100;
  return pawns >= 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1);
}

function looseSan(san: string) {
  return san.replace(/[+#x]/g, "").trim();
}

export const BlunderExplanation: React.FC<BlunderExplanationProps> = ({
  fen,
  wrongMove,
  correctMove,
  cpLoss,
  phase,
  revealed,
  onNext,
  nextLabel = "Next",
  moveNumber,
  onReplay,
  onClose,
  onDismiss,
  repertoireId,
}) => {
  const needsExplanation = revealed || wrongMove !== null;

  const [analysis, setAnalysis] = useState<BlunderAnalysis | null>(null);
  const [loading, setLoading] = useState(needsExplanation);
  const [error, setError] = useState(false);

  const { data: mastersData, loading: mastersLoading } = useLichessMasters(needsExplanation ? fen : "");

  const [challengeState, setChallengeState] = useState<ChallengeState>("idle");
  const [challengeLines, setChallengeLines] = useState<ChallengeLine[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const engineRef = useRef<StockfishEngine | null>(null);

  useEffect(() => {
    return () => {
      engineRef.current?.quit();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!needsExplanation) return;
    setLoading(true);
    setError(false);
    setAnalysis(null);

    request<BlunderAnalysis>("/analyze/blunder", {
      method: "POST",
      body: JSON.stringify({ fen, wrongMove, correctMove, cpLoss, phase }),
    })
      .then(setAnalysis)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [fen, wrongMove, correctMove, cpLoss, phase, needsExplanation]);

  async function handleChallenge() {
    if (challengeState !== "idle") return;
    setChallengeState("loading");

    if (!engineRef.current) {
      engineRef.current = new StockfishEngine();
      await engineRef.current.waitUntilReady();
    }

    const rawLines = await engineRef.current.evaluateMultiPV(fen, 20, 3);

    const lines: ChallengeLine[] = rawLines.map((l) => ({
      rank: l.rank,
      cp: l.cp,
      mate: l.mate,
      firstSan: uciPvToSan(fen, l.pv, 1),
      pvSan: uciPvToSan(fen, l.pv, 3),
    }));

    setChallengeLines(lines);

    // Confirmed if correctMove matches rank-1 AND gap to rank-2 >= 20cp
    const line1 = lines.find((l) => l.rank === 1);
    const line2 = lines.find((l) => l.rank === 2);
    const correctMatchesLine1 =
      line1 && looseSan(line1.firstSan) === looseSan(correctMove);
    const gap =
      line1?.cp !== null && line2?.cp !== null && line1 && line2
        ? line1.cp! - line2.cp!
        : 999;

    const isConfirmed = correctMatchesLine1 && gap >= 20;
    setChallengeState(isConfirmed ? "confirmed" : "ambiguous");
  }

  function handleDismiss() {
    if (dismissed || !repertoireId) return;
    setDismissed(true);
    request("/v2/dismiss-position", {
      method: "POST",
      body: JSON.stringify({ fen, repertoireId, reason: "challenged" }),
    }).catch(() => {});
    onDismiss?.();
  }

  // Clean correct — no explanation needed
  if (!needsExplanation) {
    return (
      <div className="flex flex-col gap-4 p-6 bg-[#0d1117] border-t border-white/5 rounded-[2.5rem]">
        <p className="text-sm text-slate-500">Keep it up.</p>
        <button
          onClick={onClose ?? onNext}
          className={cn(
            "w-full flex items-center justify-center gap-2",
            "bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]",
            "text-white font-black uppercase tracking-widest text-sm",
            "py-4 rounded-xl transition-all min-h-[44px]",
            "border border-indigo-400/20",
          )}
        >
          {nextLabel} <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6 bg-[#0d1117] border-t border-white/5 rounded-[2.5rem] animate-slideUp">
      {/* Header: icon + move number */}
      <div className="flex items-center gap-2">
        <Sparkles size={20} className="text-indigo-400" />
        {moveNumber != null && (
          <span className="text-lg font-black text-slate-100">
            Move {moveNumber}
          </span>
        )}
      </div>

      {/* Move comparison */}
      <div className="flex items-center gap-3 text-sm">
        {wrongMove && (
          <span className="flex items-center gap-1.5 text-rose-400 font-mono font-bold">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            {wrongMove}
          </span>
        )}
        <ChevronRight size={14} className="text-slate-600" />
        <span className="flex items-center gap-1.5 text-emerald-400 font-mono font-bold">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          {correctMove}
        </span>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-6 w-32 bg-white/5 rounded-full" />
          <div className="h-4 w-full bg-white/5 rounded-full" />
          <div className="h-4 w-3/4 bg-white/5 rounded-full" />
        </div>
      )}

      {/* Analysis content */}
      {!loading && analysis && (
        <>
          {analysis.concept && (
            <span
              className={cn(
                "inline-flex self-start px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider",
                "bg-amber-500/10 text-amber-400 border border-amber-500/20",
              )}
            >
              {analysis.concept}
            </span>
          )}
          <p className="text-sm text-slate-300 leading-relaxed">
            {analysis.analysis}
          </p>
        </>
      )}

      {/* Error fallback */}
      {!loading && error && (
        <div className="flex items-start gap-2 text-sm text-slate-400">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
          <p>
            {cpLoss !== null && (
              <span className="text-rose-400 font-semibold">
                -{Math.abs(cpLoss).toFixed(1)} pawns.{" "}
              </span>
            )}
            Engine recommends{" "}
            <span className="text-emerald-400 font-mono font-bold">
              {correctMove}
            </span>
          </p>
        </div>
      )}

      {/* CP Loss indicator */}
      {cpLoss !== null && cpLoss > 0 && !loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <div
            className={cn(
              "h-1.5 rounded-full",
              cpLoss > 2
                ? "bg-rose-500"
                : cpLoss > 1
                  ? "bg-amber-500"
                  : "bg-slate-600",
            )}
            style={{ width: `${Math.min(100, Math.abs(cpLoss) * 20)}%` }}
          />
          <span>-{Math.abs(cpLoss).toFixed(1)} pawns</span>
        </div>
      )}

      {/* Masters stats widget */}
      {needsExplanation && (mastersLoading || (mastersData && mastersData.moves.length > 0)) && (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Masters Database
            </span>
            {mastersData && (
              <span className="text-[10px] text-slate-600">
                {mastersData.white + mastersData.draws + mastersData.black < 10
                  ? "Limited data"
                  : `${(mastersData.white + mastersData.draws + mastersData.black).toLocaleString()} games`}
              </span>
            )}
          </div>

          {mastersLoading && (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-3 w-8 bg-white/5 rounded" />
                  <div className="h-3 flex-1 bg-white/5 rounded" />
                  <div className="h-3 w-10 bg-white/5 rounded" />
                </div>
              ))}
            </div>
          )}

          {!mastersLoading && mastersData && mastersData.moves.length > 0 && (() => {
            const top = mastersData.moves.slice(0, 3);
            const maxFreq = Math.max(...top.map((m) => m.white + m.draws + m.black));
            return (
              <div className="space-y-2">
                {top.map((m) => {
                  const total = m.white + m.draws + m.black;
                  const grandTotal = mastersData.white + mastersData.draws + mastersData.black;
                  const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
                  const barW = maxFreq > 0 ? (total / maxFreq) * 100 : 0;
                  const isCorrect = looseSan(m.san) === looseSan(correctMove);
                  const wPct = total > 0 ? Math.round((m.white / total) * 100) : 0;
                  const dPct = total > 0 ? Math.round((m.draws / total) * 100) : 0;
                  const lPct = 100 - wPct - dPct;
                  return (
                    <div key={m.san} className="flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          "font-mono font-bold w-10 shrink-0",
                          isCorrect ? "text-emerald-400" : "text-slate-400",
                        )}
                      >
                        {m.san}
                      </span>
                      <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            isCorrect ? "bg-emerald-500/60" : "bg-slate-500/40",
                          )}
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                      <span className="text-slate-500 w-7 text-right tabular-nums">{pct}%</span>
                      <span className="text-slate-600 tabular-nums text-[10px] w-20 text-right">
                        W{wPct} D{dPct} L{lPct}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Challenge panel */}
      {challengeState !== "idle" && (
        <div
          className={cn(
            "rounded-2xl border p-4 space-y-3",
            challengeState === "loading" &&
              "bg-white/5 border-white/10 animate-pulse",
            challengeState === "confirmed" &&
              "bg-emerald-500/10 border-emerald-500/20",
            challengeState === "ambiguous" &&
              "bg-amber-500/10 border-amber-500/20",
          )}
        >
          {challengeState === "loading" && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin shrink-0" />
              <span>Verifying at depth 20...</span>
            </div>
          )}

          {(challengeState === "confirmed" ||
            challengeState === "ambiguous") && (
            <>
              <div className="flex items-center gap-2">
                {challengeState === "confirmed" ? (
                  <CheckCircle2 size={16} className="text-emerald-400" />
                ) : (
                  <AlertTriangle size={16} className="text-amber-400" />
                )}
                <span
                  className={cn(
                    "text-xs font-black uppercase tracking-wider",
                    challengeState === "confirmed"
                      ? "text-emerald-400"
                      : "text-amber-400",
                  )}
                >
                  {challengeState === "confirmed"
                    ? `Confirmed — ${correctMove} is best (depth 20)`
                    : "Ambiguous position — engine is not confident"}
                </span>
              </div>

              {/* Top 3 lines */}
              <div className="space-y-1.5">
                {challengeLines.map((line) => {
                  const isCorrect =
                    looseSan(line.firstSan) === looseSan(correctMove);
                  return (
                    <div
                      key={line.rank}
                      className={cn(
                        "flex items-center gap-2 text-xs font-mono",
                        line.rank === 1 ? "text-slate-200" : "text-slate-500",
                      )}
                    >
                      <span className="text-slate-600 w-4">#{line.rank}</span>
                      <span
                        className={cn(
                          "font-bold w-10",
                          isCorrect && "text-emerald-400",
                        )}
                      >
                        {line.firstSan || "—"}
                      </span>
                      <span
                        className={cn(
                          "w-12",
                          line.rank === 1 ? "text-slate-400" : "text-slate-600",
                        )}
                      >
                        ({formatCp(line.cp, line.mate)})
                      </span>
                      <span className="text-slate-600 truncate">
                        {line.pvSan}
                      </span>
                    </div>
                  );
                })}
              </div>

              {challengeState === "ambiguous" && !dismissed && (
                <button
                  onClick={handleDismiss}
                  className={cn(
                    "mt-1 w-full flex items-center justify-center gap-2",
                    "bg-amber-500/15 border border-amber-500/30 text-amber-300",
                    "text-xs font-black uppercase tracking-wider",
                    "py-2.5 rounded-xl transition-all min-h-[44px]",
                    "active:scale-[0.98]",
                  )}
                >
                  Remove from Drills
                </button>
              )}
              {dismissed && (
                <p className="text-xs text-slate-500 text-center">
                  Position removed from future sessions
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Action buttons: Replay + Challenge + Close */}
      <div className="flex items-center gap-3 mt-2">
        {onReplay && (
          <button
            onClick={onReplay}
            className={cn(
              "flex items-center justify-center gap-2 px-4",
              "bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]",
              "text-white font-bold text-sm",
              "py-3 rounded-xl transition-all min-h-[44px]",
              "border border-indigo-400/20",
            )}
          >
            <RotateCcw size={16} />
            Replay
          </button>
        )}

        {challengeState === "idle" && (
          <button
            onClick={handleChallenge}
            className={cn(
              "flex items-center justify-center gap-1.5 px-3",
              "bg-white/5 border border-white/10 text-slate-400",
              "hover:text-slate-200 hover:bg-white/10",
              "text-xs font-bold",
              "py-3 rounded-xl transition-all min-h-[44px]",
              "active:scale-[0.98]",
            )}
          >
            <ShieldQuestion size={14} />
            Challenge
          </button>
        )}

        <button
          onClick={onClose ?? onNext}
          className={cn(
            "flex-1 flex items-center justify-center gap-2",
            onReplay
              ? "bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10"
              : "bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/20 text-white",
            "font-black uppercase tracking-widest text-sm",
            "py-3 rounded-xl transition-all min-h-[44px]",
            "active:scale-[0.98]",
          )}
        >
          {onReplay ? (
            <>
              <X size={16} />
              Close
            </>
          ) : (
            <>
              {nextLabel} <ChevronRight size={18} />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
