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
import { useEngineStore } from "@/stores/engineStore";
import { useLichessMasters } from "@/hooks/useLichessMasters";
import { looseSan } from "@/utils/san";
import {
  InteractiveCoach,
  type CoachStep,
  type InteractiveCoachCallbacks,
} from "./InteractiveCoach";

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
  /**
   * Distinguishes whether the analysis card is explaining the user's ORIGINAL
   * in-game blunder (teaching state) vs. a mistake just made during the DRILL
   * (explanation state). Drives the card title and the wrong-move label.
   */
  mistakeContext?: "original" | "drill";
  /**
   * Optional beat-driven board callbacks. When provided AND the analyze
   * response includes a structured `steps` array, the prose paragraph is
   * replaced with an InteractiveCoach that dispatches each beat through
   * these callbacks. Without them, the prose path renders as before.
   */
  coachCallbacks?: InteractiveCoachCallbacks;
  /**
   * Extra context appended to the Gemini prompt server-side (e.g. punish-drill
   * framing explaining the opponent's blunder and what the student's wrong
   * move let them escape). Undefined for non-punish sources.
   */
  framing?: string;
}

interface BlunderAnalysis {
  concept: string;
  analysis: string;
  steps?: CoachStep[] | null;
}

interface ChallengeLine {
  rank: number;
  cp: number | null;
  mate: number | null;
  firstSan: string;
  pvSan: string;
}

type ChallengeState = "idle" | "loading" | "confirmed" | "ambiguous";

