# Opening Explorer Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Explore" mode to the training tab where the user controls both sides freely, sees clickable repertoire move chips with engine comparison badges, and can auto-play the mainline from any position.

**Architecture:** Add `'explore'` to `TrainingMode`. Update `onDrop` to allow any legal move without validation in explore mode. Add three new functions to `useTraining` (`playRepertoireMove`, `playMainline`, `demoEngineLine`), wire them through `App.tsx` → `TrainTab`, and render them in a new `ExplorePanel` (desktop) and updated `TrainingCoachWidget` (mobile).

**Tech Stack:** React, TypeScript, Zustand, chess.js, Tailwind CSS, lucide-react

---

### Task 1: Add `'explore'` to TrainingMode and fix board behavior

**Files:**
- Modify: `src/stores/trainingStore.ts` (line 4)
- Modify: `src/hooks/useTraining.ts` (lines 388, 431)

**Step 1: Add `'explore'` to the TrainingMode union**

In `src/stores/trainingStore.ts`, line 4, change:
```ts
export type TrainingMode = 'full' | 'weak' | 'quiz' | 'learn' | 'study';
```
to:
```ts
export type TrainingMode = 'full' | 'weak' | 'quiz' | 'learn' | 'study' | 'explore';
```

**Step 2: Allow free moves in `onDrop` for explore mode**

In `src/hooks/useTraining.ts`, find line 431 (the `onDrop` callback). It currently reads:
```ts
if (status === 'idle' || status === 'complete' || awaitingNext || status === 'demo' || status === 'correct' || ts.mode === 'study') return false;
```

Replace with:
```ts
if (status === 'demo') return false;

// Explore mode: allow any legal move freely, no validation
if (ts.mode === 'explore') {
  try {
    const g = new Chess(gameRef.current.fen());
    const move = g.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
    if (!move) return false;
    playSound(move.captured ? 'capture' : 'move');
    gameRef.current = g;
    syncFen();
    ts.addToHistory(move.san);
    ts.setArrows([]);
    useCoachStore.getState().setInsight(null);
    return true;
  } catch { return false; }
}

if (status === 'idle' || status === 'complete' || awaitingNext || status === 'correct' || ts.mode === 'study') return false;
```

**Step 3: Make `stepBackward` go back 1 move in explore mode**

In `src/hooks/useTraining.ts`, find line 388 (inside `stepBackward`):
```ts
const popCount = mode === 'study' ? 1 : 2;
```
Change to:
```ts
const popCount = (mode === 'study' || mode === 'explore') ? 1 : 2;
```

**Step 4: Verify build passes**

```bash
cd "/Users/kevin/Chess Trainer" && npm run build
```
Expected: `✓ built in ~6s` with no TypeScript errors.

**Step 5: Commit**
```bash
cd "/Users/kevin/Chess Trainer"
git add src/stores/trainingStore.ts src/hooks/useTraining.ts
git commit -m "feat: add explore TrainingMode with free-move board behavior"
```

---

### Task 2: Add `playRepertoireMove`, `playMainline`, `demoEngineLine` to useTraining

**Files:**
- Modify: `src/hooks/useTraining.ts` (after the `stepBackward` callback, before the `handleNext` callback around line 403)
- Modify: `src/hooks/useTraining.ts` (return object at line 717)

**Step 1: Add `playRepertoireMove`**

After the `stepBackward` callback (around line 402), insert:

```ts
const playRepertoireMove = useCallback((san: string) => {
  const ts = useTrainingStore.getState();
  if (ts.status === 'demo') return;
  try {
    const g = new Chess(gameRef.current.fen());
    const move = g.move(san);
    if (!move) return;
    playSound(move.captured ? 'capture' : 'move');
    gameRef.current = g;
    syncFen();
    ts.addToHistory(move.san);
    ts.setArrows([]);
    useCoachStore.getState().setInsight(null);
  } catch { /* ignore invalid moves */ }
}, [playSound, syncFen]);
```

**Step 2: Add `playMainline`**

Immediately after `playRepertoireMove`:

