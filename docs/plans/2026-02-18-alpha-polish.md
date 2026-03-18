# Chess Trainer Alpha Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every sidebar mode fully functional and consistent — unified full-screen navigation, working Analysis with game persistence, Game Lab with a real Stockfish move-review pipeline, and minor training polish.

**Architecture:** All 5 modes render as full-screen views in `App.tsx`. No mode opens an overlay to represent itself. Library (currently an overlay) becomes a true route. Game Lab runs its own dedicated Stockfish worker for sequential per-position analysis. Games imported/synced in Analysis persist in App state.

**Tech Stack:** React 18, TypeScript, Zustand, chess.js, react-chessboard, Stockfish 10 Web Worker, Gemini 2.0 Flash, Bun (server), SQLite (via better-sqlite3)

---

## Task 1: Library Mode — True Full-Screen Navigation

**Files:**
- Modify: `src/App.tsx` (lines ~37-63, ~143-155, ~260)
- Modify: `src/components/ChapterLibrary.tsx` (line 83)
- Modify: `src/components/Layout.tsx` (type union)

The current `repertoire` mode just sets `showChapters = true`, which opens ChapterLibrary as an overlay *on top of* the training board. It's not a real mode. Fix: render ChapterLibrary as a full-screen child when `activeMode === 'library'`, same pattern as ReviewTab.

**Step 1: Rename mode in App.tsx type union**

In `src/App.tsx`, find the `activeMode` useState and update:

```tsx
// Old:
const [activeMode, setActiveMode] = useState<'training' | 'analysis' | 'repertoire' | 'review' | 'lab'>('training');
// New:
const [activeMode, setActiveMode] = useState<'training' | 'analysis' | 'library' | 'review' | 'lab'>('training');
```

**Step 2: Update handleNavigate in App.tsx**

```tsx
// Old:
const handleNavigate = (mode: 'training' | 'analysis' | 'repertoire' | 'review' | 'lab') => {
  setActiveMode(mode);
  if (mode === 'training') {
    setShowChapters(false);
    setDashboard(false);
    setTree(false);
  } else if (mode === 'analysis') {
    setAnalysisView('hub');
  } else if (mode === 'repertoire') {
    setShowChapters(true);
  }
};

// New:
const handleNavigate = (mode: 'training' | 'analysis' | 'library' | 'review' | 'lab') => {
  setActiveMode(mode);
  if (mode === 'training') {
    setShowChapters(false);
    setDashboard(false);
    setTree(false);
  } else if (mode === 'analysis') {
    setAnalysisView('hub');
  }
};
```

**Step 3: Remove the ChapterLibrary overlay render block in App.tsx**

Remove (or comment out) the block:
```tsx
// DELETE this entire block:
{showChapters && activeMode === 'repertoire' && (
  <ChapterLibrary
    onSelectChapter={...}
    onClose={...}
  />
)}
```

**Step 4: Add library render block in App.tsx (inside the main content div, after review block)**

```tsx
{/* MODE: LIBRARY */}
{activeMode === 'library' && (
  <ChapterLibrary
    onSelectChapter={(idx: number) => {
      selectChapter(idx);
      startTraining(idx);
      handleNavigate('training');
    }}
    onClose={() => handleNavigate('training')}
  />
)}
```

**Step 5: Remove the `if (!showChapters) return null` guard from ChapterLibrary.tsx**

In `src/components/ChapterLibrary.tsx`, remove line 83:
```tsx
// DELETE this line:
if (!showChapters) return null;
```

Also change the outer div from `absolute inset-0 z-50 p-12 bg-[#050507]/98` to `absolute inset-0 z-10 p-12 bg-[#050507]` (remove backdrop-blur and z-50, match other full-screen modes).

**Step 6: Update Layout.tsx type union**

```tsx
// Old:
activeMode: 'training' | 'analysis' | 'repertoire' | 'review' | 'lab';
onNavigate: (mode: 'training' | 'analysis' | 'repertoire' | 'review' | 'lab') => void;

// New:
activeMode: 'training' | 'analysis' | 'library' | 'review' | 'lab';
onNavigate: (mode: 'training' | 'analysis' | 'library' | 'review' | 'lab') => void;
```

Update the SidebarItem that was `active={activeMode === 'repertoire'}` and `onClick={() => onNavigate('repertoire')}` to use `'library'` instead.

Update mobile nav button similarly.

**Step 7: Run TypeScript check**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | grep -v "ChapterLibrary\|GameAnalysis\|ai_coach\|useTraining.ts:89\|BookOpen"
```

Expected: no new errors.

---

## Task 2: Analysis Mode — Games Persistence & Import Dialogs

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/GameHub.tsx`
- Create: `src/components/PgnImportModal.tsx`
- Create: `src/components/ChessComModal.tsx`

**The core problem:** After a Chess.com sync or PGN import, the parsed game is used exactly once (immediately shown in viewer) then discarded. GameHub always receives `games: []`. Fix: store all imported games in App state; GameHub renders them as a list.

**Step 1: Add `StoredGame` type and `storedGames` state to App.tsx**

Near the top of the App component, add:

```tsx
interface StoredGame {
  analyzed: AnalyzedGame;
  parsed: ParsedGame;
}

// Inside App:
const [storedGames, setStoredGames] = useState<StoredGame[]>([]);
```

