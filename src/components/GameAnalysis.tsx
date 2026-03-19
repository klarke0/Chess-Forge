import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronRight, ChevronLeft, FastForward, Rewind,
  Brain, Zap, List, X, Target,
  Layout as LayoutIcon, RotateCcw, Search, PlayCircle, StopCircle, Cpu, Eye, ShieldAlert,
  ChevronDown, ChevronUp, RotateCw, Layers, BarChart2, Wand2, CheckCircle2, Activity
} from 'lucide-react';
import { UniversalBoard } from './UniversalBoard';
import { AnalysisCoachWidget } from './AnalysisCoachWidget';
import { ParsedGame } from '../services/pgn_parser';
import { useEngineStore } from '../stores/engineStore';
import { useCoachStore } from '../stores/coachStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useTrainingStore } from '../stores/trainingStore';
import { useGameReview } from '../hooks/useGameReview';
import { formatPV } from '../utils/chessLogic';
import { cn } from '../utils/cn';
import { Chess } from 'chess.js';
import { MoveTickerStrip, TickerMove } from './MoveTickerStrip';
import * as api from '../services/api';
import { generateRepertoireComment } from '../services/ai_coach';

// ... (rest of the preamble remains same)

// --- Types ---
export interface Deviation {
  moveNumber: number;
  fen: string;
  playedSan: string;
  repertoireSan: string;
  evalDiff: number;
  side: 'player' | 'opponent';
}

export interface AnalyzedGame {
  id: string;
  white: string;
  black: string;
  result: string;
  date: string;
  deviations: Deviation[];
  analysis_json?: string | null;
  userColor?: 'white' | 'black';
  game_shape?: string | null;
}

interface GameAnalysisProps {
  game: AnalyzedGame;
  parsedGame?: ParsedGame;
  initialMoveIdx?: number;
  onClose: () => void;
  onDrillDeviation: (deviation: Deviation) => void;
  onViewOnPlatform?: () => void;
}

// --- Components ---

