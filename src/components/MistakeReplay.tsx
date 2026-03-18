import React, { useState, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import { Film, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '../utils/cn';
import { StockfishEngine } from '../services/engine';
import { Chess } from 'chess.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BlunderMove {
  gameId: number;
  date: string;
  white: string;
  black: string;
  result: string;
  userColor: string | null;
  moveIndex: number;
  san: string;
  grade: string; // 'blunder' | 'mistake'
  cpLoss: number;
  fen: string; // FEN after the move
  gameShape: string | null;
  openingClass: string | null;
  evals: number[];
}

export interface MistakeReplayProps {
  onViewGame: (gameId: number, moveIndex?: number) => void;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatCpLoss(cp: number): string {
  if (cp >= 800) return '−∞';
  return `−${(cp / 100).toFixed(1)}`;
}

// Module-level cache (outside component)
const bestMoveCache = new Map<string, string>(); // fen → uci move
let hoverEngine: StockfishEngine | null = null;

// ── Components ────────────────────────────────────────────────────────────────

const EvalSparkline: React.FC<{ evals: number[]; blunderIdx: number }> = ({ evals, blunderIdx }) => {
  if (!evals || !evals.length) return null;
  const W = 300; const H = 40;
  const clamp = (v: number) => Math.max(-800, Math.min(800, v));
  const points = evals.map((e, i) => {
    const x = (i / (evals.length - 1)) * W;
    const y = H / 2 - (clamp(e) / 800) * (H / 2 - 2);
    return `${x},${y}`;
  }).join(' ');
  const blunderX = evals.length > 1 ? (blunderIdx / (evals.length - 1)) * W : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" preserveAspectRatio="none">
      {/* zero line */}
      <line x1="0" y1={H/2} x2={W} y2={H/2} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      {/* eval curve */}
      <polyline points={points} fill="none" stroke="rgba(148,163,184,0.4)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* blunder marker */}
      <line x1={blunderX} y1="0" x2={blunderX} y2={H} stroke="rgba(244,63,94,0.7)" strokeWidth="1.5" />
    </svg>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

export const MistakeReplay: React.FC<MistakeReplayProps> = ({ onViewGame, onClose }) => {
  const [blunders, setBlunders] = useState<BlunderMove[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [sortBy, setSortBy] = useState<'date' | 'severity'>('date');
  const [filterGrade, setFilterGrade] = useState<'all' | 'blunder' | 'mistake'>('all');
  const [filterPhase, setFilterPhase] = useState<'all' | 'opening' | 'middlegame' | 'endgame'>('all');

  useEffect(() => {
    let cancelled = false;

    async function fetchBlunders() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/games/blunders?limit=40');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `API error ${res.status}`);
        }
        const data: BlunderMove[] = await res.json();
        if (!cancelled) setBlunders(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchBlunders();
    return () => { cancelled = true; };
  }, []);

  // ── Derived stats & Sort ───────────────────────────────────────────────────

  const filtered = blunders.filter(b => {
    if (filterGrade !== 'all' && b.grade !== filterGrade) return false;
    const moveNum = Math.floor(b.moveIndex / 2) + 1;
    if (filterPhase === 'opening' && moveNum > 15) return false;
    if (filterPhase === 'middlegame' && (moveNum <= 15 || moveNum > 30)) return false;
    if (filterPhase === 'endgame' && moveNum <= 30) return false;
    return true;
  });

  const sortedBlunders = [...filtered].sort((a, b) => {
    if (sortBy === 'severity') return b.cpLoss - a.cpLoss;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const blunderCount = blunders.filter(b => b.grade === 'blunder').length;
  const mistakeCount = blunders.filter(b => b.grade === 'mistake').length;

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 bg-[#050507] flex flex-col items-center justify-center gap-4">
        <Loader2 className="text-indigo-400 animate-spin" size={40} />
        <p className="text-slate-400 text-sm font-semibold uppercase tracking-widest">
          Loading Film Room
        </p>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex-1 bg-[#050507] flex flex-col items-center justify-center gap-6 text-center px-6">
        <AlertTriangle className="text-rose-400" size={48} />
        <div>
          <p className="text-slate-300 text-lg font-bold">Failed to load blunders</p>
          <p className="text-slate-500 text-sm mt-1 max-w-xs">{error}</p>
        </div>
        <button
          onClick={onClose}
          className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-2xl font-bold transition-all"
        >
          Go Back
        </button>
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────

  if (blunders.length === 0) {
    return (
      <div className="flex-1 bg-[#050507] flex flex-col items-center justify-center gap-4 text-center px-6">
        <Film className="text-slate-600" size={48} />
        <p className="text-slate-400 text-sm max-w-xs">
          No analyzed games yet. Run a game scan to populate your Film Room.
        </p>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 bg-[#050507] flex flex-col overflow-hidden animate-in fade-in duration-500">
      {/* Stats summary bar */}
      <div className="shrink-0 px-6 py-4 border-b border-white/5 bg-[#0d1117]/50 backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-3">
              <Film className="text-rose-500" size={24} /> Film Room
            </h1>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">
              Analyzing your costliest mistakes
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
            {/* Filters */}
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5 gap-1">
              <select 
                className="bg-transparent text-[10px] font-bold uppercase tracking-widest text-slate-300 px-2 py-1 outline-none cursor-pointer"
                value={filterGrade} 
                onChange={e => setFilterGrade(e.target.value as any)}
              >
                <option value="all">All Grades</option>
                <option value="blunder">Blunders</option>
                <option value="mistake">Mistakes</option>
              </select>
              <div className="w-px bg-white/10 my-1"></div>
              <select 
                className="bg-transparent text-[10px] font-bold uppercase tracking-widest text-slate-300 px-2 py-1 outline-none cursor-pointer"
                value={filterPhase} 
                onChange={e => setFilterPhase(e.target.value as any)}
              >
                <option value="all">All Phases</option>
                <option value="opening">Opening</option>
                <option value="middlegame">Middlegame</option>
                <option value="endgame">Endgame</option>
              </select>
            </div>

            {/* Sort Toggles */}
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setSortBy('date')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                  sortBy === 'date' ? "bg-white/10 text-white shadow-xl" : "text-slate-500 hover:text-slate-300"
                )}
              >
                Recent
              </button>
              <button
                onClick={() => setSortBy('severity')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                  sortBy === 'severity' ? "bg-white/10 text-white shadow-xl" : "text-slate-500 hover:text-slate-300"
                )}
              >
                Severity
              </button>
            </div>
            
            <p className="text-slate-500 text-xs hidden xl:block">
              <span className="text-rose-400 font-black">{blunderCount}</span>
              {' blunders · '}
              <span className="text-orange-400 font-black">{mistakeCount}</span>
              {' mistakes'}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable grid */}
      <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
          {sortedBlunders.map((item, idx) => (
            <BlunderCard
              key={`${item.gameId}-${item.moveIndex}-${idx}`}
              item={item}
              onViewGame={onViewGame}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// ── BlunderCard ────────────────────────────────────────────────────────────────

interface BlunderCardProps {
  item: BlunderMove;
  onViewGame: (gameId: number, moveIndex: number) => void;
}

const BlunderCard: React.FC<BlunderCardProps> = ({ item, onViewGame }) => {
  const [arrows, setArrows] = useState<[string, string, string][]>([]);

  const isBlunder = item.grade === 'blunder';
  const boardOrientation = item.userColor === 'black' ? 'black' : 'white';
  
  const moveNumber = Math.floor(item.moveIndex / 2) + 1;
  const isOpening = moveNumber <= 15;
  const phaseLabel = isOpening ? 'Opening' : moveNumber <= 30 ? 'Middlegame' : 'Endgame';
  const tagLabel = item.gameShape ?? phaseLabel;

  const opponent =
    item.userColor === 'white'
      ? item.black
      : item.userColor === 'black'
      ? item.white
      : item.black;

  const badgeClasses = isBlunder
    ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
    : 'bg-orange-500/20 text-orange-400 border-orange-500/30';

  const handleMouseEnter = async () => {
    // Parse mistake arrow immediately from SAN + fen
    try {
      const chess = new Chess(item.fen);
      const move = chess.move(item.san);
      const mistakeArrow: [string, string, string] = [move.from, move.to, 'rgba(220,38,38,0.7)'];
      setArrows([mistakeArrow]);

      // Get best move (cached or from engine)
      if (bestMoveCache.has(item.fen)) {
        const uci = bestMoveCache.get(item.fen)!;
        if (uci && uci.length >= 4) {
          const bestArrow: [string, string, string] = [uci.slice(0,2), uci.slice(2,4), 'rgba(34,197,94,0.8)'];
          setArrows([mistakeArrow, bestArrow]);
        }
      } else {
        if (!hoverEngine) {
          hoverEngine = new StockfishEngine();
          await hoverEngine.waitUntilReady();
        }
        const result = await hoverEngine.evaluateOnce(item.fen, 8);
        if (result.bestMove) {
          bestMoveCache.set(item.fen, result.bestMove);
          const uci = result.bestMove;
          if (uci && uci.length >= 4) {
            const bestArrow: [string, string, string] = [uci.slice(0,2), uci.slice(2,4), 'rgba(34,197,94,0.8)'];
            setArrows(prev => prev.length > 0 ? [mistakeArrow, bestArrow] : []);
          }
        }
      }
    } catch (e) {
      console.error("Error drawing arrows:", e);
    }
  };

  const handleMouseLeave = () => {
    setArrows([]);
  };

  return (
    <div 
      onMouseEnter={handleMouseEnter} 
      onMouseLeave={handleMouseLeave}
      onClick={() => onViewGame(item.gameId, item.moveIndex)}
      className="bg-[#0d1117] border border-white/5 rounded-[2.5rem] overflow-hidden hover:border-indigo-500/30 transition-all group cursor-pointer hover:shadow-2xl hover:shadow-indigo-500/10 active:scale-[0.98] flex flex-col"
    >
      {/* Board */}
      <div className="aspect-square w-full opacity-80 group-hover:opacity-100 transition-opacity relative shrink-0">
        <Chessboard
          position={item.fen}
          arePiecesDraggable={false}
          animationDuration={0}
          boardOrientation={boardOrientation}
          customArrows={arrows as any}
          customDarkSquareStyle={{ backgroundColor: '#1e293b' }}
          customLightSquareStyle={{ backgroundColor: '#475569' }}
        />
        {/* Phase / Shape tag */}
        <div className={cn(
          "absolute top-4 right-4 px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest backdrop-blur-md border shadow-2xl",
          isOpening ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
        )}>
          {tagLabel}
        </div>
      </div>

      {/* Eval Sparkline */}
      <div className="px-3 py-1 bg-black/20 shrink-0">
        <EvalSparkline evals={item.evals} blunderIdx={item.moveIndex} />
      </div>

      {/* Info section */}
      <div className="p-5 flex flex-col gap-2 flex-1 justify-center">
        <div className="flex items-center gap-2">
          <span className={cn('text-[8px] font-black uppercase px-2 py-0.5 rounded-full border shrink-0', badgeClasses)}>
            {isBlunder ? 'blunder' : 'mistake'}
          </span>
          <span className="text-xl font-black text-white leading-none">{item.san}</span>
          <span className="text-rose-400 text-sm font-mono ml-auto shrink-0 font-bold">
            {formatCpLoss(item.cpLoss)}
          </span>
        </div>

        <p className="text-slate-500 text-[10px] uppercase tracking-[0.2em] font-black">
          Move {moveNumber} {item.openingClass && `· ${item.openingClass}`}
        </p>

        <div className="flex flex-col gap-0.5">
          <span className="text-slate-300 text-xs font-bold truncate">
            vs {opponent || 'Unknown'}
          </span>
          <span className="text-slate-600 text-[10px] font-bold uppercase tracking-tight">
            {formatDate(item.date)}
          </span>
        </div>
      </div>
    </div>
  );
};