**Step 2: Update handleAnalyzeLastGame to push to storedGames**

```tsx
const handleAnalyzeLastGame = async (username: string) => {
  setIsSyncing(true);
  try {
    const game = await getLastGame(username);
    if (game) {
      const parsed = PgnParser.parse(game.pgn);
      if (parsed.length > 0) {
        const analyzedGame: AnalyzedGame = {
          id: game.uuid,
          white: game.white.username,
          black: game.black.username,
          result: game.white.result === 'win' ? '1-0' : game.black.result === 'win' ? '0-1' : '1/2-1/2',
          date: new Date(game.end_time * 1000).toLocaleDateString(),
          deviations: [],
        };
        setStoredGames(prev => {
          // Avoid duplicates
          if (prev.some(g => g.analyzed.id === analyzedGame.id)) return prev;
          return [{ analyzed: analyzedGame, parsed: parsed[0] }, ...prev];
        });
        // Auto-open the just-synced game
        setSelectedAnalyzedGame(analyzedGame);
        setLastGame(parsed[0]);
        setActiveMode('analysis');
        setAnalysisView('viewer');
      }
    }
  } finally {
    setIsSyncing(false);
  }
};
```

**Step 3: Update handlePgnUpload to push to storedGames**

```tsx
const handlePgnUpload = async (pgn: string) => {
  setIsSyncing(true);
  try {
    const { PgnParser } = await import('./services/pgn_parser');
    const parsedGames = PgnParser.parse(pgn);
    if (parsedGames.length === 0) {
      alert("No valid games found in PGN.");
      return;
    }
    const newGames: StoredGame[] = parsedGames.map((pg, i) => ({
      analyzed: {
        id: `pgn-${Date.now()}-${i}`,
        white: pg.headers['White'] || 'White',
        black: pg.headers['Black'] || 'Black',
        result: (pg.headers['Result'] as any) || '*',
        date: pg.headers['Date'] || new Date().toLocaleDateString(),
        deviations: [],
      },
      parsed: pg,
    }));
    setStoredGames(prev => [...newGames, ...prev]);
    // Auto-open first game
    setSelectedAnalyzedGame(newGames[0].analyzed);
    setLastGame(newGames[0].parsed);
    setActiveMode('analysis');
    setAnalysisView('viewer');
  } catch (e) {
    console.error("Import failed:", e);
    alert("Failed to import PGN.");
  } finally {
    setIsSyncing(false);
  }
};
```

**Step 4: Update the analysis hub render to pass storedGames and wire onSelectGame**

```tsx
{analysisView === 'hub' ? (
  <GameHub
    username={chessComUsername || "You"}
    games={storedGames.map(sg => ({
      id: sg.analyzed.id,
      date: sg.analyzed.date,
      white: sg.analyzed.white,
      black: sg.analyzed.black,
      result: sg.analyzed.result as '1-0' | '0-1' | '1/2-1/2',
      timeControl: sg.parsed.headers['TimeControl'] || '?',
    }))}
    onSelectGame={(id) => {
      const found = storedGames.find(sg => sg.analyzed.id === id);
      if (found) {
        setSelectedAnalyzedGame(found.analyzed);
        setLastGame(found.parsed);
        setAnalysisView('viewer');
      }
    }}
    onSyncLast={() => setShowChessComModal(true)}
    onImportPgn={() => setShowPgnModal(true)}
    onClose={() => handleNavigate('training')}
  />
```

**Step 5: Add modal visibility state to App.tsx**

```tsx
const [showPgnModal, setShowPgnModal] = useState(false);
const [showChessComModal, setShowChessComModal] = useState(false);
```

**Step 6: Render the two modals in App.tsx**

```tsx
{showPgnModal && (
  <PgnImportModal
    onClose={() => setShowPgnModal(false)}
    onImport={(pgn) => { setShowPgnModal(false); handlePgnUpload(pgn); }}
    isProcessing={isSyncing}
  />
)}
{showChessComModal && (
  <ChessComModal
    onClose={() => setShowChessComModal(false)}
    onSync={(username) => { setShowChessComModal(false); handleAnalyzeLastGame(username); }}
    isProcessing={isSyncing}
    initialUsername={chessComUsername || ''}
  />
)}
```

**Step 7: Create `src/components/PgnImportModal.tsx`**

```tsx
import React, { useState, useRef } from 'react';
import { Upload, X, FileText } from 'lucide-react';

interface Props {
  onClose: () => void;
  onImport: (pgn: string) => void;
  isProcessing: boolean;
}

export const PgnImportModal: React.FC<Props> = ({ onClose, onImport, isProcessing }) => {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText(content);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d1117] border border-white/10 rounded-[2.5rem] p-8 w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-black text-white uppercase tracking-wider text-sm flex items-center gap-2">
            <FileText size={16} className="text-indigo-400" /> Import PGN
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <input ref={fileRef} type="file" accept=".pgn" className="hidden" onChange={handleFile} />
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full border-2 border-dashed border-white/10 rounded-2xl py-6 text-slate-400 hover:text-white hover:border-indigo-500/40 transition-all text-sm font-bold mb-4 flex items-center justify-center gap-2"
        >
          <Upload size={16} /> Choose .pgn file
        </button>

        <p className="text-center text-slate-600 text-xs uppercase tracking-widest my-3">or paste PGN</p>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder='[Event "..."]\n[White "..."]\n...'
          rows={6}
          className="w-full bg-black/30 border border-white/10 rounded-2xl p-4 text-sm text-slate-300 font-mono resize-none focus:outline-none focus:border-indigo-500/50"
        />

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-2xl font-bold text-sm transition-all">
            Cancel
          </button>
          <button
            onClick={() => text.trim() && onImport(text.trim())}
            disabled={!text.trim() || isProcessing}
            className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-2xl font-bold text-sm transition-all"
          >
            {isProcessing ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

**Step 8: Create `src/components/ChessComModal.tsx`**

```tsx
import React, { useState } from 'react';
import { X, Activity } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSync: (username: string) => void;
  isProcessing: boolean;
  initialUsername: string;
}