const GRADE_COLORS: Record<string, { label: string; text: string; bg: string; border: string }> = {
  blunder:    { label: '??', text: 'text-rose-400',    bg: 'bg-rose-500/15',    border: 'border-rose-500/30' },
  mistake:    { label: '?',  text: 'text-orange-400',  bg: 'bg-orange-500/15',  border: 'border-orange-500/30' },
  inaccuracy: { label: '?!', text: 'text-yellow-300',  bg: 'bg-yellow-500/15',  border: 'border-yellow-500/30' },
  good:       { label: '',   text: 'text-slate-400',   bg: '',                  border: '' },
  excellent:  { label: '!',  text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20' },
  best:       { label: '✓',  text: 'text-green-400',   bg: 'bg-green-500/10',   border: 'border-green-500/20' },
};

const PlayerBadge: React.FC<{ name: string; color: 'white' | 'black' }> = ({ name, color }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/5 rounded-lg">
    <div className={cn("w-2 h-2 rounded-full", color === 'white' ? "bg-slate-200" : "bg-slate-800 border border-white/20")} />
    <span className="font-bold text-slate-300 text-[11px] truncate max-w-[120px]">{name}</span>
  </div>
);

const formatClock = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatEval = (evalCp: number): string => {
  const v = evalCp / 100;
  if (Math.abs(v) < 0.1) return '0.0';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
};

// --- Main Component ---

export const GameAnalysis: React.FC<GameAnalysisProps> = ({
  game,
  parsedGame,
  initialMoveIdx,
  onClose,
  onDrillDeviation,
}) => {
  // State
  const [currentMoveIdx, setCurrentMoveIdx] = useState(initialMoveIdx ?? -1);

  // Auto-scroll to initial move on mount or when it changes
  useEffect(() => {
    if (initialMoveIdx !== undefined && initialMoveIdx !== null && initialMoveIdx >= 0) {
      setCurrentMoveIdx(initialMoveIdx);
      setTimeout(() => {
        const moveEl = document.getElementById(`move-${initialMoveIdx}`);
        if (moveEl) {
          moveEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
    }
  }, [initialMoveIdx]);
  const [activeTab, setActiveTab] = useState<'coach' | 'engine'>('coach');
  const [previewFen, setPreviewFen] = useState<string | null>(null);
  const [isPlayingLine, setIsPlayingLine] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [evalExpanded, setEvalExpanded] = useState(false);
  const [coachActive, setCoachActive] = useState(false);
  const [mobileFlipped, setMobileFlipped] = useState(false);
  const [explorerData, setExplorerData] = useState<any>(null);
  const [isAddingToBook, setIsAddingToBook] = useState<string | null>(null); // san of the move being added
  const [threatData, setThreatData] = useState<{ 
    from: string; 
    to: string; 
    pv: string; 
    eval: number | null; 
    mate: number | null 
  } | null>(null);
  
  const playTimeoutRef = useRef<number | null>(null);
  const autoAnalyzeTimeoutRef = useRef<number | null>(null);
  const analyzedFens = useRef<Set<string>>(new Set());

  // Stores
  const { currentInsight, demoLine, isAnalyzing: isCoachAnalyzing, analyzePosition, clearInsight } = useCoachStore();
  const { engine, evaluate, topLines, showLines, toggleLines, showEvalBar, toggleEvalBar } = useEngineStore();
  const { repertoireId, positions: repertoirePositions, addPositionToStore } = useRepertoireStore();
  
  // Use a ref for topLines so handleAnalysisRequest identity stays stable
  const topLinesRef = useRef(topLines);
  useEffect(() => {
    topLinesRef.current = topLines;
  }, [topLines]);

  const { analysis: settings, toggleAnalysisVision, toggleAnalysisThreats } = useSettingsStore();
  const repertoireSide = useRepertoireStore(s => s.repertoireSide);
  const setStatus = useTrainingStore(s => s.setStatus);
  const { reviewedMoves, isAnalyzing: isFullAnalyzing, progress, analyzeGame } = useGameReview(game.id, game.analysis_json);
  const movesScrollRef = useRef<HTMLDivElement>(null);

  const { autoAnalyze, showThreats, showVision } = settings;

  // Derived
  const result = game.result;
  const movesList = useMemo(() => parsedGame?.moves || [], [parsedGame]);

  const baseFen = useMemo(() => {
    if (currentMoveIdx === -1) return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    return movesList[currentMoveIdx]?.fenAfter;
  }, [currentMoveIdx, movesList]);

  // Use previewFen if actively playing a line, otherwise baseFen
  const currentFen = previewFen || baseFen;

  const handleAddToRepertoire = async (san: string, nextFen: string, engineLine: string) => {
    if (!repertoireId || isAddingToBook) return;
    setIsAddingToBook(san);
    
    try {
      // 1. Generate GM comment via AI
      const comment = await generateRepertoireComment(currentFen, engineLine, explorerData, game.userColor || repertoireSide);
      
      // 2. Save to backend
      await api.addRepertoirePosition(repertoireId, {
        fen: currentFen,
        san,
        nextFen,
        comment
      });
      
      // 3. Update local store
      addPositionToStore(currentFen, san, nextFen, comment);
    } catch (e) {
      console.error("Failed to add to repertoire:", e);
    } finally {
      setIsAddingToBook(null);
    }
  };

  // Fetch Lichess Explorer data when FEN changes
  useEffect(() => {
    if (isPlayingLine) return;
    let active = true;
    const fetchExplorer = async () => {
      try {
        const data = await api.fetchLichessExplorer(currentFen);
        if (active) setExplorerData(data);
      } catch (e) {
        if (active) setExplorerData(null);
      }
    };
    fetchExplorer();
    return () => { active = false; };
  }, [currentFen]);

  const summary = useMemo(() => ({
    blunders: reviewedMoves.filter(m => m.grade === 'blunder').length,
    mistakes:  reviewedMoves.filter(m => m.grade === 'mistake').length,
    inaccuracies: reviewedMoves.filter(m => m.grade === 'inaccuracy').length,
  }), [reviewedMoves]);

  const playerDeviationFens = useMemo(
    () => new Set(game.deviations.filter(d => d.side === 'player').map(d => d.fen)),
    [game.deviations],
  );
  const opponentDeviationFens = useMemo(
    () => new Set(game.deviations.filter(d => d.side === 'opponent').map(d => d.fen)),
    [game.deviations],
  );

  // Orientation for mobile
  const mobileOrientation: 'white' | 'black' = mobileFlipped
    ? (game.userColor === 'white' ? 'black' : 'white')
    : (game.userColor ?? (repertoireSide as 'white' | 'black'));

  const handleMouseEnterLine = (line: string[]) => {
    if (isPlayingLine) return;
    const firstMove = line.slice(0, 1);
    jumpToLineEnd(firstMove);
  };

  const handleMouseLeaveLine = () => {
    if (isPlayingLine) return;
    setPreviewFen(null);
  };

  // Threat Detection: If it's our turn, what is the opponent threatening?
  useEffect(() => {
    if (!showThreats || !engine || isPlayingLine) {
      setThreatData(null);
      return;
    }

    const findThreat = async () => {
      // Create a FEN where it's the other player's turn
      const parts = baseFen.split(' ');
      const turn = parts[1];
      const otherTurn = turn === 'w' ? 'b' : 'w';
      parts[1] = otherTurn;
      const threatFen = parts.join(' ');

      try {
        const scan = await engine.evaluateOnce(threatFen, 12);
        if (scan && scan.bestMove) {
          setThreatData({
            from: scan.bestMove.slice(0, 2),
            to: scan.bestMove.slice(2, 4),
            pv: scan.pv,
            eval: scan.cp,
            mate: scan.mate
          });
        }
      } catch (e) {
        setThreatData(null);
      }
    };

    findThreat();
  }, [baseFen, showThreats, engine, isPlayingLine]);

  const arrows = useMemo(() => {
    const result: [string, string, string?][] = [];
    if (threatData) {
      result.push([threatData.from, threatData.to, 'rgba(244, 63, 94, 0.8)']); // Rose threat arrow
    }
    return result;
  }, [threatData]);

  // SVG polygon points for the Lichess-style eval chart
  const graphPoints = useMemo(() => {
    if (!reviewedMoves.length) return '';
    const pts = reviewedMoves.map((m, i) => {
      const y = 50 * (1 - Math.tanh((m as any).eval / 600));
      const x = ((i + 0.5) / reviewedMoves.length) * 1000;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `0,50 ${pts.join(' ')} 1000,50`;
  }, [reviewedMoves]);

  const tickerMoves = useMemo((): TickerMove[] => {
    return movesList.map((move, idx) => ({
      idx,
      san: move.san,
      grade: reviewedMoves[idx]?.grade,
      moveNumber: Math.floor(idx / 2) + 1,
      isWhite: idx % 2 === 0,
    }));
  }, [movesList, reviewedMoves]);

  // Handler for Analysis
  const handleAnalysisRequest = React.useCallback(async (force = false) => {
    console.log('[DEBUG] handleAnalysisRequest called. force:', force, 'currentFen:', currentFen, 'isCoachAnalyzing:', isCoachAnalyzing, 'isThinking:', isThinking);
    if (isCoachAnalyzing || isThinking) return;
    if (!force && analyzedFens.current.has(currentFen)) {
      console.log('[DEBUG] Bailing out because fen is already in analyzedFens set.');
      return;
    }
    setIsThinking(true);
    analyzedFens.current.add(currentFen);
    
    let engineContext = undefined;
    try {
      if (engine && topLinesRef.current.length > 0) {
        const best = topLinesRef.current[0];
        engineContext = {
          bestMove: best.pv.split(' ')[0],
          eval: best.mate ? `Mate in ${best.mate}` : `${(best.cp! / 100).toFixed(2)}`,
          line: best.pv
        };
      }
    } catch (_e) { /* engine unavailable */ }

    setIsThinking(false);
    const move = currentMoveIdx === -1 ? 'Start' : movesList[currentMoveIdx].san;
    const turn = currentFen.split(' ')[1] === 'w' ? 'White' : 'Black';
    
    console.log('[DEBUG] Calling analyzePosition');
    // For game analysis, we don't have a single repertoireMove set, 
    // but we can pass the userColor so the coach knows who to talk to.
    await analyzePosition(currentFen, move, turn, engineContext, undefined, game.userColor);
  }, [isCoachAnalyzing, isThinking, engine, currentMoveIdx, movesList, currentFen, analyzePosition, game.userColor]);

  const requestRef = useRef(handleAnalysisRequest);
  useEffect(() => {
    requestRef.current = handleAnalysisRequest;
  }, [handleAnalysisRequest]);

  const handleFullAnalysis = () => {
    if (parsedGame) analyzeGame(parsedGame);
  };

  // Line Playback
  const playLine = async (line: string[] | string) => {
    if (isPlayingLine) {
      stopLine();
      return;
    }
    
    setIsPlayingLine(true);
    setStatus('simulating');
    const tempGame = new Chess(baseFen);
    
    const moves = typeof line === 'string' ? line.split(' ') : line;
    
    for (const move of moves) {
      try {
        if (move.length >= 4 && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
          const from = move.slice(0, 2);
          const to = move.slice(2, 4);
          const promotion = move.length === 5 ? move[4] : undefined;
          tempGame.move({ from, to, promotion });
        } else {
          tempGame.move(move);
        }
        
        setPreviewFen(tempGame.fen());
        await new Promise(resolve => {
          playTimeoutRef.current = window.setTimeout(resolve, 800);
        });
      } catch (e) {
        break;
      }
    }
    
    setIsPlayingLine(false);
    setStatus('idle');
    playTimeoutRef.current = null;
  };

  const jumpToLineEnd = (line: string[] | string) => {
    const tempGame = new Chess(baseFen);
    const moves = typeof line === 'string' ? line.split(' ') : line;
    for (const move of moves) {
      try {
        if (move.length >= 4 && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
          const from = move.slice(0, 2);
          const to = move.slice(2, 4);
          const promotion = move.length === 5 ? move[4] : undefined;
          tempGame.move({ from, to, promotion });
        } else {
          tempGame.move(move);
        }
      } catch { break; }
    }
    setPreviewFen(tempGame.fen());
  };

  const jumpToDeviation = (d: Deviation) => {
    const idx = movesList.findIndex(m => m.fenBefore === d.fen);
    if (idx !== -1) {
      setCurrentMoveIdx(idx);
    }
  };

  const stopLine = () => {
    if (playTimeoutRef.current) window.clearTimeout(playTimeoutRef.current);
    playTimeoutRef.current = null;
    setIsPlayingLine(false);
    setPreviewFen(null);
  };

  const _handleNav = (delta: number | 'start' | 'end') => {
    if (delta === 'start') setCurrentMoveIdx(-1);
    else if (delta === 'end') setCurrentMoveIdx(movesList.length - 1);
    else setCurrentMoveIdx(prev => Math.max(-1, Math.min(movesList.length - 1, prev + delta)));
  };

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); _handleNav(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); _handleNav(1); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); _handleNav('start'); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); _handleNav('end'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [movesList.length]);

  // Effects
  useEffect(() => {
    if (movesScrollRef.current && currentMoveIdx >= 0) {
      const moveEl = document.getElementById(`move-${currentMoveIdx}`);
      if (moveEl) {
        moveEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    
    console.log('[DEBUG] useEffect triggered. coachActive:', coachActive, 'currentFen:', currentFen, 'alreadyAnalyzed:', analyzedFens.current.has(currentFen));
    if (!isPlayingLine && ((autoAnalyze && activeTab === 'coach') || coachActive) && !analyzedFens.current.has(currentFen)) {
      console.log('[DEBUG] Scheduling analysis');
      if (autoAnalyzeTimeoutRef.current) window.clearTimeout(autoAnalyzeTimeoutRef.current);
      autoAnalyzeTimeoutRef.current = window.setTimeout(() => {
        requestRef.current(false);
      }, 1000); // Slightly longer delay to allow engine to settle
    } else if (!autoAnalyze && !coachActive && !isPlayingLine) {
      console.log('[DEBUG] Clearing analyzedFens because autoAnalyze and coachActive are false');
      analyzedFens.current.clear();
      if (!isPlayingLine) clearInsight();
    }
    
    return () => {
      if (autoAnalyzeTimeoutRef.current) window.clearTimeout(autoAnalyzeTimeoutRef.current);
    };
  }, [currentFen, autoAnalyze, activeTab, coachActive, isPlayingLine]);

  // Stop animation/preview if we manually change moves or tabs
  useEffect(() => {
    stopLine();
  }, [currentMoveIdx, activeTab]);

  useEffect(() => {
    if (engine && !isPlayingLine) {
      evaluate(baseFen);
    }
  }, [baseFen, engine, evaluate, isPlayingLine]);

  // --- Render ---

  return (
    <div className="absolute inset-0 z-50 bg-[#050507] text-slate-200 font-outfit flex flex-col animate-in fade-in duration-300">
      {/* Top Bar */}
      <div className="h-10 lg:h-14 border-b border-white/5 flex items-center justify-between px-3 lg:px-6 bg-[#0a0d14] shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <LayoutIcon size={18} className="text-indigo-500" />
            <span className="font-black uppercase tracking-widest text-[10px] text-slate-400">Analysis Studio</span>
          </div>
          
          <div className="hidden md:flex items-center gap-3">
            <PlayerBadge name={game.white} color="white" />
            <span className="text-[10px] font-black text-slate-600">VS</span>
            <PlayerBadge name={game.black} color="black" />
          </div>
          
          <div className="hidden lg:flex items-center gap-2">
            <div className={cn('px-2 py-0.5 rounded-full border', result === 'win' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : result === 'loss' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20' )}>
              <span className="text-[9px] font-black uppercase">{result}</span>
            </div>
            {game.game_shape && (() => {
              const SHAPE_COLORS: Record<string, string> = {
                Smooth:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
                Balanced: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
                Sharp:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
                Wild:     'bg-rose-500/15 text-rose-400 border-rose-500/30',
                Sudden:   'bg-orange-500/15 text-orange-400 border-orange-500/30',
                Giveaway: 'bg-red-500/15 text-red-400 border-red-500/30',
                Intense:  'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
              };
              const color = SHAPE_COLORS[game.game_shape] ?? SHAPE_COLORS.Balanced;
              return (
                <span className={cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border', color)}>
                  {game.game_shape}
                </span>
              );
            })()}
          </div>

          {/* Summary Stats */}
          <div className="hidden lg:flex items-center gap-2 ml-4">
            {summary.blunders > 0 && <span className="px-2 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded text-[9px] font-black text-rose-400 uppercase">{summary.blunders} Blunders</span>}
            {summary.mistakes > 0 && <span className="px-2 py-0.5 bg-orange-500/10 border border-orange-500/20 rounded text-[9px] font-black text-orange-400 uppercase">{summary.mistakes} Mistakes</span>}
            {summary.inaccuracies > 0 && <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-[9px] font-black text-amber-200 uppercase">{summary.inaccuracies} Inacc.</span>}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {isFullAnalyzing && (
            <div className="flex items-center gap-3 bg-indigo-500/5 px-3 py-1.5 rounded-xl border border-indigo-500/10">
              <div className="w-20 h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
              </div>
              <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest animate-pulse">Scanning... {progress.current}/{progress.total}</span>
            </div>
          )}
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden flex-col lg:flex-row">
        
        {/* LEFT: Board Area */}
        <div className="flex-[1.5] flex flex-col bg-[#0d1117]/20 relative overflow-hidden min-w-0 min-h-0">
          <div className="flex-1 relative p-2 lg:p-4 min-h-0 flex items-center justify-center overflow-hidden">
            <div className="w-full h-full max-h-full max-w-full flex items-center justify-center relative">
              <UniversalBoard
                fen={currentFen}
                orientation={mobileOrientation}
                playerColor={game.userColor ?? (repertoireSide as 'white' | 'black')}
                readonly={false} // Allow making moves for analysis
                onDrop={(source, target) => {
                  // Allow exploring by making moves on the board and update the preview Fen.
                  const g = new Chess(currentFen);
                  try {
                    const m = g.move({ from: source, to: target, promotion: 'q' });
                    if (!m) return false;
                    setPreviewFen(g.fen());
                    return true;
                  } catch (e) { return false; }
                }}
                arrows={arrows}
                showThreatsControl
                onDeepAnalysis={handleAnalysisRequest}
                onDemoLine={playLine}
                mobileSquare
                mobileControls
              />
              
              {/* Return to Game Button Overlay */}
              {previewFen && (
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-40">
                  <button 
                    onClick={stopLine}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-black text-[9px] uppercase tracking-[0.2em] shadow-2xl border border-indigo-400/30 animate-in slide-in-from-bottom-4 transition-all"
                  >
                    <RotateCcw size={10} /> Return to Game
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Area: Nav + Chart */}
          <div className="px-4 lg:px-6 pb-4 pt-1 flex flex-col gap-3 items-center shrink-0 z-10 relative">
            {/* Nav Controls - Hidden on mobile, replaced by mobile toolbar */}
            <div className="hidden lg:flex items-center gap-1 bg-[#0d1117] border border-white/10 p-1.5 rounded-xl shadow-xl">
               <button onClick={() => _handleNav('start')} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all"><Rewind size={18} /></button>
               <button onClick={() => _handleNav(-1)} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all"><ChevronLeft size={20} /></button>
               <div className="h-6 w-[1px] bg-white/10 mx-2" />
               <button onClick={() => _handleNav(1)} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all"><ChevronRight size={20} /></button>
               <button onClick={() => _handleNav('end')} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-all"><FastForward size={18} /></button>
            </div>

            {/* Eval Chart — tap chevron to expand on mobile */}
            {reviewedMoves.length > 0 && (
              <div
                className={cn(
                  'w-full max-w-2xl relative rounded-lg overflow-hidden border border-white/5 bg-black/40 shrink-0 select-none transition-[height] duration-300',
                  evalExpanded ? 'h-24' : 'h-8 lg:h-[36px]',
                )}
              >
                <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="w-full h-full">
                  <rect x="0" y="0" width="1000" height="50" fill="rgba(255,255,255,0.03)" />
                  <rect x="0" y="50" width="1000" height="50" fill="rgba(0,0,0,0.2)" />
                  <line x1="0" y1="50" x2="1000" y2="50" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                  {graphPoints && (
                    <polygon points={graphPoints} fill="rgba(129, 140, 248, 0.4)" className="transition-all duration-500" />
                  )}
                  {/* Grade dots — only in expanded state, blunders/mistakes/inaccuracies only */}
                  {evalExpanded && reviewedMoves.map((m, i) => {
                    const dotColor =
                      m.grade === 'blunder'    ? '#f43f5e' :
                      m.grade === 'mistake'    ? '#fb923c' :
                      m.grade === 'inaccuracy' ? '#fde047' :
                      m.grade === 'excellent'  ? '#22d3ee' :
                      m.grade === 'best'       ? '#4ade80' : null;
                    if (!dotColor) return null;
                    const cx = ((i + 0.5) / reviewedMoves.length) * 1000;
                    const cy = 50 * (1 - Math.tanh((m as any).eval / 600));
                    return (
                      <circle key={i} cx={cx} cy={cy} r="5" fill={dotColor} fillOpacity="0.9" />
                    );
                  })}
                  {currentMoveIdx >= 0 && (
                    <line
                      x1={((currentMoveIdx + 0.5) / reviewedMoves.length) * 1000} y1="0"
                      x2={((currentMoveIdx + 0.5) / reviewedMoves.length) * 1000} y2="100"
                      stroke="#818cf8" strokeWidth="3"
                    />
                  )}
                </svg>
                {/* Seek overlay — whole strip except the chevron button */}
                <div
                  className="absolute top-0 left-0 bottom-0 right-7 lg:right-0 cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    setCurrentMoveIdx(Math.max(0, Math.min(reviewedMoves.length - 1, Math.floor(pct * reviewedMoves.length))));
                  }}
                />
                {/* Expand/collapse chevron — mobile only */}
                <button
                  className="lg:hidden absolute top-0 right-0 bottom-0 w-7 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                  onClick={() => setEvalExpanded(e => !e)}
                  aria-label={evalExpanded ? 'Collapse eval chart' : 'Expand eval chart'}
                >
                  {evalExpanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── MOBILE ONLY: Toolbar Row ───────────────────────────────────────── */}
        <div className="lg:hidden flex items-center gap-1 px-3 py-2 bg-[#0a0d14] border-t border-white/5 shrink-0">
          <button
            onClick={() => _handleNav(-1)}
            disabled={currentMoveIdx <= -1}
            className="p-2 rounded-xl bg-[#0d1117] border border-white/10 text-slate-400 hover:text-white disabled:opacity-20 transition-all active:scale-95"
            aria-label="Back"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => _handleNav('start')}
            className="p-2 rounded-xl bg-rose-600/10 border border-rose-500/20 text-rose-400 hover:bg-rose-600/20 transition-all active:scale-95"
            aria-label="Reset"
          >
            <RotateCw size={14} />
          </button>
          <button
            onClick={() => _handleNav(1)}
            disabled={currentMoveIdx >= movesList.length - 1}
            className="p-2 rounded-xl bg-[#0d1117] border border-white/10 text-slate-400 hover:text-white disabled:opacity-20 transition-all active:scale-95"
            aria-label="Forward"
          >
            <ChevronRight size={16} />
          </button>

          <div className="h-6 w-px bg-white/10 mx-1 shrink-0" />

          <button
            onClick={() => setMobileFlipped(f => !f)}
            className={cn(
              'p-2 rounded-xl border transition-all active:scale-95',
              mobileFlipped
                ? 'bg-slate-600/20 text-slate-300 border-slate-500/30'
                : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
            )}
            aria-label="Flip Board"
          >
            <RotateCw size={14} />
          </button>

          <button
            onClick={toggleAnalysisVision}
            className={cn(
              'p-2 rounded-xl border transition-all active:scale-95',
              showVision
                ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
                : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
            )}
            aria-label="Vision Heatmap"
          >
            <Layers size={14} />
          </button>

          <button
            onClick={toggleAnalysisThreats}
            className={cn(
              'p-2 rounded-xl border transition-all active:scale-95',
              showThreats
                ? 'bg-rose-600/20 text-rose-400 border-rose-500/30'
                : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
            )}
            aria-label="Opponent Threats"
          >
            <ShieldAlert size={14} />
          </button>

          <button
            onClick={toggleEvalBar}
            className={cn(
              'p-2 rounded-xl border transition-all active:scale-95',
              showEvalBar
                ? 'bg-amber-600/20 text-amber-400 border-amber-500/30'
                : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
            )}
            aria-label="Eval Bar"
          >
            <BarChart2 size={14} />
          </button>

          <button
            onClick={toggleLines}
            className={cn(
              'p-2 rounded-xl border transition-all active:scale-95',
              showLines
                ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30'
                : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
            )}
            aria-label="Engine Lines"
          >
            <Cpu size={14} />
          </button>

          <button
            onClick={() => {
              const next = !coachActive;
              setCoachActive(next);
              if (next) handleAnalysisRequest(true);
            }}
            className={cn(
              'p-2 rounded-xl border transition-all active:scale-95 ml-auto',
              coachActive
                ? 'bg-violet-600/20 text-violet-400 border-violet-500/30'
                : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-violet-400',
            )}
            aria-label="Coach Analysis"
          >
            <Wand2 size={14} />
          </button>
        </div>

        {/* ── MOBILE ONLY: Analysis Coach Widget ────────────────────────────── */}
        <div className="lg:hidden shrink-0">
          <AnalysisCoachWidget
            coachActive={coachActive}
            onCoachActiveChange={setCoachActive}
            onDeepAnalysis={handleAnalysisRequest}
            onDemoEngineLine={(pv) => playLine(pv)}
            onHighlightEngineLine={(pv) => handleMouseEnterLine(pv.split(' '))}
            onStopHighlight={handleMouseLeaveLine}
          />
        </div>

        {/* RIGHT SIDEBARS: 2xl+ shows both, <2xl shows one with tabs */}
        <div className="w-full 2xl:w-[840px] lg:w-[420px] bg-[#0a0d14] lg:border-l border-white/5 hidden lg:flex shrink-0">
          
          {/* Notation Panel - Always visible on 2xl+, or visible on <2xl if activeTab is notation (mapped to 'coach' for simplicity) */}
          <div className="flex-[1.2] flex flex-col min-h-0 border-b border-white/5">
            <div className="px-4 py-3 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                <List size={12} /> Notation Analysis
              </h3>
              {!isFullAnalyzing && (
                <button onClick={handleFullAnalysis} className="text-[9px] font-black uppercase px-2.5 py-1 bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 rounded-lg hover:bg-indigo-600/30 transition-all flex items-center gap-1.5">
                  <Zap size={10} /> {reviewedMoves.length > 0 ? 'Rescan' : 'Run Scan'}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-black/20" ref={movesScrollRef}>
              <div className="flex flex-wrap items-baseline gap-x-1 gap-y-2">
                {movesList.map((move, idx) => {
                  const isWhite = idx % 2 === 0;
                  const grade = reviewedMoves[idx];
                  const isSelected = currentMoveIdx === idx;
                  const isPlayerDev = playerDeviationFens.has(move.fenBefore);
                  const isOppDev = opponentDeviationFens.has(move.fenBefore);
                  const gradeLabel = GRADE_COLORS[grade?.grade]?.label ?? '';
                  return (
                    <React.Fragment key={idx}>
                      {isWhite && <span className="text-slate-600 text-[11px] font-mono select-none w-6">{Math.floor(idx / 2) + 1}.</span>}
                      <button
                        id={`move-${idx}`}
                        onClick={() => setCurrentMoveIdx(idx)}
                        className={cn(
                          'text-[13px] px-1.5 py-0.5 rounded transition-all flex items-center gap-1',
                          isSelected ? 'bg-indigo-500/30 text-white font-bold ring-1 ring-indigo-500/50' : cn(
                            'hover:bg-white/5 font-medium',
                            grade?.grade === 'blunder'    ? 'text-rose-400'   :
                            grade?.grade === 'mistake'    ? 'text-orange-400' :
                            grade?.grade === 'inaccuracy' ? 'text-yellow-300' :
                            grade?.grade === 'excellent'  ? 'text-cyan-400'   :
                            grade?.grade === 'best'       ? 'text-green-400'  : 'text-slate-300',
                          ),
                          isPlayerDev && !isSelected && 'underline decoration-dotted decoration-rose-500/70',
                          isOppDev   && !isSelected && 'underline decoration-dotted decoration-amber-500/70',
                        )}
                      >
                        <span className="flex items-baseline gap-0.5">
                          {move.san}
                          {gradeLabel && <span className="text-[8px] font-black opacity-80">{gradeLabel}</span>}
                        </span>
                        {grade && (
                          <span className="text-[9px] font-mono opacity-40 group-hover:opacity-100">
                            {formatEval(grade.eval)}
                          </span>
                        )}
                        {grade?.clockRemaining !== undefined && (
                          <span className={cn(
                            'text-[8px] font-mono ml-1',
                            grade.underPressure ? 'text-orange-400' : 'text-slate-600',
                          )}>
                            {grade.underPressure && '⏰ '}
                            {grade.timeSpent !== undefined && `${Math.round(grade.timeSpent)}s `}
                            <span className="opacity-60">{formatClock(grade.clockRemaining)}</span>
                          </span>
                        )}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Deviations Panel */}
            {game.deviations.length > 0 && (
              <div className="shrink-0 border-t border-white/5 bg-black/40 overflow-hidden">
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Target size={10} className="text-indigo-500" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Key Moments</span>
                  </div>
                  <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto custom-scrollbar pr-1">
                    {game.deviations.map((d, i) => (
                      <div key={i} onClick={() => jumpToDeviation(d)} className={cn(
                        "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all border border-white/5",
                        d.side === 'player' ? "bg-rose-500/5 hover:bg-rose-500/10 border-rose-500/10" : "bg-amber-500/5 hover:bg-amber-500/10 border-amber-500/10"
                      )}>
                        <span className="text-[10px] text-slate-500 shrink-0 font-mono">M{d.moveNumber}</span>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className={cn("text-[11px] font-bold", d.side === 'player' ? "text-rose-400" : "text-amber-400")}>{d.playedSan}</span>
                          <span className="text-slate-600 text-[10px]">→</span>
                          <span className="text-[11px] font-bold text-emerald-400 truncate">{d.repertoireSan}</span>
                        </div>
                        {d.side === 'player' && (
                          <button onClick={(e) => { e.stopPropagation(); onDrillDeviation(d); }} className="shrink-0 text-[9px] font-black uppercase px-2 py-0.5 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-all">Drill</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* BOTTOM PANEL: Coach & Engine */}
          <div className="flex-1 flex flex-col min-h-0 bg-black/40">
            <div className="flex border-b border-white/5 bg-white/[0.02]">
              <button onClick={() => setActiveTab('coach')} className={cn("flex-1 py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all", activeTab === 'coach' ? "text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5" : "text-slate-500 hover:text-slate-300")}>
                <Brain size={12} /> Coach
              </button>
              <button onClick={() => setActiveTab('engine')} className={cn("flex-1 py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all", activeTab === 'engine' ? "text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5" : "text-slate-500 hover:text-slate-300")}>
                <Zap size={12} /> Engine
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
              {activeTab === 'coach' ? (
                <div className="space-y-5 animate-in slide-in-from-right-2 duration-300">
                  {(isCoachAnalyzing || isThinking) ? (
                    <div className="py-12 flex flex-col items-center text-center gap-4 animate-pulse">
                      <Brain size={32} className="text-indigo-500" />
                      <p className="text-xs font-black uppercase tracking-widest text-slate-500">Wizard is thinking...</p>
                    </div>
                  ) : currentInsight ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Coach's Insight</span>
                        <button 
                          onClick={() => handleAnalysisRequest(true)}
                          className="text-[9px] font-black uppercase text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
                        >
                          <RotateCcw size={10} /> Recalculate
                        </button>
                      </div>
                      <div className="bg-indigo-600/10 border border-indigo-500/20 p-5 rounded-2xl">
                        <p className="text-slate-200 text-sm leading-relaxed">{currentInsight}</p>
                      </div>
                      {demoLine.length > 0 && (
                        <div 
                          className="space-y-3 group/line cursor-pointer"
                          onMouseEnter={() => handleMouseEnterLine(demoLine)}
                          onMouseLeave={handleMouseLeaveLine}
                          onClick={() => playLine(demoLine)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Recommended</span>
                            <div className="flex gap-2">
                              <button onClick={(e) => { e.stopPropagation(); jumpToLineEnd(demoLine); }} className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider hover:text-white transition-colors"><Eye size={12} /> View</button>
                              <button onClick={(e) => { e.stopPropagation(); playLine(demoLine); }} className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 uppercase tracking-wider hover:text-emerald-300 transition-colors">{isPlayingLine ? <StopCircle size={12} /> : <PlayCircle size={12} />} {isPlayingLine ? 'Stop' : 'Play'}</button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {demoLine.map((m, i) => <span key={i} className="bg-white/5 px-2 py-1 rounded text-[11px] font-mono text-emerald-400 border border-white/5">{m}</span>)}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="py-8 text-center space-y-4">
                      <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto"><Search size={20} className="text-slate-600" /></div>
                      <p className="text-xs text-slate-500 max-w-[200px] mx-auto leading-relaxed">Select a move to see Grandmaster strategy and deep analysis.</p>
                      <button onClick={() => handleAnalysisRequest(true)} className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest transition-all">Analyze Position</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6 animate-in slide-in-from-right-2 duration-300">
                  {/* Lichess Explorer Stats */}
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                      <BarChart2 size={12} /> Human Database (Lichess)
                    </h4>
                    {explorerData ? (
                      <div className="space-y-2">
                        {explorerData.moves.slice(0, 3).map((m: any) => {
                          const total = m.white + m.draws + m.black;
                          const wPct = Math.round((m.white / total) * 100);
                          const dPct = Math.round((m.draws / total) * 100);
                          const lPct = 100 - wPct - dPct;
                          return (
                            <div key={m.san} className="bg-white/[0.03] border border-white/5 rounded-xl p-3">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-xs font-bold text-slate-200">{m.san}</span>
                                <span className="text-[10px] font-mono text-slate-500">{total.toLocaleString()} games</span>
                              </div>
                              <div className="h-1.5 w-full flex rounded-full overflow-hidden">
                                <div style={{ width: `${wPct}%` }} className="h-full bg-emerald-500/60" />
                                <div style={{ width: `${dPct}%` }} className="h-full bg-slate-500/40" />
                                <div style={{ width: `${lPct}%` }} className="h-full bg-rose-500/60" />
                              </div>
                              <div className="flex justify-between mt-1 text-[8px] font-black uppercase tracking-tighter text-slate-500">
                                <span>W: {wPct}%</span>
                                <span>D: {dPct}%</span>
                                <span>L: {lPct}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-600 italic px-1">Loading Lichess data...</p>
                    )}
                  </div>

                  {/* Opponent Threats Section */}
                  {showThreats && (
                    <div className="space-y-3">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-rose-400 flex items-center gap-2">
                        <ShieldAlert size={12} /> Opponent Threats
                      </h4>
                      {threatData ? (
                        <div 
                          onMouseEnter={() => handleMouseEnterLine(threatData.pv.split(' '))}
                          onMouseLeave={handleMouseLeaveLine}
                          onClick={() => playLine(threatData.pv.split(' '))}
                          className="bg-rose-500/5 p-3 rounded-xl border border-rose-500/20 group hover:bg-rose-500/10 transition-all cursor-pointer"
                        >
                          <div className="flex justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-rose-400 uppercase tracking-tighter">Immediate Threat</span>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); playLine(threatData.pv.split(' ')); }} className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white"><PlayCircle size={12} /></button>
                              </div>
                            </div>
                            <span className="text-[10px] font-mono font-bold text-rose-300">
                              {threatData.mate ? `M${threatData.mate}` : (threatData.eval !== null ? (threatData.eval / 100).toFixed(2) : '0.00')}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono leading-relaxed group-hover:text-slate-200">
                            {formatPV(baseFen, threatData.pv, 8)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-600 italic px-1">Calculating threats...</p>
                      )}
                      <div className="h-[1px] bg-white/5 mx-2" />
                    </div>
                  )}

                  {/* Engine Lines Section */}
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-indigo-400 flex items-center gap-2">
                      <Cpu size={12} /> Suggested Moves
                    </h4>
                    <div className="space-y-2">
                      {topLines.length > 0 ? topLines.map((line, i) => {
                        const san = line.pv.split(' ')[0];
                        const isKnown = (repertoirePositions[currentFen] ?? []).some(m => m.san === san);
                        
                        return (
                          <div 
                            key={line.pv.slice(0, 24)} 
                            onMouseEnter={() => handleMouseEnterLine(line.pv.split(' '))}
                            onMouseLeave={handleMouseLeaveLine}
                            className="bg-white/5 p-3 rounded-xl border border-white/5 group hover:border-indigo-500/30 transition-all cursor-pointer relative"
                            onClick={() => playLine(line.pv.split(' '))}
                          >
                            <div className="flex justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-indigo-400 uppercase">Line {i+1}</span>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); playLine(line.pv.split(' ')); }} 
                                    className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white"
                                  >
                                    <PlayCircle size={12} />
                                  </button>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {!isKnown && repertoireId && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const chess = new Chess(currentFen);
                                      try {
                                        const move = chess.move(san);
                                        if (move) handleAddToRepertoire(san, chess.fen(), line.pv);
                                      } catch {}
                                    }}
                                    disabled={isAddingToBook !== null}
                                    className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[8px] font-black uppercase tracking-widest transition-all shadow-lg flex items-center gap-1"
                                  >
                                    {isAddingToBook === san ? (
                                      <><Activity size={8} className="animate-spin" /> Saving...</>
                                    ) : (
                                      <><Zap size={8} /> Add to Book</>
                                    )}
                                  </button>
                                )}
                                {isKnown && (
                                  <span className="text-[8px] font-black uppercase text-emerald-400/60 flex items-center gap-1">
                                    <CheckCircle2 size={8} /> In Book
                                  </span>
                                )}
                                <span className="text-[10px] font-mono font-bold text-slate-300">
                                  {line.mate 
                                    ? `M${line.mate}` 
                                    : line.cp !== null 
                                      ? (line.cp / 100).toFixed(2) 
                                      : '0.00'}
                                </span>
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-500 font-mono leading-relaxed group-hover:text-slate-300">
                              {formatPV(baseFen, line.pv, 10)}
                            </p>
                          </div>
                        );
                      }) : (
                        <div className="py-8 text-center opacity-50">
                          <Cpu size={24} className="mx-auto text-slate-600 mb-2 animate-pulse" />
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Thinking...</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile-only: horizontal move ticker */}
      <MoveTickerStrip
        moves={tickerMoves}
        currentIdx={currentMoveIdx}
        onSelect={setCurrentMoveIdx}
        onPrev={() => _handleNav(-1)}
        onNext={() => _handleNav(1)}
      />

    </div>
  );
};
