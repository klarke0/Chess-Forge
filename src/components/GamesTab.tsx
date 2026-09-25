import React, { useState, useEffect } from "react";
import {
  Database,
  FlaskConical,
  Trophy,
  Minus,
  X,
  Clock,
  ChevronRight,
  ChevronDown,
  Upload,
  RefreshCw,
  CheckCircle2,
  Cpu,
} from "lucide-react";
import { GameAnalysis, AnalyzedGame } from "./GameAnalysis";
import { ChessComModal } from "./ChessComModal";
import { PgnImportModal } from "./PgnImportModal";
import { GameReviewSummary } from "../v2/GameReviewSummary";
import { cn } from "../utils/cn";
import * as api from "../services/api";
import { useRepertoireStore } from "../stores/repertoireStore";
import { useBackgroundStore } from "../stores/backgroundStore";
import { PgnParser, ParsedGame } from "../services/pgn_parser";
import { computeDeviations } from "../utils/deviations";
import { normalizeFen } from "../utils/normalizeFen";
import { BackgroundAnalysisQueue } from "../services/background_analysis";

type GamesView = "database" | "summary" | "analysis";

interface GamesTabProps {
  onDrillDeviation: (fen: string) => void;
  initialGameId?: number | null;
  initialMoveIdx?: number | null;
  onAnalysisOpen?: () => void;
  onAnalysisClose?: () => void;
}

/** Games fetched per server page, and games revealed per "Show more" tap. */
const PAGE_SIZE = 100;
const SHOW_STEP = 15;

const TIME_CLASS_STYLES: Record<string, string> = {
  bullet: "text-red-400 bg-red-400/10",
  blitz: "text-amber-400 bg-amber-400/10",
  rapid: "text-emerald-400 bg-emerald-400/10",
  classical: "text-indigo-400 bg-indigo-400/10",
};

const resultBg = (result: string | null) => {
  if (result === "win")
    return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
  if (result === "loss")
    return "bg-rose-500/10 border-rose-500/20 text-rose-400";
  return "bg-slate-500/10 border-slate-500/20 text-slate-400";
};

const ResultIcon: React.FC<{ result: string | null }> = ({ result }) => {
  if (result === "win") return <Trophy size={12} />;
  if (result === "loss") return <X size={12} />;
  return <Minus size={12} />;
};