export const ChessComModal: React.FC<Props> = ({ onClose, onSync, isProcessing, initialUsername }) => {
  const [username, setUsername] = useState(initialUsername);

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d1117] border border-white/10 rounded-[2.5rem] p-8 w-full max-w-sm shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-black text-white uppercase tracking-wider text-sm flex items-center gap-2">
            <Activity size={16} className="text-emerald-400" /> Chess.com Sync
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <p className="text-slate-400 text-sm mb-6">Fetches your most recent rated game.</p>
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && username.trim() && onSync(username.trim())}
          placeholder="Your Chess.com username"
          className="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 mb-6"
          autoFocus
        />
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-2xl font-bold text-sm transition-all">
            Cancel
          </button>
          <button
            onClick={() => username.trim() && onSync(username.trim())}
            disabled={!username.trim() || isProcessing}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-2xl font-bold text-sm transition-all"
          >
            {isProcessing ? 'Syncing...' : 'Sync Last Game'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

**Step 9: Update GameHub.tsx to accept and call `onImportPgn` and updated `onSyncLast`**

Add `onImportPgn: () => void` to `GameHubProps`. Replace the current single "Sync Last Game" button with two buttons:

```tsx
// In the header buttons div, replace onSyncLast button with:
<button
  onClick={onImportPgn}
  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-xl flex items-center gap-2"
>
  <Upload size={16} /> Import PGN
</button>
<button
  onClick={onSyncLast}
  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-xl flex items-center gap-2"
>
  <Activity size={16} /> Sync Chess.com
</button>
```

Also update the empty-state message: `"Import a PGN or sync from Chess.com to get started."` and fix `onClose` button label: `"Back to Training"`.

**Step 10: Remove the old ImportModal usage for analysis mode from App.tsx**

Delete the block:
```tsx
// DELETE:
{showChapters && activeMode === 'analysis' && (
  <ImportModal ... />
)}
```

**Step 11: TypeScript check**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | grep -v "ChapterLibrary\|GameAnalysis\|ai_coach\|useTraining.ts:89\|BookOpen"
```

Expected: no new errors.

---

## Task 3: Analysis — Deviation Computation & Drill Button

**Files:**
- Create: `src/utils/deviations.ts`
- Modify: `src/App.tsx` (GameAnalysis render block)
- Modify: `src/components/GameAnalysis.tsx` (onDrillDeviation call)

**Step 1: Create `src/utils/deviations.ts`**

```ts
import { ParsedGame } from '../services/pgn_parser';
import { Deviation } from '../components/GameAnalysis';

type PositionTree = Record<string, { san: string; nextFen: string }[]>;

export function computeDeviations(
  parsedGame: ParsedGame,
  positions: PositionTree,
  playerColor: 'white' | 'black',
): Deviation[] {
  const deviations: Deviation[] = [];

  for (let i = 0; i < parsedGame.moves.length; i++) {
    const move = parsedGame.moves[i];
    const isWhiteMove = i % 2 === 0;
    if ((playerColor === 'white') !== isWhiteMove) continue;

    const repertoireMoves = positions[move.fenBefore] || [];
    if (repertoireMoves.length === 0) continue; // position not in repertoire

    const repertoireMatch = repertoireMoves.find(m => m.san === move.san);
    if (!repertoireMatch) {
      // Player deviated
      deviations.push({
        moveNumber: Math.floor(i / 2) + 1,
        fen: move.fenBefore,
        playedSan: move.san,
        repertoireSan: repertoireMoves[0].san,
        evalDiff: 0, // Could fill with engine eval; 0 for now
      });
    }
  }

  return deviations;
}
```

**Step 2: Update App.tsx to compute deviations when opening a game**

In the `onSelectGame` handler added in Task 2, after finding `found`:

```tsx
onSelectGame={(id) => {
  const found = storedGames.find(sg => sg.analyzed.id === id);
  if (found) {
    const playerColor = found.analyzed.white === (chessComUsername || '') ? 'white' : 'black';
    const deviations = computeDeviations(found.parsed, positions, playerColor);
    setSelectedAnalyzedGame({ ...found.analyzed, deviations });
    setLastGame(found.parsed);
    setAnalysisView('viewer');
  }
}}
```

Add import at top: `import { computeDeviations } from './utils/deviations';`

**Step 3: Fix the "Drill Deviation" handler in App.tsx GameAnalysis render**

```tsx
<GameAnalysis
  game={selectedAnalyzedGame}
  parsedGame={lastGame || undefined}
  repertoireMoves={positions}
  onClose={() => { setAnalysisView('hub'); setSelectedAnalyzedGame(null); setLastGame(null); }}
  onDrillDeviation={(deviation) => {
    jumpToPosition(deviation.fen);
    handleNavigate('training');
  }}
/>
```

**Step 4: Re-enable the Drill Deviation button in GameAnalysis.tsx**

The button is already rendered in GameAnalysis.tsx's notation tab — search for `onDrillDeviation`. Currently deviations is always `[]` so the button never appears. With real deviations now populated, verify the button renders when `game.deviations.length > 0`.

If there's no deviation UI in GameAnalysis.tsx, add a deviations panel to the notation tab. After the move list grid, add:

```tsx
{game.deviations.length > 0 && (
  <div className="mt-6 border-t border-white/5 pt-4">
    <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-3 flex items-center gap-2">
      <Target size={12} /> {game.deviations.length} Repertoire Deviation{game.deviations.length !== 1 ? 's' : ''}
    </p>
    {game.deviations.map((d, i) => (
      <div key={i} className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-3 mb-2">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-[10px] font-mono text-slate-500">Move {d.moveNumber}: </span>
            <span className="text-sm font-bold text-rose-400">{d.playedSan}</span>
            <span className="text-slate-600 text-xs mx-2">→ should be</span>
            <span className="text-sm font-bold text-emerald-400">{d.repertoireSan}</span>
          </div>
          <button
            onClick={() => onDrillDeviation(d)}
            className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all flex items-center gap-1"
          >
            <Sword size={10} /> Drill
          </button>
        </div>
      </div>
    ))}
  </div>
)}
```

**Step 5: TypeScript check**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | grep -v "ChapterLibrary\|GameAnalysis\|ai_coach\|useTraining.ts:89\|BookOpen"
```

---

## Task 4: Game Lab — Stockfish Review Pipeline

**Files:**
- Modify: `src/services/engine.ts` (add `evaluateOnce` method)
- Create: `src/hooks/useGameReview.ts`
- Rewrite: `src/components/GameLab.tsx`

This is the largest task. Game Lab gets completely rebuilt. The current skeleton (calling non-existent API routes) is replaced with a client-side Stockfish pipeline.

**Step 1: Add `evaluateOnce` to `StockfishEngine` in `src/services/engine.ts`**

Add after the `evaluate()` method:

```ts
/**
 * Analyzes a single position to completion at the given depth.
 * Returns the best cp/mate score from the side-to-move's perspective.
 * Sets MultiPV to 1 for this call.
 */
evaluateOnce(fen: string, depth: number = 16): Promise<{ cp: number | null; mate: number | null }> {
  return new Promise((resolve) => {
    if (!this.worker) {
      resolve({ cp: null, mate: null });
      return;
    }

    let lastCp: number | null = null;
    let lastMate: number | null = null;
    const prevOnMessage = this.worker.onmessage;

    this.worker.onmessage = (e: MessageEvent) => {
      const data = e.data as string;
      if (typeof data !== 'string') return;

      const cpMatch = data.match(/score cp (-?\d+)/);
      const mateMatch = data.match(/score mate (-?\d+)/);
      if (cpMatch) lastCp = parseInt(cpMatch[1], 10);
      if (mateMatch) lastMate = parseInt(mateMatch[1], 10);

      if (data.startsWith('bestmove')) {
        this.worker!.onmessage = prevOnMessage;
        resolve({ cp: lastCp, mate: lastMate });
      }
    };

    this.worker.postMessage('setoption name MultiPV value 1');
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth}`);
  });
}