```ts
const playMainline = useCallback(async () => {
  const rs = useRepertoireStore.getState();
  const line: string[] = [];
  const tempGame = new Chess(gameRef.current.fen());
  let safety = 0;
  while (safety < 60) {
    const moves = rs.getCorrectMoves(tempGame.fen());
    if (moves.length === 0) break;
    try {
      const m = tempGame.move(moves[0].san);
      if (!m) break;
      line.push(m.san);
    } catch { break; }
    safety++;
  }
  if (line.length === 0) return;

  const originalFen = gameRef.current.fen();
  const demoGame = new Chess(originalFen);
  useTrainingStore.getState().setStatus('demo');

  for (const moveSan of line) {
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
    try {
      const m = demoGame.move(moveSan);
      if (m) {
        gameRef.current = new Chess(demoGame.fen());
        syncFen();
        playSound(m.captured ? 'capture' : 'move');
        useTrainingStore.getState().setArrows([
          [m.from as Square, m.to as Square, 'rgba(99,102,241,0.8)'],
        ]);
      }
    } catch { break; }
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  gameRef.current = new Chess(originalFen);
  syncFen();
  useTrainingStore.getState().setArrows([]);
  useTrainingStore.getState().setStatus('training');
}, [playSound, syncFen]);
```

**Step 3: Add `demoEngineLine`**

Immediately after `playMainline`:

```ts
const demoEngineLine = useCallback(async (pv: string) => {
  const uciMoves = pv.split(' ').filter(Boolean);
  const sanMoves: string[] = [];
  const tempGame = new Chess(gameRef.current.fen());
  for (const uci of uciMoves) {
    if (uci.length < 4) break;
    try {
      const m = tempGame.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      if (!m) break;
      sanMoves.push(m.san);
    } catch { break; }
  }
  if (sanMoves.length === 0) return;

  const originalFen = gameRef.current.fen();
  const demoGame = new Chess(originalFen);
  useTrainingStore.getState().setStatus('demo');

  for (const moveSan of sanMoves) {
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
    try {
      const m = demoGame.move(moveSan);
      if (m) {
        gameRef.current = new Chess(demoGame.fen());
        syncFen();
        playSound(m.captured ? 'capture' : 'move');
        useTrainingStore.getState().setArrows([
          [m.from as Square, m.to as Square, 'rgba(234,179,8,0.8)'],
        ]);
      }
    } catch { break; }
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  gameRef.current = new Chess(originalFen);
  syncFen();
  useTrainingStore.getState().setArrows([]);
  useTrainingStore.getState().setStatus('training');
}, [playSound, syncFen]);
```

**Step 4: Add the three functions to the return object**

Find the `return {` block near line 717. Add the three new functions:
```ts
return {
  getFen,
  onDrop,
  handleNext,
  startTraining,
  goBack,
  playDemo,
  handleDeepAnalysis,
  resetGame,
  jumpToPosition,
  jumpToMove,
  showSolution,
  giveUp,
  restartChapter,
  stepBackward,
  playRepertoireMove,   // new
  playMainline,          // new
  demoEngineLine,        // new
};
```

**Step 5: Build**
```bash
cd "/Users/kevin/Chess Trainer" && npm run build
```
Expected: no TypeScript errors.

**Step 6: Commit**
```bash
cd "/Users/kevin/Chess Trainer"
git add src/hooks/useTraining.ts
git commit -m "feat: add playRepertoireMove, playMainline, demoEngineLine to useTraining"
```

---

### Task 3: Create `ExplorePanel.tsx`

**Files:**
- Create: `src/components/ExplorePanel.tsx`

**Step 1: Create the file**