interface ChallengeCoach {
  outcome: "confirmed" | "corrected";
  deeperAnalysis: string;
  newCorrectSan?: string;
  drillAdjusted?: boolean;
}

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
  mistakeContext = "drill",
  coachCallbacks,
  framing,
}) => {
  const needsExplanation = revealed || wrongMove !== null;

  const [analysis, setAnalysis] = useState<BlunderAnalysis | null>(null);
  const [loading, setLoading] = useState(needsExplanation);
  const [error, setError] = useState(false);

  const { data: mastersData, loading: mastersLoading } = useLichessMasters(needsExplanation ? fen : "");

  const [challengeState, setChallengeState] = useState<ChallengeState>("idle");
  const [challengeLines, setChallengeLines] = useState<ChallengeLine[]>([]);
  const [challengeCoach, setChallengeCoach] = useState<ChallengeCoach | null>(null);
  const [challengeCoachLoading, setChallengeCoachLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Engine for the Challenge button. Prefer the shared engineStore engine so
  // we don't spawn a fresh Stockfish worker per drill card (multiple workers
  // can clobber each other's onmessage stream and waste mobile CPU). Only
  // spawn a local fallback if the store hasn't initialized yet, and quit it
  // on unmount only if we own it.
  const engineRef = useRef<StockfishEngine | null>(null);
  const ownsEngineRef = useRef(false);

  useEffect(() => {
    return () => {
      if (ownsEngineRef.current) {
        engineRef.current?.quit();
      }
      engineRef.current = null;
      ownsEngineRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!needsExplanation) return;
    setLoading(true);
    setError(false);
    setAnalysis(null);

    request<BlunderAnalysis>("/analyze/blunder", {
      method: "POST",
      body: JSON.stringify({ fen, wrongMove, correctMove, cpLoss, phase, framing }),
    })
      .then(setAnalysis)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [fen, wrongMove, correctMove, cpLoss, phase, needsExplanation, framing]);

  async function handleChallenge() {
    if (challengeState !== "idle") return;
    setChallengeState("loading");

    if (!engineRef.current) {
      const shared = useEngineStore.getState().engine;
      if (shared) {
        engineRef.current = shared;
        ownsEngineRef.current = false;
      } else {
        engineRef.current = new StockfishEngine();
        ownsEngineRef.current = true;
      }
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

    // Fire deeper-coaching call. If confirmed → richer "why it's right"
    // explanation. If ambiguous → engine's better move + drill adjustment.
    const engineBestSan = line1?.firstSan ?? "";
    if (engineBestSan) {
      setChallengeCoachLoading(true);
      try {
        const data = await request<ChallengeCoach>("/v2/challenge-move", {
          method: "POST",
          body: JSON.stringify({
            fen,
            storedCorrectSan: correctMove,
            engineBestSan,
            engineBestPvSan: line1?.pvSan ?? "",
            isStoredCorrect: isConfirmed,
            engineCp: line1?.cp ?? null,
            engineSecondCp: line2?.cp ?? null,
            repertoireId,
          }),
        });
        setChallengeCoach(data);
      } catch {
        // Network/AI failure — leave the engine-only panel as-is.
      } finally {
        setChallengeCoachLoading(false);
      }
    }
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
      <div className="flex flex-col gap-4 p-6 bg-emerald-950/20 border-t border-emerald-500/20 rounded-[2.5rem]">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
          <p className="text-sm font-semibold text-emerald-300">First try — nice work.</p>
        </div>
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
    <div className="flex flex-col gap-2 p-4 bg-forge-card border-t border-forge-border-subtle rounded-[2.5rem] animate-slideUp">
      {/* Header: title + concept badge (or move number if provided).
          We render the icon, title text, and concept pill inline as siblings
          (no wrapper around icon+title) so the badge can hug the title on the
          same line instead of wrapping to its own row when the header text is
          long ("Why your original move failed" + "PROPHYLAXIS"). The badge is
          intentionally small enough to fit on the same row at iPhone widths. */}
      <div className="flex items-center gap-1.5 min-w-0">
        <Sparkles size={16} className="text-indigo-400 shrink-0" />
        <span className="text-xs font-black uppercase tracking-wider text-slate-100 min-w-0 truncate">
          {mistakeContext === "original"
            ? "Why your original move failed"
            : "Why your drill move failed"}
        </span>
        {moveNumber != null ? (
          <span className="ml-auto text-[10px] font-bold text-slate-500 shrink-0">
            Move {moveNumber}
          </span>
        ) : analysis?.concept ? (
          <span
            className={cn(
              "ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider shrink-0",
              "bg-amber-500/10 text-amber-400 border border-amber-500/20",
            )}
          >
            {analysis.concept}
          </span>
        ) : null}
      </div>

      {/* Move comparison with explicit context label — Played → Best on one row */}
      <div className="flex items-center gap-3 text-sm flex-wrap">
        {wrongMove && (
          <span className="flex items-center gap-1.5 text-rose-400 font-mono font-bold">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span className="text-[10px] uppercase tracking-wider text-rose-300/70 font-sans">
              {mistakeContext === "original" ? "Played:" : "Played:"}
            </span>
            {wrongMove}
          </span>
        )}
        {wrongMove && <ChevronRight size={14} className="text-slate-600" />}
        <span className="flex items-center gap-1.5 text-emerald-400 font-mono font-bold">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-[10px] uppercase tracking-wider text-emerald-300/70 font-sans">
            Best:
          </span>
          {correctMove}
        </span>
        {/* Eval bar inline with chips — pushed to the right; saves a full row */}
        {cpLoss !== null && cpLoss > 0 && !loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500 ml-auto min-w-[110px]">
            <div className="flex-1 h-1.5 rounded-full bg-forge-border-subtle overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  cpLoss > 2
                    ? "bg-rose-500"
                    : cpLoss > 1
                      ? "bg-amber-500"
                      : "bg-slate-600",
                )}
                style={{ width: `${Math.min(100, Math.abs(cpLoss) * 20)}%` }}
              />
            </div>
            <span className="tabular-nums text-slate-400 shrink-0">-{Math.abs(cpLoss).toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-6 w-32 bg-forge-border-subtle rounded-full" />
          <div className="h-4 w-full bg-forge-border-subtle rounded-full" />
          <div className="h-4 w-3/4 bg-forge-border-subtle rounded-full" />
        </div>
      )}

      {/* Analysis content */}
      {!loading && analysis && (
        <>
          {/* (concept badge promoted to header row above to save vertical space) */}
          {/* Ambiguity hedge — surfaced when Challenge flagged the position */}
          {challengeState === "ambiguous" && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-200 leading-relaxed">
                <span className="font-black uppercase tracking-wider">Heads up — </span>
                the engine isn't confident here. The coach analysis below assumes{" "}
                <span className="font-mono font-bold">{correctMove}</span> is best, but
                multiple moves evaluate similarly. Treat the explanation as one plausible
                line, not a forced sequence.
              </p>
            </div>
          )}
          {/* Coach analysis — prefer the interactive walkthrough when the
              backend returned validated steps AND the parent provided board
              callbacks. Otherwise fall back to the prose paragraph (legacy
              path, always present so a Gemini hiccup never leaves an empty
              card). */}
          {analysis.steps &&
          analysis.steps.length > 0 &&
          coachCallbacks &&
          challengeState !== "ambiguous" ? (
            <InteractiveCoach
              steps={analysis.steps}
              {...coachCallbacks}
            />
          ) : (
            <div
              className={cn(
                "rounded-xl border px-4 py-3 transition-opacity",
                challengeState === "ambiguous"
                  ? "border-forge-border-default bg-forge-elevated opacity-80"
                  : "border-indigo-500/20 bg-indigo-950/30",
              )}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={12} className={cn("shrink-0", challengeState === "ambiguous" ? "text-slate-500" : "text-indigo-400")} />
                <span className={cn("text-[10px] font-black uppercase tracking-widest", challengeState === "ambiguous" ? "text-slate-500" : "text-indigo-400")}>
                  Coach Analysis{challengeState === "ambiguous" ? " (low confidence)" : ""}
                </span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                {analysis.analysis}
              </p>
            </div>
          )}
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

      {/* (CP loss bar promoted inline with the chip row above to save vertical space) */}

      {/* Masters stats widget */}
      {needsExplanation && (mastersLoading || (mastersData && mastersData.moves.length > 0)) && (
        <div className="rounded-2xl border border-forge-border-subtle bg-forge-elevated p-4">
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
                  <div className="h-3 w-8 bg-forge-border-subtle rounded" />
                  <div className="h-3 flex-1 bg-forge-border-subtle rounded" />
                  <div className="h-3 w-10 bg-forge-border-subtle rounded" />
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
                      <div className="flex-1 h-1.5 bg-forge-border-subtle rounded-full overflow-hidden">
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
              "bg-forge-border-subtle border-forge-border-default animate-pulse",
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

              {/* Deeper coach analysis triggered by challenge */}
              {challengeCoachLoading && (
                <div className="flex items-center gap-2 text-slate-400 text-xs pt-1">
                  <Loader2 size={12} className="animate-spin shrink-0" />
                  <span>Coach is going deeper...</span>
                </div>
              )}
              {challengeCoach && (
                <div
                  className={cn(
                    "rounded-xl border px-3 py-2.5 mt-1",
                    challengeCoach.outcome === "confirmed"
                      ? "border-emerald-500/30 bg-emerald-950/30"
                      : "border-amber-500/30 bg-amber-950/30",
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles
                      size={12}
                      className={cn(
                        "shrink-0",
                        challengeCoach.outcome === "confirmed"
                          ? "text-emerald-400"
                          : "text-amber-400",
                      )}
                    />
                    <span
                      className={cn(
                        "text-[10px] font-black uppercase tracking-widest",
                        challengeCoach.outcome === "confirmed"
                          ? "text-emerald-400"
                          : "text-amber-400",
                      )}
                    >
                      {challengeCoach.outcome === "confirmed"
                        ? "Why it's right"
                        : `Better move — ${challengeCoach.newCorrectSan ?? ""}`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {challengeCoach.deeperAnalysis}
                  </p>
                  {challengeCoach.outcome === "corrected" &&
                    challengeCoach.drillAdjusted && (
                      <p className="text-[10px] mt-2 font-bold uppercase tracking-wider text-emerald-400">
                        ✓ Drill updated — future sessions will test{" "}
                        {challengeCoach.newCorrectSan}
                      </p>
                    )}
                  {challengeCoach.outcome === "corrected" &&
                    !challengeCoach.drillAdjusted && (
                      <p className="text-[10px] mt-2 text-slate-500">
                        (Drill not adjusted — repertoire context missing)
                      </p>
                    )}
                </div>
              )}

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
      <div className="flex items-center gap-3 mt-1">
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
              "bg-forge-border-subtle border border-forge-border-default text-slate-400",
              "hover:text-slate-200 hover:bg-forge-border-default",
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
              ? "bg-forge-border-subtle border border-forge-border-default text-slate-300 hover:bg-forge-border-default"
              : "bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/20 text-white",
            onReplay ? "font-bold text-sm" : "font-black uppercase tracking-widest text-sm",
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