/** Stop any running search. */
stop() {
  if (this.worker) this.worker.postMessage('stop');
}
```

**Step 2: Create `src/hooks/useGameReview.ts`**

```ts
import { useState, useRef, useCallback } from 'react';
import { ParsedMove, ParsedGame } from '../services/pgn_parser';
import { StockfishEngine } from '../services/engine';

export type MoveGrade = 'brilliant' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface ReviewedMove {
  san: string;
  fenBefore: string;
  fenAfter: string;
  cpBefore: number;      // White's perspective, centipawns
  cpAfter: number;       // White's perspective, after player moved
  cpLoss: number;        // Always >= 0; loss for the moving side
  grade: MoveGrade;
  moveNumber: number;
  color: 'white' | 'black';
}

export interface GameReviewState {
  reviewedMoves: ReviewedMove[];
  isAnalyzing: boolean;
  progress: { current: number; total: number };
  error: string | null;
  analyzeGame: (game: ParsedGame) => void;
  cancelAnalysis: () => void;
  reset: () => void;
}

function classifyMove(cpLoss: number): MoveGrade {
  if (cpLoss < 5) return 'excellent';
  if (cpLoss < 25) return 'good';
  if (cpLoss < 100) return 'inaccuracy';
  if (cpLoss < 300) return 'mistake';
  return 'blunder';
}

// Clamp mate scores to ±2000cp for display
function normalizeCp(cp: number | null, mate: number | null, sideToMove: 'w' | 'b'): number {
  if (mate !== null) {
    const sign = mate > 0 ? 1 : -1;
    return sign * 2000 * (sideToMove === 'w' ? 1 : -1);
  }
  if (cp !== null) {
    // score is from side-to-move perspective; convert to White's perspective
    return sideToMove === 'w' ? cp : -cp;
  }
  return 0;
}