```tsx
import React, { useMemo } from 'react';
import { Chess } from 'chess.js';
import { Compass, Play, Zap } from 'lucide-react';
import { useEngineStore } from '../stores/engineStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useTrainingStore } from '../stores/trainingStore';
import { cn } from '../utils/cn';

interface ExplorePanelProps {
  fen: string;
  onPlayMove: (san: string) => void;
  onPlayMainline: () => void;
  onDemoEngineLine: (pv: string) => void;
}

/** Convert the first move of a UCI pv string to SAN at the given FEN. */
function uciFirstMoveToSan(fen: string, pv: string): string | null {
  const uciMove = pv.split(' ')[0];
  if (!uciMove || uciMove.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uciMove.slice(0, 2),
      to: uciMove.slice(2, 4),
      promotion: uciMove[4] || undefined,
    });
    return move?.san ?? null;
  } catch { return null; }
}

/** Format a UCI pv as SAN moves (e.g. "d4 Nf6 Nc3") */
function formatPvSan(fen: string, pv: string, maxMoves = 5): string {
  const uciMoves = pv.split(' ').slice(0, maxMoves);
  const result: string[] = [];
  const chess = new Chess(fen);
  for (const uci of uciMoves) {
    if (uci.length < 4) break;
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
      if (!m) break;
      result.push(m.san);
    } catch { break; }
  }
  return result.join(' ');
}

export const ExplorePanel: React.FC<ExplorePanelProps> = ({
  fen,
  onPlayMove,
  onPlayMainline,
  onDemoEngineLine,
}) => {
  const { topLines, showLines } = useEngineStore();
  const { status } = useTrainingStore();
  const getCorrectMoves = useRepertoireStore(s => s.getCorrectMoves);

  const repertoireMoves = useMemo(() => getCorrectMoves(fen), [getCorrectMoves, fen]);

  // Build a map: SAN → engine rank (1, 2, or 3) for moves that appear in top 3 PVs
  const engineRankBySan = useMemo(() => {
    const map = new Map<string, number>();
    if (!showLines) return map;
    topLines.slice(0, 3).forEach((line, i) => {
      const san = uciFirstMoveToSan(fen, line.pv);
      if (san) map.set(san, i + 1);
    });
    return map;
  }, [topLines, fen, showLines]);

  const isDemo = status === 'demo';

  return (
    <div className="flex flex-col gap-5 p-6 overflow-y-auto custom-scrollbar flex-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-500 flex items-center gap-2">
          <Compass size={14} /> Opening Explorer
        </h3>
        {repertoireMoves.length > 0 && (
          <button
            onClick={onPlayMainline}
            disabled={isDemo}
            className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-30 active:scale-95"
          >
            <Play size={10} /> Mainline
          </button>
        )}
      </div>

      {/* Repertoire moves */}
      <div>
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-2.5">
          {repertoireMoves.length > 0 ? 'Repertoire Lines' : 'Off Book'}
        </p>
        {repertoireMoves.length === 0 ? (
          <p className="text-slate-600 text-xs italic leading-relaxed">
            No repertoire moves from this position — you're exploring off-book territory.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {repertoireMoves.map((move) => {
              const rank = engineRankBySan.get(move.san);
              return (
                <button
                  key={move.san}
                  onClick={() => onPlayMove(move.san)}
                  disabled={isDemo}
                  className={cn(
                    'flex items-start gap-3 w-full text-left px-3 py-2.5 rounded-xl border transition-all active:scale-[0.98] disabled:opacity-30',
                    rank
                      ? 'bg-indigo-600/10 border-indigo-500/30 hover:bg-indigo-600/20'
                      : 'bg-white/[0.03] border-white/5 hover:bg-white/5',
                  )}
                >
                  <span className={cn(
                    'text-sm font-black font-mono shrink-0 mt-0.5',
                    rank ? 'text-white' : 'text-slate-400',
                  )}>
                    {move.san}
                  </span>
                  <div className="flex-1 min-w-0">
                    {move.comment && (
                      <p className="text-[10px] text-slate-500 leading-snug line-clamp-2">{move.comment}</p>
                    )}
                  </div>
                  {rank && showLines && (
                    <span className={cn(
                      'text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0 border',
                      rank === 1 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                      rank === 2 ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' :
                                   'bg-slate-500/20 text-slate-400 border-slate-500/30',
                    )}>
                      Engine #{rank}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Clickable engine lines */}
      {showLines && topLines.length > 0 && (
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-600 mb-2.5">Engine Lines</p>
          <div className="flex flex-col gap-1.5">
            {topLines.slice(0, 3).map((line, i) => {
              const scoreStr = line.mate !== null
                ? `M${Math.abs(line.mate)}`
                : line.cp !== null
                  ? `${line.cp > 0 ? '+' : ''}${(line.cp / 100).toFixed(1)}`
                  : '—';
              const formattedLine = formatPvSan(fen, line.pv, 6);
              return (
                <button
                  key={i}
                  onClick={() => onDemoEngineLine(line.pv)}
                  disabled={isDemo}
                  className="flex items-baseline gap-3 w-full text-left px-3 py-2 rounded-xl bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10 hover:border-amber-500/20 transition-all disabled:opacity-30 active:scale-[0.98]"
                >
                  <span className="font-mono text-amber-400 w-10 shrink-0 text-right text-xs">{scoreStr}</span>
                  <span className="text-slate-400 font-mono text-xs truncate">{formattedLine}</span>
                  <Zap size={10} className="text-amber-400/40 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
```