export const GamesTab: React.FC<GamesTabProps> = ({
  onDrillDeviation,
  initialGameId,
  initialMoveIdx,
  onAnalysisOpen,
  onAnalysisClose,
}) => {
  const [view, setView] = useState<GamesView>("database");
  const [games, setGames] = useState<api.GameRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(SHOW_STEP);
  const [hasMoreOnServer, setHasMoreOnServer] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showChessComModal, setShowChessComModal] = useState(false);
  const [showPgnModal, setShowPgnModal] = useState(false);
  const [showScanConfirm, setShowScanConfirm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterResult, setFilterResult] = useState<
    "all" | "win" | "loss" | "draw"
  >("all");
  const [filterType, setFilterType] = useState<
    "all" | "bullet" | "blitz" | "rapid" | "classical"
  >("all");
  const [filterOpening, setFilterOpening] = useState<string>("all");
  const [parsedGame, setParsedGame] = useState<ParsedGame | null>(null);
  const [analyzedGame, setAnalyzedGame] = useState<AnalyzedGame | null>(null);
  const [summaryMoves, setSummaryMoves] = useState<any[]>([]);
  const [loadingGameId, setLoadingGameId] = useState<number | null>(null);
  const [selectedMoveIdx, setSelectedMoveIdx] = useState<number | null>(null);
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const chessComUsername = useRepertoireStore((s) => s.chessComUsername);
  const { isAnalyzing, analyzedCount, totalInQueue } = useBackgroundStore();

  const loadGames = () => {
    setLoading(true);
    api
      .listGames(PAGE_SIZE, 0)
      .then((page) => {
        setGames(page);
        setHasMoreOnServer(page.length >= PAGE_SIZE);
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
  };

  // Next server page, once every already-loaded game is on screen.
  const loadMoreFromServer = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    api
      .listGames(PAGE_SIZE, games.length)
      .then((page) => {
        setGames((prev) => {
          const seen = new Set(prev.map((g) => g.id));
          return [...prev, ...page.filter((g) => !seen.has(g.id))];
        });
        setHasMoreOnServer(page.length >= PAGE_SIZE);
        setVisibleCount((n) => n + SHOW_STEP);
      })
      .catch(console.warn)
      .finally(() => setLoadingMore(false));
  };

  useEffect(() => {
    loadGames();
  }, []);

  useEffect(() => {
    if (initialGameId) {
      handleGameSelect(initialGameId);
      if (initialMoveIdx !== undefined && initialMoveIdx !== null) {
        setSelectedMoveIdx(initialMoveIdx);
      }
    }
  }, [initialGameId, initialMoveIdx]);

  const uniqueOpenings = React.useMemo(() => {
    const openings = new Set<string>();
    games.forEach((g) => {
      if (g.opening_class && g.opening_class !== "Other")
        openings.add(g.opening_class);
    });
    return Array.from(openings).sort();
  }, [games]);

  const filteredGames = React.useMemo(() => {
    return games.filter((g) => {
      const matchesSearch =
        !searchTerm ||
        [
          g.white_username,
          g.black_username,
          g.opening_name,
          g.eco,
          g.opening_class,
        ].some((field) =>
          field?.toLowerCase().includes(searchTerm.toLowerCase()),
        );

      const matchesResult = filterResult === "all" || g.result === filterResult;
      const matchesType = filterType === "all" || g.time_class === filterType;
      const matchesOpening =
        filterOpening === "all" || g.opening_class === filterOpening;

      return matchesSearch && matchesResult && matchesType && matchesOpening;
    });
  }, [games, searchTerm, filterResult, filterType, filterOpening]);

  // A new filter/search starts again from the first page of results.
  useEffect(() => {
    setVisibleCount(SHOW_STEP);
  }, [searchTerm, filterResult, filterType, filterOpening]);

  const visibleGames = filteredGames.slice(0, visibleCount);
  const remainingGames = filteredGames.length - visibleGames.length;

  const { availableRepertoires } = useRepertoireStore();

  const handleGameSelect = async (id: number) => {
    if (loadingGameId) return;
    try {
      setError(null);
      setLoadingGameId(id);
      setLoadingStep("Fetching game data from server...");

      const game = await api.getGame(id);
      if (!game || !game.pgn) {
        throw new Error(
          "Game data or PGN sequence is missing from the database.",
        );
      }

      setLoadingStep("Parsing PGN sequence...");
      // Small artificial delay to show the steps
      await new Promise((resolve) => setTimeout(resolve, 400));

      const parsedResults = PgnParser.parse(game.pgn);
      if (!parsedResults || parsedResults.length === 0) {
        throw new Error(
          "Failed to parse the PGN format. It might be corrupted.",
        );
      }

      const parsed = parsedResults[0];

      // ── Smart Repertoire Matching ──────────────────────────────────────────
      setLoadingStep("Matching with your repertoires...");
      const userSide = (game.user_color as "white" | "black") || "white";

      // Try to find a matching repertoire: matches side AND name contains opening class
      let targetRepertoire = availableRepertoires.find(
        (r) =>
          r.side === userSide &&
          game.opening_class &&
          r.name.toLowerCase().includes(game.opening_class.toLowerCase()),
      );

      // Fallback: match by side only if opening class match fails
      if (!targetRepertoire) {
        targetRepertoire = availableRepertoires.find(
          (r) => r.side === userSide,
        );
      }

      let activePositions = useRepertoireStore.getState().positions;
      let activeRepId = useRepertoireStore.getState().repertoireId;

      // If we found a better repertoire than the current active one, fetch its positions
      if (targetRepertoire && targetRepertoire.id !== activeRepId) {
        setLoadingStep(`Loading ${targetRepertoire.name} for analysis...`);
        const rawPositions = await api.getPositions(targetRepertoire.id);

        // Simple normalization
        const normalized: Record<string, any[]> = {};
        for (const [fen, moves] of Object.entries(rawPositions)) {
          normalized[normalizeFen(fen)] = moves as any[];
        }
        activePositions = normalized;
        activeRepId = targetRepertoire.id;
      }

      setLoadingStep("Opening Analysis Studio...");
      await new Promise((resolve) => setTimeout(resolve, 200));

      const deviations = computeDeviations(parsed, activePositions, userSide);

      // Auto-queue player deviations for spaced repetition (once per game) using the matched repertoire
      const playerDeviations = deviations.filter((d) => d.side === "player");
      const flagKey = `dev-flagged-${game.id}`;
      if (playerDeviations.length > 0 && !localStorage.getItem(flagKey)) {
        for (const d of playerDeviations) {
          api
            .recordAttempt(activeRepId, { fen: d.fen, correct: false })
            .catch(() => {});
        }
        localStorage.setItem(flagKey, "1");
      }

      const analyzed: AnalyzedGame = {
        id: String(game.id),
        white: game.white_username || "White",
        black: game.black_username || "Black",
        result: game.result || "*",
        date: game.date
          ? new Date(game.date).toLocaleDateString()
          : "Unknown Date",
        deviations,
        analysis_json: game.analysis_json,
        userColor: userSide,
      };

      // Parse reviewedMoves for the summary screen
      let moves: any[] = [];
      try {
        if (game.analysis_json) moves = JSON.parse(game.analysis_json);
      } catch { /* ignore */ }

      setParsedGame(parsed);
      setAnalyzedGame(analyzed);
      setSummaryMoves(moves);

      // Clear loading right before switching to avoid flicker
      setLoadingGameId(null);
      setLoadingStep("");
      // Show the summary screen first, then full analysis on "Start Review"
      setView("summary");
      onAnalysisOpen?.();
    } catch (e: any) {
      console.error("Failed to load game:", e);
      setError(
        e.message || "An unexpected error occurred while loading the game.",
      );
      setLoadingGameId(null);
      setLoadingStep("");
    }
  };

  const handleSync = async (username: string) => {
    setShowChessComModal(false);
    setSyncing(true);
    try {
      await api.syncGamesFromChessCom(username);
      await loadGames();
      // Automatically start background analysis for the new games
      BackgroundAnalysisQueue.start();
    } catch (e) {
      console.error("Sync failed:", e);
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncClick = () => {
    if (chessComUsername) handleSync(chessComUsername);
    else setShowChessComModal(true);
  };

  const handleUpload = async (pgn: string) => {
    setShowPgnModal(false);
    setSyncing(true);
    try {
      await api.uploadGamesPgn(pgn, chessComUsername || "");
      await loadGames();
      // Automatically start background analysis for the uploaded games
      BackgroundAnalysisQueue.start();
    } catch (e) {
      console.error("Upload failed:", e);
    } finally {
      setSyncing(false);
    }
  };

  const handleScanAll = async () => {
    setShowScanConfirm(false);
    try {
      // Clear all analysis locally
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("game-analysis-")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));

      // Clear from backend
      await api.clearAllAnalysis();
      await loadGames();
      BackgroundAnalysisQueue.start();
    } catch (e) {
      console.error("Failed to clear and scan all:", e);
      setError("Failed to initiate a fresh scan of all games.");
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#050507]">
      {/* Header — hidden on mobile when viewing analysis (GameAnalysis is fullscreen overlay) */}
      <div
        className={cn(
          "flex flex-col gap-2 px-4 py-2 border-b border-forge-border-subtle shrink-0",
          (view === "analysis" || view === "summary") && "hidden",
        )}
      >
        {/* Segmented Control — hidden on mobile (nav handled by clicking a game / close button) */}
        <div className="hidden bg-[#0a0d14] rounded-xl p-1 gap-1">
          <button
            onClick={() => setView("database")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
              view === "database"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                : "text-slate-500 hover:text-slate-300",
            )}
          >
            <Database size={13} /> Database
          </button>
          <button
            onClick={() => setView("analysis")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
              view === "analysis"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                : "text-slate-500 hover:text-slate-300",
            )}
          >
            <FlaskConical size={13} /> Analysis
          </button>
        </div>

        {view === "database" && (
          <>
            {/* Row 1: search + compact actions (scan status / stop lives here) */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search games…"
                  aria-label="Search games by ECO, player, or opening"
                  className="w-full h-11 bg-forge-card border border-forge-border-subtle rounded-xl pl-3 pr-11 text-sm text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition-all"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm("")}
                    aria-label="Clear search"
                    className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-slate-500 hover:text-slate-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-xl"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {isAnalyzing ? (
                <button
                  onClick={() => BackgroundAnalysisQueue.stop()}
                  aria-label={`Stop scan${totalInQueue > 0 ? `, ${analyzedCount} of ${totalInQueue} analysed` : ""}`}
                  className="flex items-center gap-1.5 h-11 px-3 shrink-0 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/20 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all motion-safe:animate-pulse cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <Cpu size={12} className="motion-safe:animate-spin" />
                  Stop{totalInQueue > 0 ? ` ${analyzedCount}/${totalInQueue}` : ""}
                </button>
              ) : (
                <button
                  onClick={() => setShowScanConfirm(true)}
                  aria-label="Scan all games"
                  className="flex items-center gap-1.5 h-11 px-3 shrink-0 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/20 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <Cpu size={12} />
                  Scan
                </button>
              )}

              <button
                onClick={handleSyncClick}
                disabled={syncing}
                aria-label="Sync games from Chess.com"
                className="flex items-center gap-1.5 h-11 px-3 shrink-0 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <RefreshCw
                  size={12}
                  className={syncing ? "motion-safe:animate-spin" : ""}
                />
                Sync
              </button>
              <button
                onClick={() => setShowPgnModal(true)}
                disabled={syncing}
                aria-label="Upload PGN file"
                className="flex items-center gap-1.5 h-11 px-3 shrink-0 bg-forge-card hover:bg-forge-elevated text-slate-400 border border-forge-border-subtle rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <Upload size={12} /> PGN
              </button>
            </div>

            {/* Row 2: filters as three compact selects (one row on phones) */}
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: "Filter by result",
                  value: filterResult,
                  onChange: (v: string) => setFilterResult(v as typeof filterResult),
                  options: [
                    ["all", "All results"],
                    ["win", "Wins"],
                    ["loss", "Losses"],
                    ["draw", "Draws"],
                  ],
                },
                {
                  label: "Filter by time control",
                  value: filterType,
                  onChange: (v: string) => setFilterType(v as typeof filterType),
                  options: [
                    ["all", "All types"],
                    ["bullet", "Bullet"],
                    ["blitz", "Blitz"],
                    ["rapid", "Rapid"],
                    ["classical", "Classical"],
                  ],
                },
                {
                  label: "Filter by opening",
                  value: filterOpening,
                  onChange: setFilterOpening,
                  options: [
                    ["all", "All openings"],
                    ...uniqueOpenings.map((op) => [op, op]),
                  ],
                },
              ].map((f) => (
                <div key={f.label} className="relative min-w-0">
                  <select
                    value={f.value}
                    onChange={(e) => f.onChange(e.target.value)}
                    aria-label={f.label}
                    className="w-full h-11 bg-forge-card border border-forge-border-subtle rounded-xl pl-3 pr-7 text-[10px] font-black uppercase tracking-wider text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 appearance-none cursor-pointer hover:bg-forge-elevated transition-all truncate"
                  >
                    {f.options.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={10}
                    aria-hidden="true"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Content */}
      {view === "database" ? (
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pt-3 pb-4 relative">
          {/* Error Banner */}
          {error && (
            <div className="mb-4 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-between gap-4 motion-safe:animate-in motion-safe:slide-in-from-top-2">
              <div className="flex items-center gap-3 text-rose-400">
                <X size={18} className="shrink-0" />
                <p className="text-xs font-bold">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Loading Overlay for fetching PGN */}
          {loadingGameId && (
            <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center motion-safe:animate-in fade-in duration-300">
              <div className="flex flex-col items-center gap-4 text-center">
                <div className="relative">
                  <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full" />
                  <RefreshCw
                    size={40}
                    className="text-indigo-500 motion-safe:animate-spin relative z-10"
                  />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-white mb-1">
                    Loading Analysis
                  </p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest motion-safe:animate-pulse">
                    {loadingStep}
                  </p>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-600 text-sm font-medium">
              Loading games...
            </div>
          ) : games.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
              <Database size={48} className="text-slate-700" />
              <div>
                <p className="text-slate-400 text-sm font-bold mb-1">
                  No games yet
                </p>
                <p className="text-slate-600 text-xs">
                  Sync from Chess.com or upload a PGN file.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSyncClick}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                >
                  <RefreshCw size={13} /> Sync Chess.com
                </button>
                <button
                  onClick={() => setShowPgnModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-400 border border-white/10 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                >
                  <Upload size={13} /> Upload PGN
                </button>
              </div>
            </div>
          ) : filteredGames.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Database size={48} className="text-slate-700 mb-4" />
              <p className="text-slate-400 text-sm font-bold">
                No matching games found
              </p>
              <button
                onClick={() => {
                  setSearchTerm("");
                  setFilterResult("all");
                  setFilterType("all");
                  setFilterOpening("all");
                  setError(null);
                }}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-widest mt-2"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                {visibleGames.length} of {filteredGames.length}{" "}
                {filteredGames.length === 1 ? "game" : "games"}
                {(searchTerm || filterResult !== "all") && " matching filters"}
              </p>
              <div className="space-y-1.5">
                {visibleGames.map((game) => (
                  <button
                    key={game.id}
                    onClick={() => handleGameSelect(game.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 min-h-[56px] bg-forge-card rounded-xl border border-forge-border-subtle hover:border-indigo-500/30 transition-all group text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    {/* W/L/D Badge */}
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center border shrink-0",
                        resultBg(game.result),
                      )}
                    >
                      <ResultIcon result={game.result} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 min-w-0">
                        <div
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-tighter shrink-0 border",
                            game.user_color === "white"
                              ? "bg-slate-100 text-slate-900 border-slate-200"
                              : "bg-slate-800 text-slate-100 border-forge-border-default",
                          )}
                        >
                          {game.user_color === "white" ? "W" : "B"}
                        </div>
                        <span className="text-sm font-bold text-slate-200 truncate min-w-0">
                          {game.white_username} vs {game.black_username}
                        </span>
                        {game.eco && (
                          <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">
                            {game.eco}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                        {game.time_class && (
                          <span
                            className={cn(
                              "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0",
                              TIME_CLASS_STYLES[game.time_class] ||
                                "text-slate-500 bg-slate-500/10",
                            )}
                          >
                            <Clock size={10} />
                            {game.time_class}
                          </span>
                        )}
                        {(game.opening_name ||
                          (game.opening_class &&
                            game.opening_class !== "Other")) && (
                          <span className="text-[10px] text-slate-400 font-medium truncate min-w-0 flex-1">
                            {game.opening_name || game.opening_class}
                          </span>
                        )}
                        {game.date && (
                          <span className="text-[10px] text-slate-500 font-mono shrink-0 ml-auto">
                            {new Date(game.date).toLocaleDateString()}
                          </span>
                        )}
                        {game.analysis_json && (
                          <span
                            className="text-emerald-500 flex items-center shrink-0"
                            title="Analysed"
                          >
                            <CheckCircle2 size={12} aria-hidden="true" />
                            <span className="sr-only">Analysed</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 w-4 h-4 flex items-center justify-center">
                      {loadingGameId === game.id ? (
                        <RefreshCw
                          size={14}
                          className="text-indigo-400 motion-safe:animate-spin"
                        />
                      ) : (
                        <ChevronRight
                          size={14}
                          className="text-slate-700 group-hover:text-slate-500 transition-colors"
                        />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {remainingGames > 0 ? (
                <button
                  onClick={() => setVisibleCount((n) => n + SHOW_STEP)}
                  className="w-full mt-3 min-h-[44px] bg-forge-card hover:bg-forge-elevated border border-forge-border-subtle rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  Show more ({remainingGames} left)
                </button>
              ) : (
                hasMoreOnServer && (
                  <button
                    onClick={loadMoreFromServer}
                    disabled={loadingMore}
                    className="w-full mt-3 min-h-[44px] bg-forge-card hover:bg-forge-elevated border border-forge-border-subtle rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    {loadingMore ? "Loading…" : "Load older games"}
                  </button>
                )
              )}
            </>
          )}
        </div>
      ) : view === "summary" ? (
        <div className="flex-1 overflow-hidden relative">
          {analyzedGame ? (
            <GameReviewSummary
              game={analyzedGame}
              reviewedMoves={summaryMoves}
              onClose={() => {
                setView("database");
                setAnalyzedGame(null);
                setParsedGame(null);
                setSummaryMoves([]);
                setSelectedMoveIdx(null);
                onAnalysisClose?.();
              }}
              onStartReview={() => setView("analysis")}
              onSwitchToReview={() => setView("analysis")}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500">
              <FlaskConical size={48} className="opacity-20" />
              <p className="text-sm font-bold uppercase tracking-[0.2em]">
                Select a game to review
              </p>
              <button
                onClick={() => setView("database")}
                className="px-6 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/20 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
              >
                Go to Database
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-hidden relative">
          {analyzedGame && parsedGame ? (
            <GameAnalysis
              game={analyzedGame}
              parsedGame={parsedGame}
              initialMoveIdx={selectedMoveIdx ?? undefined}
              onClose={() => {
                setView("database");
                setAnalyzedGame(null);
                setParsedGame(null);
                setSummaryMoves([]);
                setSelectedMoveIdx(null);
                onAnalysisClose?.();
              }}
              onDrillDeviation={(deviation) => onDrillDeviation(deviation.fen)}
              onSwitchToSummary={() => setView("summary")}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500">
              <FlaskConical size={48} className="opacity-20" />
              <p className="text-sm font-bold uppercase tracking-[0.2em]">
                Select a game to analyze
              </p>
              <button
                onClick={() => setView("database")}
                className="px-6 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/20 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
              >
                Go to Database
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showScanConfirm && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0a0d14] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl motion-safe:animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-white uppercase tracking-tight mb-2">
              Rescan All Games?
            </h3>
            <p className="text-slate-400 text-sm mb-6 leading-relaxed">
              This will{" "}
              <span className="text-rose-400 font-bold">
                clear all existing analysis
              </span>{" "}
              and start a fresh scan of every game in your database. This
              process may take a long time. Are you sure?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowScanConfirm(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleScanAll}
                className="flex items-center gap-2 px-4 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/20 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
              >
                <Cpu size={14} /> Clear & Scan All
              </button>
            </div>
          </div>
        </div>
      )}
      {showChessComModal && (
        <ChessComModal
          onClose={() => setShowChessComModal(false)}
          onSync={handleSync}
          isProcessing={syncing}
          initialUsername={chessComUsername || ""}
        />
      )}
      {showPgnModal && (
        <PgnImportModal
          onClose={() => setShowPgnModal(false)}
          onImport={handleUpload}
          isProcessing={syncing}
        />
      )}
    </div>
  );
};