export function useGameReview(): GameReviewState {
  const [reviewedMoves, setReviewedMoves] = useState<ReviewedMove[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<StockfishEngine | null>(null);
  const cancelledRef = useRef(false);

  const cancelAnalysis = useCallback(() => {
    cancelledRef.current = true;
    engineRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    engineRef.current?.stop();
    setReviewedMoves([]);
    setIsAnalyzing(false);
    setProgress({ current: 0, total: 0 });
    setError(null);
  }, []);

  const analyzeGame = useCallback(async (game: ParsedGame) => {
    if (isAnalyzing) return;

    setReviewedMoves([]);
    setError(null);
    cancelledRef.current = false;

    // Create a dedicated engine for this review
    const engine = new StockfishEngine();
    engineRef.current = engine;

    // Wait for engine init (Stockfish fetches async from CDN)
    await new Promise(resolve => setTimeout(resolve, 2000));

    const moves = game.moves;
    setProgress({ current: 0, total: moves.length });
    setIsAnalyzing(true);

    const results: ReviewedMove[] = [];

    try {
      for (let i = 0; i < moves.length; i++) {
        if (cancelledRef.current) break;

        const move = moves[i];
        setProgress({ current: i + 1, total: moves.length });

        const colorToMove: 'w' | 'b' = move.fenBefore.split(' ')[1] as 'w' | 'b';

        // Eval before the move
        const evalBefore = await engine.evaluateOnce(move.fenBefore, 16);
        if (cancelledRef.current) break;

        // Eval after the move
        const evalAfter = await engine.evaluateOnce(move.fenAfter, 16);
        if (cancelledRef.current) break;

        const cpBefore = normalizeCp(evalBefore.cp, evalBefore.mate, colorToMove);
        // After the move, it's the opponent's turn
        const opponentColor: 'w' | 'b' = colorToMove === 'w' ? 'b' : 'w';
        const cpAfter = normalizeCp(evalAfter.cp, evalAfter.mate, opponentColor);

        // cp loss from the moving player's perspective
        const cpLoss = colorToMove === 'w'
          ? Math.max(0, cpBefore - cpAfter)
          : Math.max(0, cpAfter - cpBefore); // cpAfter is White's perspective

        // Actually simplify: cpLoss = how much White's eval changed against the moving player
        const cpLossSimplified = colorToMove === 'w'
          ? Math.max(0, cpBefore - cpAfter)
          : Math.max(0, cpAfter - cpBefore);

        results.push({
          san: move.san,
          fenBefore: move.fenBefore,
          fenAfter: move.fenAfter,
          cpBefore,
          cpAfter,
          cpLoss: cpLossSimplified,
          grade: classifyMove(cpLossSimplified),
          moveNumber: Math.floor(i / 2) + 1,
          color: colorToMove === 'w' ? 'white' : 'black',
        });

        // Update UI incrementally
        setReviewedMoves([...results]);
      }
    } catch (err) {
      setError('Analysis failed. Engine may have disconnected.');
    } finally {
      // Restore MultiPV 3 for main training use
      engine.quit();
      setIsAnalyzing(false);
    }
  }, [isAnalyzing]);

  return { reviewedMoves, isAnalyzing, progress, error, analyzeGame, cancelAnalysis, reset };
}
```

**Step 3: Rewrite `src/components/GameLab.tsx`**

Replace the entire file with:

```tsx
import React, { useState, useRef, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { Upload, Activity, BarChart3, ChevronLeft, ChevronRight, X, Loader2, FlaskConical } from 'lucide-react';
import { cn } from '../utils/cn';
import { useGameReview, MoveGrade } from '../hooks/useGameReview';
import { PgnParser } from '../services/pgn_parser';
import { useRepertoireStore } from '../stores/repertoireStore';

const GRADE_STYLES: Record<MoveGrade, { label: string; symbol: string; color: string; bg: string }> = {
  brilliant: { label: 'Brilliant', symbol: '!!', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  excellent:  { label: 'Excellent', symbol: '!',  color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  good:       { label: 'Good',      symbol: '',   color: 'text-slate-400', bg: '' },
  inaccuracy: { label: 'Inaccuracy',symbol: '?!', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  mistake:    { label: 'Mistake',   symbol: '?',  color: 'text-orange-400', bg: 'bg-orange-500/10' },
  blunder:    { label: 'Blunder',   symbol: '??', color: 'text-rose-400', bg: 'bg-rose-500/10' },
};

export const GameLab: React.FC = () => {
  const { chessComUsername } = useRepertoireStore();
  const { reviewedMoves, isAnalyzing, progress, error, analyzeGame, cancelAnalysis, reset } = useGameReview();
  const [boardMoveIdx, setBoardMoveIdx] = useState(-1);
  const [isSyncing, setIsSyncing] = useState(false);
  const [username, setUsername] = useState(chessComUsername || '');
  const fileRef = useRef<HTMLInputElement>(null);

  const hasResults = reviewedMoves.length > 0;

  const currentFen = useMemo(() => {
    if (boardMoveIdx < 0 || boardMoveIdx >= reviewedMoves.length) {
      return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    }
    return reviewedMoves[boardMoveIdx].fenAfter;
  }, [boardMoveIdx, reviewedMoves]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = PgnParser.parse(text);
    if (parsed.length > 0) {
      setBoardMoveIdx(-1);
      analyzeGame(parsed[0]);
    }
  };

  const handleChessComSync = async () => {
    if (!username.trim()) return;
    setIsSyncing(true);
    try {
      const { getLastGame } = await import('../services/chesscom');
      const game = await getLastGame(username.trim());
      if (game) {
        const { PgnParser } = await import('../services/pgn_parser');
        const parsed = PgnParser.parse(game.pgn);
        if (parsed.length > 0) {
          setBoardMoveIdx(-1);
          analyzeGame(parsed[0]);
        }
      }
    } catch (e) {
      console.error('Sync failed', e);
    } finally {
      setIsSyncing(false);
    }
  };

  // Summary counts
  const gradeCounts = useMemo(() => {
    const counts: Partial<Record<MoveGrade, number>> = {};
    for (const m of reviewedMoves) {
      counts[m.grade] = (counts[m.grade] || 0) + 1;
    }
    return counts;
  }, [reviewedMoves]);

  // Eval graph data (White's perspective, normalized to -10..10 range for display)
  const evalPoints = useMemo(() => reviewedMoves.map(m => m.cpAfter / 100), [reviewedMoves]);

  // ── Empty / Landing state ──────────────────────────────────────────────────
  if (!hasResults && !isAnalyzing) {
    return (
      <div className="flex flex-col h-full bg-[#050507] overflow-hidden font-outfit text-slate-200">
        <div className="h-14 border-b border-white/5 flex items-center px-6 bg-[#0a0d14] shrink-0 gap-3">
          <FlaskConical size={18} className="text-cyan-500" />
          <span className="font-black uppercase tracking-widest text-xs text-slate-400">Game Lab</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
          <div className="text-center max-w-sm">
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter italic mb-3">Game Review</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Upload a PGN or sync your latest Chess.com game. Stockfish will analyse every move and classify blunders, mistakes, and brilliant plays.
            </p>
          </div>

          {error && (
            <div className="text-rose-400 text-sm font-bold bg-rose-500/10 border border-rose-500/20 rounded-2xl px-6 py-3">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
            <input ref={fileRef} type="file" accept=".pgn" className="hidden" onChange={handleFile} />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold transition-all"
            >
              <Upload size={18} /> Upload PGN
            </button>

            <div className="flex-1 flex gap-2">
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChessComSync()}
                placeholder="Chess.com username"
                className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50"
              />
              <button
                onClick={handleChessComSync}
                disabled={isSyncing || !username.trim()}
                className="px-4 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-2xl font-bold transition-all"
              >
                {isSyncing ? <Loader2 size={18} className="animate-spin" /> : <Activity size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Analyzing state ─────────────────────────────────────────────────────────
  if (isAnalyzing && !hasResults) {
    return (
      <div className="flex flex-col h-full bg-[#050507] overflow-hidden font-outfit text-slate-200">
        <div className="h-14 border-b border-white/5 flex items-center px-6 bg-[#0a0d14] shrink-0 gap-3">
          <FlaskConical size={18} className="text-cyan-500" />
          <span className="font-black uppercase tracking-widest text-xs text-slate-400">Game Lab</span>
          <button onClick={cancelAnalysis} className="ml-auto text-slate-500 hover:text-rose-400 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <Loader2 size={48} className="text-cyan-400 animate-spin" />
          <div className="text-center">
            <p className="text-white font-bold text-lg mb-1">Analysing with Stockfish</p>
            <p className="text-slate-400 text-sm">
              Move {progress.current} / {progress.total}
            </p>
          </div>
          <div className="w-64 h-2 bg-white/5 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-cyan-500 transition-all duration-300 rounded-full"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
          <button onClick={cancelAnalysis} className="text-slate-500 hover:text-rose-400 text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Results state ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#050507] overflow-hidden font-outfit text-slate-200">
      {/* Header */}
      <div className="h-14 border-b border-white/5 flex items-center px-6 bg-[#0a0d14] shrink-0 gap-3">
        <FlaskConical size={18} className="text-cyan-500" />
        <span className="font-black uppercase tracking-widest text-xs text-slate-400">Game Lab</span>
        {isAnalyzing && (
          <span className="text-[10px] text-cyan-400 font-bold animate-pulse">
            Analysing... ({progress.current}/{progress.total})
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button
            onClick={reset}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all text-slate-400 hover:text-white"
          >
            New Game
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden flex-col lg:flex-row">
        {/* LEFT: Board + Eval Graph + Controls */}
        <div className="flex-1 flex flex-col items-center justify-center bg-[#0d1117]/20 p-4 lg:p-6 gap-4 min-h-0">
          {/* Summary chips */}
          <div className="flex flex-wrap gap-2 justify-center">
            {(['blunder', 'mistake', 'inaccuracy', 'excellent'] as MoveGrade[]).map(grade => {
              const count = gradeCounts[grade] || 0;
              if (count === 0) return null;
              const { label, symbol, color, bg } = GRADE_STYLES[grade];
              return (
                <span key={grade} className={cn('px-3 py-1 rounded-full text-[10px] font-black border border-white/10', color, bg)}>
                  {symbol ? `${symbol} ` : ''}{count} {label}{count !== 1 ? 's' : ''}
                </span>
              );
            })}
          </div>

          {/* Board */}
          <div className="w-full max-w-[min(60vh,480px)] aspect-square rounded-2xl overflow-hidden border-[10px] border-[#161b22] shadow-2xl bg-[#161b22]">
            <Chessboard
              position={currentFen}
              arePiecesDraggable={false}
              boardOrientation="white"
              animationDuration={200}
            />
          </div>

          {/* Eval graph (simple SVG bar chart) */}
          <div className="w-full max-w-[min(60vh,480px)] h-12 bg-black/30 border border-white/5 rounded-xl overflow-hidden relative">
            <svg width="100%" height="100%" preserveAspectRatio="none">
              {evalPoints.map((cp, i) => {
                const normalised = Math.max(-10, Math.min(10, cp));
                const isWhiteAhead = normalised > 0;
                const heightPct = Math.abs(normalised) / 10 * 50;
                return (
                  <rect
                    key={i}
                    x={`${(i / evalPoints.length) * 100}%`}
                    y={isWhiteAhead ? `${50 - heightPct}%` : '50%'}
                    width={`${100 / evalPoints.length}%`}
                    height={`${heightPct}%`}
                    fill={isWhiteAhead ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)'}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setBoardMoveIdx(i)}
                  />
                );
              })}
              {/* Midline */}
              <line x1="0" y1="50%" x2="100%" y2="50%" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
              {/* Cursor */}
              {boardMoveIdx >= 0 && (
                <line
                  x1={`${((boardMoveIdx + 0.5) / evalPoints.length) * 100}%`}
                  y1="0"
                  x2={`${((boardMoveIdx + 0.5) / evalPoints.length) * 100}%`}
                  y2="100%"
                  stroke="#6366f1"
                  strokeWidth="1.5"
                />
              )}
            </svg>
            <div className="absolute bottom-1 right-2 text-[9px] text-slate-600 font-mono">
              {BarChart3 && <BarChart3 size={8} className="inline mr-1" />}eval graph
            </div>
          </div>

          {/* Navigator */}
          <div className="flex items-center gap-2 bg-[#0d1117] border border-white/10 p-1 rounded-xl shadow-xl">
            <button onClick={() => setBoardMoveIdx(-1)} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white">
              <ChevronLeft size={18} />
            </button>
            <span className="text-xs font-mono text-slate-400 px-2 min-w-[80px] text-center">
              {boardMoveIdx < 0 ? 'Start' : `Move ${reviewedMoves[boardMoveIdx]?.moveNumber} (${reviewedMoves[boardMoveIdx]?.color[0].toUpperCase()})`}
            </span>
            <button
              onClick={() => setBoardMoveIdx(i => Math.min(reviewedMoves.length - 1, i + 1))}
              className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* RIGHT: Move List */}
        <div className="w-full lg:w-[360px] bg-[#0a0d14] border-l border-white/5 flex flex-col shrink-0 overflow-hidden">
          <div className="p-4 border-b border-white/5 bg-[#080a0f]">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Move Analysis</h3>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
            {reviewedMoves.map((move, i) => {
              const { symbol, color, bg } = GRADE_STYLES[move.grade];
              const isActive = boardMoveIdx === i;
              return (
                <button
                  key={i}
                  onClick={() => setBoardMoveIdx(i)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left',
                    isActive ? 'bg-indigo-600/20 border border-indigo-500/30' : 'hover:bg-white/5',
                  )}
                >
                  <span className="text-[10px] font-mono text-slate-600 min-w-[28px]">
                    {move.moveNumber}{move.color === 'white' ? '.' : '...'}
                  </span>
                  <span className={cn('font-bold text-sm min-w-[48px]', move.color === 'white' ? 'text-white' : 'text-slate-300')}>
                    {move.san}
                  </span>
                  {symbol && (
                    <span className={cn('text-xs font-black px-1.5 py-0.5 rounded', color, bg)}>
                      {symbol}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-mono text-slate-600">
                    {move.cpLoss > 0 ? `-${(move.cpLoss / 100).toFixed(1)}` : ''}
                  </span>
                </button>
              );
            })}
            {isAnalyzing && (
              <div className="flex items-center gap-2 px-3 py-2 text-slate-600 text-xs animate-pulse">
                <Loader2 size={12} className="animate-spin" /> Analysing...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
```

**Step 4: TypeScript check**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | grep -v "ChapterLibrary\|GameAnalysis\|ai_coach\|useTraining.ts:89\|BookOpen"
```

---

## Task 5: Training & Coach Polish

**Files:**
- Modify: `src/components/ProgressDashboard.tsx`
- Modify: `src/components/CoachPanel.tsx`
- Modify: `src/services/ai_coach.ts`
- Modify: `src/stores/coachStore.ts`
- Delete: `src/stores/gameStore.ts`

**Step 1: Fix "Fix Weak Spots" in ProgressDashboard.tsx**

The dashboard is opened from App.tsx as an overlay with `showDashboard`. It has `onClose` and `onSelectChapter` props. It needs a new prop: `onDrillWeak`.

In `src/components/ProgressDashboard.tsx`, update props:

```tsx
interface ProgressDashboardProps {
  onClose: () => void;
  onSelectChapter: (idx: number) => void;
  onDrillWeak: () => void;  // NEW
  totalPositions: number;
}
```

Find the "Weak Points" stat card and make it clickable:

```tsx
// In the stats grid, replace the Weak Points stat div with:
<button
  key={i}
  onClick={stat.label === 'Weak Points' ? onDrillWeak : undefined}
  className={cn(
    "bg-[#11151c] border border-white/10 p-8 rounded-[2.5rem] relative overflow-hidden group shadow-xl text-left",
    stat.label === 'Weak Points' && weakCount > 0 ? "hover:border-rose-500/40 cursor-pointer" : ""
  )}
>
  ...
</button>
```

Also add a standalone "Drill Weak Spots" button below the stats:

```tsx
{weakCount > 0 && (
  <div className="mt-8 flex justify-center">
    <button
      onClick={onDrillWeak}
      className="px-8 py-4 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl flex items-center gap-3 transition-all"
    >
      <AlertTriangle size={16} /> Drill {weakCount} Weak Position{weakCount !== 1 ? 's' : ''}
    </button>
  </div>
)}
```

**Step 2: Wire onDrillWeak in App.tsx**

In the ProgressDashboard render:
```tsx
<ProgressDashboard
  onClose={() => setDashboard(false)}
  onSelectChapter={(idx: number) => { selectChapter(idx); startTraining(idx); setDashboard(false); }}
  onDrillWeak={() => {
    useTrainingStore.getState().setMode('weak');
    startTraining();
    setDashboard(false);
  }}
  totalPositions={Object.keys(positions).length}
/>
```

Check `trainingStore` has a `setMode` action. If not, look for how mode is set — it may be `ts.setMode('weak')` or a direct store setter.

**Step 3: Add coach error state to ai_coach.ts**

Update the return type and the catch block to include an `isError` flag:

```ts
export async function analyzePosition(fen: string, lastMove: string, _turn: string): Promise<{
  text: string;
  demoLine: string[];
  isError: boolean;
}> {
  // ... existing logic ...

  // Change error return:
  if (!API_KEY) {
    return { text: "API key missing — set VITE_GEMINI_API_KEY in .env.local", demoLine: [], isError: true };
  }

  // In catch:
  return { text: "Coach unavailable — check your connection and API key.", demoLine: [], isError: true };

  // On success:
  return { text: analysisPart || "...", demoLine: ..., isError: false };
}
```

**Step 4: Update coachStore.ts to track error state**

In `src/stores/coachStore.ts`, add `isError: boolean` to state and set it from the return value of `analyzePosition`. Find the `analyzePosition` action and update:

```ts
// Add to state interface:
isError: boolean;

// In analyzePosition action:
const result = await analyzePosition(fen, lastMove, turn);
set({ currentInsight: result.text, demoLine: result.demoLine, isAnalyzing: false, isError: result.isError });
```

**Step 5: Update CoachPanel.tsx to show error state**

```tsx
const { currentInsight, demoLine, isAnalyzing, isError } = useCoachStore();

// In the insight display area, replace:
// OLD: <div className="...">Awaiting Data Input</div>
// NEW:
{isError ? (
  <div className="h-full flex flex-col items-center justify-center gap-3">
    <p className="text-rose-400 text-xs font-bold text-center leading-relaxed">{currentInsight}</p>
    <button onClick={onDeepAnalysis} className="text-[10px] text-indigo-400 hover:text-indigo-300 uppercase tracking-widest font-black">
      Retry
    </button>
  </div>
) : currentInsight ? (
  <div className="...existing insight display...">
    "{currentInsight}"
  </div>
) : (
  <div className="h-full flex flex-col items-center justify-center text-slate-700 font-black uppercase tracking-[0.2em] text-[10px]">
    Request an analysis
  </div>
)}
```

**Step 6: Delete gameStore.ts**

```bash
rm "/Users/kevin/Chess Trainer/src/stores/gameStore.ts"
```

Check nothing imports it:
```bash
grep -r "gameStore" "/Users/kevin/Chess Trainer/src" --include="*.ts" --include="*.tsx"
```

If imports exist, remove them.

**Step 7: Final TypeScript check**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | grep -v "ChapterLibrary\|ai_coach\|useTraining.ts:89\|BookOpen"
```

Expected: zero new errors beyond the pre-existing ones.

---

## Verification Checklist

After all tasks:

- [ ] Clicking "Library" sidebar item opens a full-screen view (not an overlay)
- [ ] Selecting a chapter from Library starts training and navigates to Training mode
- [ ] Clicking "Analyze" → "Import PGN" opens a clean import dialog; game appears in game list
- [ ] Clicking "Analyze" → "Sync Chess.com" prompts for username, fetches game, adds to list
- [ ] Clicking a game in the hub opens it in the viewer
- [ ] Deviation badges appear in the viewer when player deviated from repertoire
- [ ] "Drill" button on a deviation navigates to Training at that FEN
- [ ] Game Lab: upload a PGN → progress bar → move list with blunder/mistake symbols
- [ ] Game Lab: clicking a move updates the board to that position
- [ ] Dashboard "Weak Points" / "Drill Weak Spots" button starts weak-spot drilling
- [ ] Coach panel shows "Coach unavailable" (not "Awaiting Data Input") when API key is missing
- [ ] `npx tsc --noEmit` has no new errors vs baseline