**Step 2: Build**
```bash
cd "/Users/kevin/Chess Trainer" && npm run build
```
Expected: no TypeScript errors.

**Step 3: Commit**
```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/ExplorePanel.tsx
git commit -m "feat: add ExplorePanel component for opening explorer desktop sidebar"
```

---

### Task 4: Update ModeSelector to include Explore

**Files:**
- Modify: `src/components/ModeSelector.tsx`

**Step 1: Add `Compass` to imports**

Change line 2 from:
```tsx
import { Play, Target, Brain, BookOpen, GraduationCap } from 'lucide-react';
```
to:
```tsx
import { Play, Target, Brain, BookOpen, GraduationCap, Compass } from 'lucide-react';
```

**Step 2: Add explore entry to the modes array**

Find the `modes` array (lines 13–19). Add the explore entry:
```tsx
const modes: { id: TrainingMode; label: string; icon: any; desc: string }[] = [
  { id: 'study',   label: 'Study',    icon: GraduationCap, desc: 'Guided walkthrough: plays moves and shows annotations' },
  { id: 'learn',   label: 'Learn',    icon: BookOpen,      desc: 'Step-by-step: move is shown, repeat 3× to master' },
  { id: 'full',    label: 'Full Line',icon: Play,          desc: 'Master sequences from start to finish' },
  { id: 'weak',    label: 'Weak Spot',icon: Target,        desc: 'Drill positions you previously missed' },
  { id: 'quiz',    label: 'Quiz',     icon: Brain,         desc: 'Random mid-game position challenges' },
  { id: 'explore', label: 'Explore',  icon: Compass,       desc: 'Free exploration: browse lines, compare engine suggestions, demo the mainline' },
];
```

**Step 3: Build**
```bash
cd "/Users/kevin/Chess Trainer" && npm run build
```

**Step 4: Commit**
```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/ModeSelector.tsx
git commit -m "feat: add Explore to ModeSelector"
```

---

### Task 5: Wire everything in `App.tsx` and `TrainTab.tsx`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TrainTab.tsx`

**Step 1: Extract new functions in `App.tsx`**

In `src/App.tsx`, update the destructuring at lines 17–22:
```tsx
const {
  getFen, onDrop, handleNext, startTraining,
  playDemo, handleDeepAnalysis, jumpToMove,
  showSolution, giveUp, resetGame, restartChapter,
  stepBackward, jumpToPosition,
  playRepertoireMove, playMainline, demoEngineLine,  // new
} = useTraining();
```

**Step 2: Pass new props to `TrainTab` in `App.tsx`**

Add three new props to the `<TrainTab ...>` element:
```tsx
<TrainTab
  fen={getFen()}
  onDrop={onDrop}
  onProceed={handleNext}
  onBack={stepBackward}
  onReset={restartChapter}
  onStartTraining={startTraining}
  onDeepAnalysis={handleDeepAnalysis}
  onPlayDemo={playDemo}
  onShowSolution={showSolution}
  onGiveUp={giveUp}
  onJumpToMove={jumpToMove}
  onPlayRepertoireMove={playRepertoireMove}   // new
  onPlayMainline={playMainline}               // new
  onDemoEngineLine={demoEngineLine}           // new
/>
```

**Step 3: Update `TrainTab` props interface**

In `src/components/TrainTab.tsx`, add to the `TrainTabProps` interface:
```tsx
interface TrainTabProps {
  fen: string;
  onDrop: (source: string, target: string) => boolean;
  onProceed: () => void;
  onBack: () => void;
  onReset: () => void;
  onStartTraining: (chapterIdx?: number) => void;
  onDeepAnalysis: () => void;
  onPlayDemo: () => void;
  onShowSolution: () => void;
  onGiveUp: () => void;
  onJumpToMove: (flatIdx: number) => void;
  onPlayRepertoireMove: (san: string) => void;  // new
  onPlayMainline: () => void;                    // new
  onDemoEngineLine: (pv: string) => void;        // new
}
```

**Step 4: Destructure new props in `TrainTab`**

Update the destructuring at the top of the component:
```tsx
export const TrainTab: React.FC<TrainTabProps> = ({
  fen,
  onDrop,
  onProceed,
  onBack,
  onReset,
  onStartTraining,
  onDeepAnalysis,
  onPlayDemo,
  onShowSolution,
  onGiveUp,
  onJumpToMove,
  onPlayRepertoireMove,  // new
  onPlayMainline,         // new
  onDemoEngineLine,       // new
}) => {
```

