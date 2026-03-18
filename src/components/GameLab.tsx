import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { cn } from '../utils/cn';
import {
  Upload, Activity, Loader2, FlaskConical,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, X, RefreshCw, Cpu, Layers
} from 'lucide-react';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGameReview } from '../hooks/useGameReview';
import { useStockfish } from '../services/engine';
import { VisionOverlay } from './VisionOverlay';
import { calculateControl } from '../utils/chessLogic';
import { PgnParser } from '../services/pgn_parser';
import { getLastGame } from '../services/chesscom';
import { MoveTickerStrip, TickerMove } from './MoveTickerStrip';

const GRADE_COLORS: Record<string, { label: string; text: string; bg: string; border: string }> = {
  blunder:    { label: '??', text: 'text-rose-400',    bg: 'bg-rose-500/15',    border: 'border-rose-500/30' },
  mistake:    { label: '?',  text: 'text-orange-400',  bg: 'bg-orange-500/15',  border: 'border-orange-500/30' },
  inaccuracy: { label: '?!', text: 'text-yellow-300',  bg: 'bg-yellow-500/15',  border: 'border-yellow-500/30' },
  good:       { label: '',   text: 'text-slate-400',   bg: '',                  border: '' },
  excellent:  { label: '!',  text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20' },
  best:       { label: '✓',  text: 'text-green-400',   bg: 'bg-green-500/10',   border: 'border-green-500/20' },
};

interface GameLabProps {
  initialPgn?: string | null;
}

export const GameLab: React.FC<GameLabProps> = ({ initialPgn }) => {
  const { chessComUsername, setChessComUsername } = useRepertoireStore();
  const { lab: settings, setLabSetting, toggleLabVision } = useSettingsStore();
  const { showVision, showEngine } = settings;
  const { reviewedMoves, isAnalyzing, progress, error, analyzeGame, cancelAnalysis, reset } = useGameReview();
  const { engine, topLines } = useStockfish();

  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [evalExpanded, setEvalExpanded] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [username, setUsername] = useState(chessComUsername || '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAnalyzedPgn = useRef<string | null>(null);

  useEffect(() => {
    if (initialPgn && initialPgn !== lastAnalyzedPgn.current) {
      lastAnalyzedPgn.current = initialPgn;
      reset(); // Clear old analysis immediately
      const parsed = PgnParser.parse(initialPgn);
      if (parsed.length > 0) {
        setCurrentMoveIndex(-1);
        analyzeGame(parsed[0]);
      }
    }
  }, [initialPgn, analyzeGame, reset]);

  const currentFen = currentMoveIndex < 0 || !reviewedMoves[currentMoveIndex]
    ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    : reviewedMoves[currentMoveIndex].fen;

  const controlMap = useMemo(() => {
    if (!showVision) return {} as ReturnType<typeof calculateControl>;
    return calculateControl(currentFen);
  }, [currentFen, showVision]);

  // Side to move for normalizing engine eval
  const sideToMove = useMemo(() => {
    try { return new Chess(currentFen).turn(); } catch { return 'w'; }
  }, [currentFen]);

  // Drive engine evaluation when position or toggle changes
  useEffect(() => {
    if (!engine) return;
    if (!showEngine) { engine.stop(); return; }
    engine.stop();
    engine.evaluate(currentFen, 18);
  }, [showEngine, engine, currentFen]);

  // Stop engine on unmount
  useEffect(() => () => { engine?.stop(); }, [engine]);

  // Convert UCI move to SAN for display
  const pvToSan = (fen: string, uci: string): string => {
    try {
      const ch = new Chess(fen);
      const m = ch.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      return m?.san ?? uci;
    } catch { return uci; }
  };

  // Normalize cp to white's perspective (+ve = white winning)
  const normCp = (cp: number | null) =>
    cp === null ? null : sideToMove === 'b' ? -cp : cp;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = PgnParser.parse(text);
    if (parsed.length > 0) { setCurrentMoveIndex(-1); analyzeGame(parsed[0]); }
    e.target.value = '';
  };

  const handleSync = async () => {
    const name = username.trim();
    if (!name) return;
    setChessComUsername(name);
    setIsSyncing(true);
    try {
      const gameData = await getLastGame(name);
      if (gameData) {
        const parsed = PgnParser.parse(gameData.pgn);
        if (parsed.length > 0) { setCurrentMoveIndex(-1); analyzeGame(parsed[0]); }
      }
    } catch (e) { console.error('Sync failed', e); }
    finally { setIsSyncing(false); }
  };

  const summary = useMemo(() => ({
    blunders: reviewedMoves.filter(m => m.grade === 'blunder').length,
    mistakes:  reviewedMoves.filter(m => m.grade === 'mistake').length,
  }), [reviewedMoves]);

  // Build SVG polygon points for eval graph (1000×100 viewBox)
  // Uses tanh (Lichess-style) so extreme evals compress smoothly instead of hard-clamping
  const graphPoints = useMemo(() => {
    if (!reviewedMoves.length) return '';
    const pts = reviewedMoves.map((m, i) => {
      // tanh maps ±∞ → ±1 smoothly; divisor 600 means ±600cp ≈ 76% of the way to edge
      const y = 50 * (1 - Math.tanh(m.eval / 600));
      const x = ((i + 0.5) / reviewedMoves.length) * 1000;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `0,50 ${pts.join(' ')} 1000,50`;
  }, [reviewedMoves]);

  const tickerMoves = useMemo((): TickerMove[] =>
    reviewedMoves.map((m, idx) => ({
      idx,
      san: m.san,
      grade: m.grade,
      moveNumber: Math.floor(idx / 2) + 1,
      isWhite: idx % 2 === 0,
    })),
  [reviewedMoves]);

  // ── ANALYZING ────────────────────────────────────────────────────────────────
  if (isAnalyzing) {
    const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#050507] text-slate-200 p-8 gap-8 animate-in fade-in font-outfit">
        <div className="relative">
          <div className="absolute inset-0 bg-cyan-500/20 blur-2xl rounded-full" />
          <Loader2 size={56} className="text-cyan-400 animate-spin relative z-10" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-black uppercase tracking-tighter text-white mb-1">Analysing Game</h2>
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">
            Stockfish · 1s/move · Move {progress.current} / {progress.total}
          </p>
        </div>
        <div className="w-72 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-white/5">
          <div className="h-full bg-cyan-500 transition-all duration-300 ease-out rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <button
          onClick={cancelAnalysis}
          className="px-6 py-2.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all border border-white/5"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── RESULTS ──────────────────────────────────────────────────────────────────
  if (reviewedMoves.length > 0) {
    return (
      <div className="h-full flex flex-col bg-[#050507] text-slate-200 font-outfit overflow-hidden animate-in fade-in">

        {/* Header */}
        <div className="h-14 border-b border-white/5 flex items-center justify-between px-6 bg-[#0a0d14] shrink-0">
          <div className="flex items-center gap-3">
            <FlaskConical size={18} className="text-cyan-400" />
            <span className="font-black uppercase tracking-widest text-xs text-slate-400">Analysis Report</span>
            <div className="flex items-center gap-2 ml-3">
              {summary.blunders > 0 && (
                <span className="px-2.5 py-1 bg-rose-500/10 border border-rose-500/20 rounded-lg text-[10px] font-black text-rose-400 uppercase tracking-wide">
                  {summary.blunders} Blunder{summary.blunders !== 1 ? 's' : ''}
                </span>
              )}
              {summary.mistakes > 0 && (
                <span className="px-2.5 py-1 bg-orange-500/10 border border-orange-500/20 rounded-lg text-[10px] font-black text-orange-400 uppercase tracking-wide">
                  {summary.mistakes} Mistake{summary.mistakes !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLabSetting('showEngine', !showEngine)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide border transition-all',
                showEngine
                  ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-slate-500 hover:text-white hover:bg-white/8'
              )}
            >
              <Cpu size={13} /> Engine
            </button>
            <button
              onClick={() => { reset(); setCurrentMoveIndex(-1); setLabSetting('showEngine', false); }}
              className="p-2 hover:bg-white/5 rounded-lg text-slate-500 hover:text-white transition-all"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden flex-col lg:flex-row">

          {/* LEFT: Board + Graph + Controls */}
          <div className="flex-[1.5] flex flex-col items-center p-4 lg:p-6 gap-4 bg-[#0d1117]/20 min-h-0">

            {/* Board — same style as training */}
            <div className="w-full max-w-[min(55vh,420px)] aspect-square shrink-0 relative">
              <div className="w-full h-full shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] rounded-[2rem] overflow-hidden border-[12px] border-[#161b22] bg-[#161b22] relative">
                <Chessboard
                  position={currentFen}
                  arePiecesDraggable={false}
                  animationDuration={150}
                  customDarkSquareStyle={{ backgroundColor: '#1e293b' }}
                  customLightSquareStyle={{ backgroundColor: '#475569' }}
                />
                {showVision && <VisionOverlay control={controlMap} orientation="white" />}
                
                {/* Vision Toggle */}
                <button 
                  onClick={toggleLabVision}
                  className={cn(
                    "absolute top-3 right-3 z-30 p-2 rounded-xl shadow-xl border transition-all",
                    showVision ? "bg-emerald-600 text-white border-emerald-500" : "bg-[#1a1f26] text-slate-400 border-white/10 hover:text-white"
                  )}
                >
                  <Layers size={16} />
                </button>
              </div>

              {/* Engine lines overlay */}
              {showEngine && topLines.length > 0 && (
                <div className="absolute top-3 right-3 z-30 bg-[#0d1117]/92 backdrop-blur-md p-3 rounded-2xl border border-white/10 shadow-2xl w-44 animate-in slide-in-from-right-4 duration-200">
                  <h4 className="text-[8px] font-black uppercase tracking-[0.2em] text-emerald-500 mb-2.5 flex items-center gap-1.5">
                    <Activity size={9} /> Top Moves
                  </h4>
                  <div className="space-y-2">
                    {topLines.map((line, idx) => {
                      const san = pvToSan(currentFen, line.pv.split(' ')[0]);
                      const cp = normCp(line.cp);
                      const isPos = (cp ?? 0) >= 0;
                      return (
                        <div key={idx} className="flex justify-between items-center gap-2">
                          <span className="text-[11px] font-mono font-bold text-slate-200">{san}</span>
                          <span className={cn(
                            'text-[10px] font-black px-1.5 py-0.5 rounded-lg shrink-0',
                            isPos ? 'bg-slate-100/10 text-slate-300' : 'bg-slate-800/60 text-slate-400'
                          )}>
                            {line.mate
                              ? `M${Math.abs(line.mate)}`
                              : cp !== null
                                ? (Math.abs(cp) < 1 ? '0.00' : `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(2)}`)
                                : '0.00'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Eval Graph — Lichess style, expandable on mobile */}
            <div
              className={cn(
                'w-full max-w-[min(55vh,420px)] rounded-xl border border-white/5 overflow-hidden relative shrink-0 bg-[#0a0d14] transition-[height] duration-300',
                evalExpanded ? 'h-24 lg:h-12' : 'h-12',
              )}
            >
              <svg viewBox="0 0 1000 100" preserveAspectRatio="none" width="100%" height="100%">
                <defs>
                  <clipPath id="gl-upper">
                    <rect x="0" y="0" width="1000" height="50" />
                  </clipPath>
                  <clipPath id="gl-lower">
                    <rect x="0" y="50" width="1000" height="50" />
                  </clipPath>
                </defs>
                {/* Background halves */}
                <rect x="0" y="0" width="1000" height="50" fill="rgba(255,255,255,0.05)" />
                <rect x="0" y="50" width="1000" height="50" fill="rgba(0,0,0,0.35)" />
                {/* Midline */}
                <line x1="0" y1="50" x2="1000" y2="50" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
                {/* White-winning area */}
                {graphPoints && (
                  <polygon points={graphPoints} fill="rgba(241,245,249,0.88)" clipPath="url(#gl-upper)" />
                )}
                {/* Black-winning area */}
                {graphPoints && (
                  <polygon points={graphPoints} fill="rgba(15,23,42,0.95)" clipPath="url(#gl-lower)" />
                )}
                {/* Grade dots — only in expanded state, blunders/mistakes/inaccuracies only */}
                {evalExpanded && reviewedMoves.map((m, i) => {
                  const dotColor =
                    m.grade === 'blunder'    ? '#f43f5e' :
                    m.grade === 'mistake'    ? '#fb923c' :
                    m.grade === 'inaccuracy' ? '#fcd34d' : null;
                  if (!dotColor) return null;
                  const cx = ((i + 0.5) / reviewedMoves.length) * 1000;
                  const cy = 50 * (1 - Math.tanh(m.eval / 600));
                  return (
                    <circle key={i} cx={cx} cy={cy} r="5" fill={dotColor} fillOpacity="0.9" />
                  );
                })}
                {/* Cursor line */}
                {currentMoveIndex >= 0 && (
                  <line
                    x1={((currentMoveIndex + 0.5) / reviewedMoves.length) * 1000}
                    y1="0"
                    x2={((currentMoveIndex + 0.5) / reviewedMoves.length) * 1000}
                    y2="100"
                    stroke="#22d3ee"
                    strokeWidth="3"
                    strokeOpacity="0.75"
                  />
                )}
              </svg>
              {/* Seek overlay */}
              <div
                className="absolute top-0 left-0 bottom-0 right-7 lg:right-0 cursor-pointer"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - rect.left) / rect.width;
                  const idx = Math.max(0, Math.min(reviewedMoves.length - 1, Math.floor(pct * reviewedMoves.length)));
                  setCurrentMoveIndex(idx);
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

            {/* Navigator */}
            <div className="flex items-center gap-1 bg-[#0d1117] border border-white/10 p-1 rounded-xl shadow-xl shrink-0">
              <button
                onClick={() => setCurrentMoveIndex(i => Math.max(-1, i - 1))}
                className="p-2.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="text-xs font-mono text-slate-400 px-3 min-w-[110px] text-center">
                {currentMoveIndex < 0
                  ? 'Start'
                  : `Move ${Math.floor(currentMoveIndex / 2) + 1}${currentMoveIndex % 2 === 0 ? '.' : '…'} ${reviewedMoves[currentMoveIndex].san}`
                }
              </span>
              <button
                onClick={() => setCurrentMoveIndex(i => Math.min(reviewedMoves.length - 1, i + 1))}
                className="p-2.5 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {/* RIGHT: Move List */}
          <div className="w-full lg:w-[340px] bg-[#0a0d14] border-l border-white/5 hidden lg:flex flex-col shrink-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 bg-[#080a0f]">
              <h3 className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">Move Analysis</h3>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
              {reviewedMoves.map((move, i) => {
                const g = GRADE_COLORS[move.grade];
                const isActive = currentMoveIndex === i;
                const moveNum = Math.floor(i / 2) + 1;
                const isWhite = i % 2 === 0;
                return (
                  <button
                    key={i}
                    onClick={() => setCurrentMoveIndex(i)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-left',
                      isActive
                        ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-100'
                        : 'hover:bg-white/5 border border-transparent',
                    )}
                  >
                    <span className="text-[10px] font-mono text-slate-600 min-w-[28px] text-right shrink-0">
                      {moveNum}{isWhite ? '.' : '…'}
                    </span>
                    <span className={cn('font-bold text-sm min-w-[52px]', isWhite ? 'text-white' : 'text-slate-300')}>
                      {move.san}
                    </span>
                    {g.label && (
                      <span className={cn('text-[10px] font-black px-1.5 py-0.5 rounded border', g.text, g.bg, g.border)}>
                        {g.label}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] font-mono text-slate-600 shrink-0">
                      {move.cpLoss >= 10 ? `−${(move.cpLoss / 100).toFixed(2)}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mobile-only: horizontal move ticker */}
        <MoveTickerStrip
          moves={tickerMoves}
          currentIdx={currentMoveIndex}
          onSelect={setCurrentMoveIndex}
          onPrev={() => setCurrentMoveIndex(i => Math.max(-1, i - 1))}
          onNext={() => setCurrentMoveIndex(i => Math.min(reviewedMoves.length - 1, i + 1))}
          accentColor="bg-cyan-500/20 ring-cyan-500/40 text-cyan-100"
        />
      </div>
    );
  }

  // ── LANDING ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col items-center justify-center bg-[#050507] p-8 animate-in fade-in font-outfit">
      <div className="max-w-lg w-full space-y-10 text-center">
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-cyan-500/10 rounded-[2rem] flex items-center justify-center border border-cyan-500/20 shadow-[0_0_40px_-10px_rgba(34,211,238,0.3)]">
            <FlaskConical size={40} className="text-cyan-400" />
          </div>
        </div>

        <div>
          <h1 className="text-4xl font-black text-white uppercase tracking-tighter italic mb-2">Game Lab</h1>
          <p className="text-slate-500 font-bold uppercase tracking-[0.3em] text-xs">Stockfish Move-by-Move Review</p>
        </div>

        {error && (
          <div className="px-6 py-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-sm font-bold">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSync()}
              placeholder="Chess.com username"
              className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500/50 font-medium"
            />
            <button
              onClick={handleSync}
              disabled={isSyncing || !username.trim()}
              className="px-5 py-3.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all flex items-center gap-2 shrink-0"
            >
              {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />}
              Sync
            </button>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-3 py-4 bg-white/5 hover:bg-white/8 border border-white/10 hover:border-white/20 rounded-2xl text-slate-400 hover:text-white font-black uppercase tracking-widest text-xs transition-all"
          >
            <Upload size={16} /> Upload PGN File
          </button>
          <input ref={fileInputRef} type="file" accept=".pgn" className="hidden" onChange={handleFileUpload} />
        </div>

        <div className="flex items-center gap-3 text-slate-700 text-[10px] font-black uppercase tracking-widest">
          <div className="flex-1 h-px bg-white/5" />
          Stockfish · 1 second per move
          <div className="flex-1 h-px bg-white/5" />
        </div>

        <div className="flex justify-center gap-8 text-center">
          {[
            { color: 'text-rose-400',   label: '?? Blunder', desc: '>3 pawns lost' },
            { color: 'text-orange-400', label: '? Mistake',  desc: '0.5–3 pawns lost' },
            { color: 'text-emerald-400',label: '! Good',     desc: 'Best or near-best' },
          ].map(({ color, label, desc }) => (
            <div key={label}>
              <p className={cn('text-xs font-black', color)}>{label}</p>
              <p className="text-[10px] text-slate-600 mt-0.5">{desc}</p>
            </div>
          ))}
        </div>

        {chessComUsername && username !== chessComUsername && (
          <button
            onClick={() => setUsername(chessComUsername)}
            className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1 mx-auto"
          >
            <RefreshCw size={10} /> Use saved: {chessComUsername}
          </button>
        )}
      </div>
    </div>
  );
};