**Step 5: Add Explore to the mobile mode strip in `TrainTab`**

The mobile strip uses a `MOBILE_MODES` array. Import `Compass` and add explore:
```tsx
import {
  ChevronLeft, ChevronRight, RotateCw,
  GraduationCap, BookOpen, Play, Target, Brain, Compass,  // add Compass
  Layers, BarChart2, Cpu, Wand2,
} from 'lucide-react';

const MOBILE_MODES: { id: TrainingMode; label: string; icon: React.ElementType }[] = [
  { id: 'study',   label: 'Study',   icon: GraduationCap },
  { id: 'learn',   label: 'Learn',   icon: BookOpen },
  { id: 'full',    label: 'Full',    icon: Play },
  { id: 'weak',    label: 'Weak',    icon: Target },
  { id: 'quiz',    label: 'Quiz',    icon: Brain },
  { id: 'explore', label: 'Explore', icon: Compass },  // new
];
```

**Step 6: Add `ExplorePanel` to desktop sidebar in `TrainTab`**

Import `ExplorePanel` at the top of `TrainTab.tsx`:
```tsx
import { ExplorePanel } from './ExplorePanel';
```

In the desktop sidebar section (the `hidden lg:flex` div), replace:
```tsx
<CoachPanel
  onDeepAnalysis={onDeepAnalysis}
  onPlayDemo={onPlayDemo}
  onShowSolution={onShowSolution}
  onGiveUp={onGiveUp}
/>
```
with:
```tsx
{mode === 'explore' ? (
  <ExplorePanel
    fen={fen}
    onPlayMove={onPlayRepertoireMove}
    onPlayMainline={onPlayMainline}
    onDemoEngineLine={onDemoEngineLine}
  />
) : (
  <CoachPanel
    onDeepAnalysis={onDeepAnalysis}
    onPlayDemo={onPlayDemo}
    onShowSolution={onShowSolution}
    onGiveUp={onGiveUp}
  />
)}
```

Also hide `TacticalMonitor` in explore mode (it shows training status which is irrelevant). Wrap it:
```tsx
{mode !== 'explore' && <TacticalMonitor />}
```

**Step 7: Pass `fen` and explore handlers to `TrainingCoachWidget` (mobile)**

Update the `<TrainingCoachWidget>` usage in `TrainTab`:
```tsx
<TrainingCoachWidget
  fen={fen}                                        // new
  onDeepAnalysis={onDeepAnalysis}
  onShowSolution={onShowSolution}
  onGiveUp={onGiveUp}
  coachActive={coachActive}
  onCoachActiveChange={setCoachActive}
  onPlayMove={onPlayRepertoireMove}               // new
  onPlayMainline={onPlayMainline}                 // new
  onDemoEngineLine={onDemoEngineLine}             // new
/>
```

**Step 8: Build**
```bash
cd "/Users/kevin/Chess Trainer" && npm run build
```
Expected: TypeScript errors about missing props on `TrainingCoachWidget` — that's fine, Task 6 will fix them.

**Step 9: Commit after Task 6 fixes the errors** (hold commit until Task 6 is done)

---

### Task 6: Update `TrainingCoachWidget` for explore mode (mobile)

**Files:**
- Modify: `src/components/TrainingCoachWidget.tsx`

**Step 1: Add new props to the interface**

```tsx
interface TrainingCoachWidgetProps {
  fen: string;                              // new
  onDeepAnalysis: () => void;
  onShowSolution: () => void;
  onGiveUp: () => void;
  coachActive?: boolean;
  onCoachActiveChange?: (active: boolean) => void;
  onPlayMove?: (san: string) => void;       // new
  onPlayMainline?: () => void;              // new
  onDemoEngineLine?: (pv: string) => void; // new
}
```

**Step 2: Destructure the new props**

```tsx
export const TrainingCoachWidget: React.FC<TrainingCoachWidgetProps> = ({
  fen,
  onDeepAnalysis,
  onShowSolution,
  onGiveUp,
  coachActive = false,
  onCoachActiveChange,
  onPlayMove,
  onPlayMainline,
  onDemoEngineLine,
}) => {
```

**Step 3: Read engine and repertoire state inside the component**

Add these lines after the existing store reads (after line with `useCoachStore`):
```tsx
const { topLines, showLines } = useEngineStore();
const getCorrectMoves = useRepertoireStore(s => s.getCorrectMoves);
```

Also add the needed imports at the top of the file:
```tsx
import { useEngineStore } from '../stores/engineStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useMemo } from 'react';
import { Chess } from 'chess.js';
```

**Step 4: Compute repertoire moves and engine ranks inside the component**

```tsx
const isExplore = mode === 'explore';

const repertoireMoves = useMemo(
  () => (isExplore ? getCorrectMoves(fen) : []),
  [isExplore, getCorrectMoves, fen]
);

const engineRankBySan = useMemo(() => {
  const map = new Map<string, number>();
  if (!isExplore || !showLines) return map;
  topLines.slice(0, 3).forEach((line, i) => {
    const uciMove = line.pv.split(' ')[0];
    if (!uciMove || uciMove.length < 4) return;
    try {
      const chess = new Chess(fen);
      const m = chess.move({ from: uciMove.slice(0, 2), to: uciMove.slice(2, 4), promotion: uciMove[4] || undefined });
      if (m) map.set(m.san, i + 1);
    } catch { /* ignore */ }
  });
  return map;
}, [isExplore, showLines, topLines, fen]);
```

**Step 5: Render explore UI when `mode === 'explore'`**

Replace the entire `return (...)` with this updated version. The key change is: when `isExplore`, show the move chips and engine lines instead of the standard message area.

```tsx
return (
  <div className={cn(
    'flex items-start gap-3 px-4 py-3 border-t transition-all duration-500 shrink-0',
    borderColor,
  )}>
    {/* Avatar */}
    <button
      onClick={handleAvatarTap}
      className={cn(
        'w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg shrink-0 mt-0.5',
        'transition-all duration-500 active:scale-95',
        avatarBg,
        isAnalyzing && widgetMode === 'analysis' && 'animate-pulse',
      )}
      aria-label={widgetMode === 'analysis' ? 'Dismiss analysis' : 'Ask coach for analysis'}
    >
      <AvatarIcon size={18} className="text-white" />
    </button>

    {/* Explore mode: show move chips */}
    {isExplore ? (
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
            {repertoireMoves.length > 0 ? 'Book Moves' : 'Off Book'}
          </span>
          {repertoireMoves.length > 0 && (
            <button
              onClick={onPlayMainline}
              disabled={status === 'demo'}
              className="text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:text-emerald-300 disabled:opacity-30 flex items-center gap-1 transition-colors"
            >
              ▶ Mainline
            </button>
          )}
        </div>
        {repertoireMoves.length === 0 ? (
          <p className="text-slate-600 text-xs italic">No repertoire moves — off book.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {repertoireMoves.map((move) => {
              const rank = engineRankBySan.get(move.san);
              return (
                <button
                  key={move.san}
                  onClick={() => onPlayMove?.(move.san)}
                  disabled={status === 'demo'}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-black font-mono border transition-all active:scale-95 disabled:opacity-30',
                    rank
                      ? 'bg-indigo-600/20 border-indigo-500/40 text-white'
                      : 'bg-white/5 border-white/10 text-slate-400',
                  )}
                >
                  {move.san}
                  {rank && showLines && (
                    <span className="ml-1 text-[8px] text-indigo-400">#{rank}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        {/* Engine lines (tappable) when showLines */}
        {showLines && topLines.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {topLines.slice(0, 3).map((line, i) => {
              const scoreStr = line.mate !== null
                ? `M${Math.abs(line.mate)}`
                : line.cp !== null
                  ? `${line.cp > 0 ? '+' : ''}${(line.cp / 100).toFixed(1)}`
                  : '—';
              return (
                <button
                  key={i}
                  onClick={() => onDemoEngineLine?.(line.pv)}
                  disabled={status === 'demo'}
                  className="flex items-center gap-2 text-left px-2 py-1 rounded-lg bg-amber-500/5 border border-amber-500/10 hover:bg-amber-500/10 transition-all active:scale-95 disabled:opacity-30"
                >
                  <span className="text-[10px] font-mono text-amber-400 w-8 shrink-0 text-right">{scoreStr}</span>
                  <span className="text-[10px] font-mono text-slate-500 truncate">{line.pv.split(' ').slice(0, 5).join(' ')}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    ) : (
      /* Standard (non-explore) text area */
      <div className="flex-1 min-w-0">
        {widgetMode === 'analysis' && isAnalyzing ? (
          <div className="flex items-center gap-2 text-violet-400">
            <Activity size={12} className="animate-spin shrink-0" />
            <span className="text-[11px] font-black uppercase tracking-widest">Wizard is thinking...</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                {MODE_LABELS[mode] ?? mode}
              </span>
              {learnBadge && (
                <span className="text-[9px] font-black uppercase tracking-wider text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-px rounded-full">
                  {learnBadge} · {learnPhaseLabel}
                </span>
              )}
              {widgetMode === 'analysis' && !isAnalyzing && currentInsight && (
                <span className="text-[9px] font-black uppercase tracking-wider text-violet-400">AI</span>
              )}
            </div>
            <p className="text-sm font-semibold text-white leading-snug">
              {displayText}
            </p>
            {widgetMode === 'status' && hint && (
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-0.5">
                Correction: {hint}
              </p>
            )}
          </>
        )}
      </div>
    )}

    {/* Show Solution + Give Up — only in non-explore status mode */}
    {!isExplore && showActions && widgetMode === 'status' && (
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        <button
          onClick={onShowSolution}
          className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all active:scale-95"
          aria-label="Show Solution"
        >
          <LifeBuoy size={14} />
        </button>
        <button
          onClick={onGiveUp}
          className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all active:scale-95"
          aria-label="Give Up"
        >
          <Flag size={14} />
        </button>
      </div>
    )}
  </div>
);
```

**Step 6: Build**
```bash
cd "/Users/kevin/Chess Trainer" && npm run build
```
Expected: clean build.

**Step 7: Commit Tasks 5 and 6 together**
```bash
cd "/Users/kevin/Chess Trainer"
git add src/App.tsx src/components/TrainTab.tsx src/components/TrainingCoachWidget.tsx
git commit -m "feat: wire ExplorePanel and explore mode into TrainTab and TrainingCoachWidget"
```

---

### Task 7: Hide UniversalBoard engine lines panel in explore mode

**Files:**
- Modify: `src/components/UniversalBoard.tsx` (around line 349)

**Step 1: Read `mode` from trainingStore in UniversalBoard**

`mode` is already read at line 58:
```tsx
const mode = useTrainingStore(s => s.mode);
```
No change needed here.

**Step 2: Hide the engine lines panel in explore mode**

Find the engine lines panel block (around line 349):
```tsx
{showLines && topLines.length > 0 && (
```
Change it to:
```tsx
{showLines && topLines.length > 0 && mode !== 'explore' && (
```

This prevents the duplicate engine lines display below the board when in explore mode (they're already shown in ExplorePanel / TrainingCoachWidget).

**Step 3: Build**
```bash
cd "/Users/kevin/Chess Trainer" && npm run build
```
Expected: clean build.

**Step 4: Deploy**
```bash
cd "/Users/kevin/Chess Trainer" && npm run build
# Backend serves dist/ — just hard refresh in browser
```

**Step 5: Commit**
```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/UniversalBoard.tsx
git commit -m "feat: hide engine lines panel below board in explore mode (shown in sidebar instead)"
```

---

## Manual Verification Checklist

After all tasks complete, verify in browser:

1. **Mode strip (mobile) and ModeSelector (desktop)** show "Explore" as a new option with Compass icon
2. **Explore mode board**: drag any piece anywhere legal — no wrong/correct feedback, move plays instantly
3. **Back button**: goes back 1 move (not 2)
4. **Repertoire chips**: appear in sidebar (desktop) and widget (mobile) at starting position
5. **Chip click**: plays the move on the board
6. **Off-book**: after playing an off-book move, chips area says "Off Book — no repertoire moves"
7. **Mainline autoplay**: click "▶ Mainline" — moves play out with indigo arrows, board returns to start
8. **Engine lines (engine ON)**: turn on engine → engine lines appear in sidebar; each line is a clickable button
9. **Engine line click**: clicking a line plays it out with amber arrows and returns to start
10. **Engine badge**: if a repertoire chip matches engine's #1/#2/#3 move, badge appears
11. **No duplicate engine lines**: engine lines don't appear below board in explore mode
12. **Wand/AI analysis**: still works in explore mode (avatar tap triggers Gemini analysis)
