# Mobile Training Tab Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Redesign the training tab mobile layout so the board is always full-width square, controls are in a compact toolbar row, and TacticalMonitor + CoachPanel are merged into a single tappable coach widget.

**Architecture:** Mobile gets a completely separate DOM structure (`lg:hidden` / `hidden lg:*`) inside `TrainTab.tsx` — the desktop sidebar layout is completely untouched. A new `TrainingCoachWidget` component merges status feedback and AI analysis into one always-visible panel. `UniversalBoard` gains two opt-in props to suppress its internal mobile controls when the caller provides them.

**Tech Stack:** React, TypeScript, Tailwind CSS, Zustand stores (`trainingStore`, `coachStore`, `engineStore`, `settingsStore`)

---

## Key Files

| File | Role |
|------|------|
| `src/components/TrainTab.tsx` | Main layout — add mobile sections |
| `src/components/UniversalBoard.tsx` | Add `mobileSquare` + `mobileControls` props |
| `src/components/TrainingCoachWidget.tsx` | New: merged status + coach panel |
| `src/components/TacticalMonitor.tsx` | Unchanged — still used on desktop |
| `src/components/CoachPanel.tsx` | Unchanged — still used on desktop |
| `src/components/ModeSelector.tsx` | Unchanged — still used on desktop |

## Mobile Layout Target

```
┌─────────────────────────────────┐
│ 🎓  📖  ▶  🎯  🧠              │  h-10  compact mode strip (lg:hidden)
├─────────────────────────────────┤
│                                 │
│     BOARD  (w-full aspect-      │  flex-1 min-h-0
│      square, fills the gap)     │
│                                 │
├─────────────────────────────────┤
│  ◀  ↺  ▶  │  👁  📊  ⚡  🪄   │  h-10  toolbar row (lg:hidden)
├─────────────────────────────────┤
│ 🤖  [status or coach text]  💡🏳│  ~72px coach widget (lg:hidden)
└─────────────────────────────────┘
         h-16  bottom nav (existing, fixed)
```

Desktop: completely unchanged — existing sidebar with ModeSelector, TacticalMonitor, MoveLedger, CoachPanel.

---

## Task 1: Create `TrainingCoachWidget.tsx`

**Files:**
- Create: `src/components/TrainingCoachWidget.tsx`

Merged mobile component. Shows tactical monitor status by default. Tap avatar → triggers AI analysis and switches to analysis mode. Auto-reverts to status mode when a new game event fires.

**Step 1: Create the file**

```tsx
import React, { useState, useEffect } from 'react';
import { Bot, CheckCircle2, Zap, AlertCircle, LifeBuoy, Flag, Activity } from 'lucide-react';
import { useTrainingStore } from '../stores/trainingStore';
import { useCoachStore } from '../stores/coachStore';
import { cn } from '../utils/cn';

interface TrainingCoachWidgetProps {
  onDeepAnalysis: () => void;
  onShowSolution: () => void;
  onGiveUp: () => void;
}

export const TrainingCoachWidget: React.FC<TrainingCoachWidgetProps> = ({
  onDeepAnalysis,
  onShowSolution,
  onGiveUp,
}) => {
  const { status, message, hint, awaitingNext } = useTrainingStore();
  const { currentInsight, isAnalyzing } = useCoachStore();
  const [widgetMode, setWidgetMode] = useState<'status' | 'analysis'>('status');

  // Auto-revert to status when a new game event fires (move played)
  useEffect(() => {
    if (status !== 'idle') setWidgetMode('status');
  }, [status, message]);

  const handleAvatarTap = () => {
    if (widgetMode === 'analysis') {
      setWidgetMode('status');
      return;
    }
    setWidgetMode('analysis');
    onDeepAnalysis();
  };

  const avatarBg =
    status === 'correct' ? 'bg-emerald-500 shadow-emerald-500/30' :
    status === 'wrong'   ? 'bg-rose-500 shadow-rose-500/30' :
    status === 'novelty' ? 'bg-indigo-500 shadow-indigo-500/30' :
    widgetMode === 'analysis' ? 'bg-violet-600 shadow-violet-600/30' :
    'bg-slate-700 shadow-black/20';

  const borderColor =
    status === 'correct' ? 'border-emerald-500/30 bg-emerald-500/5' :
    status === 'wrong'   ? 'border-rose-500/30 bg-rose-500/5' :
    status === 'novelty' ? 'border-indigo-500/30 bg-indigo-500/5' :
    'border-white/5 bg-white/[0.02]';

  const AvatarIcon =
    status === 'correct' ? CheckCircle2 :
    status === 'wrong'   ? AlertCircle :
    status === 'novelty' ? Zap : Bot;

  const showActions =
    status !== 'idle' && status !== 'complete' && status !== 'demo' && !awaitingNext;

  const displayText =
    widgetMode === 'analysis'
      ? (isAnalyzing ? null : (currentInsight || 'Tap the coach to analyze this position.'))
      : (message || 'Tap the coach for analysis.');

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 border-t transition-all duration-500 shrink-0',
      borderColor,
    )}>
      {/* Avatar — tappable to toggle analysis mode */}
      <button
        onClick={handleAvatarTap}
        className={cn(
          'w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg shrink-0',
          'transition-all duration-500 active:scale-95',
          avatarBg,
          isAnalyzing && widgetMode === 'analysis' && 'animate-pulse',
        )}
        aria-label={widgetMode === 'analysis' ? 'Dismiss analysis' : 'Ask coach for analysis'}
      >
        <AvatarIcon size={18} className="text-white" />
      </button>

      {/* Text area */}
      <div className="flex-1 min-w-0">
        {widgetMode === 'analysis' && isAnalyzing ? (
          <div className="flex items-center gap-2 text-violet-400">
            <Activity size={12} className="animate-spin shrink-0" />
            <span className="text-[11px] font-black uppercase tracking-widest">Wizard is thinking...</span>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold text-white leading-snug line-clamp-2">
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

      {/* Show Solution + Give Up — only in status mode when game is active */}
      {showActions && widgetMode === 'status' && (
        <div className="flex items-center gap-1.5 shrink-0">
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
};
```

**Step 2: Verify it compiles**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/components/TrainingCoachWidget.tsx
git commit -m "feat: add TrainingCoachWidget (merged status + coach for mobile)"
```

---

## Task 2: Add `mobileSquare` and `mobileControls` props to `UniversalBoard.tsx`

**Files:**
- Modify: `src/components/UniversalBoard.tsx`

Two new opt-in boolean props:
- `mobileSquare` — board container uses `w-full aspect-square` on mobile instead of `w-[min(95vw,60vh)]`
- `mobileControls` — when `true`, hides the toolbar and study-nav on mobile (caller provides them)

**Step 1: Add props to the interface** (around line 14)

```tsx
/** Mobile: size board as w-full aspect-square instead of min(95vw,60vh) */
mobileSquare?: boolean;
/** Mobile: hide internal toolbar and study nav (caller provides them) */
mobileControls?: boolean;
```

**Step 2: Destructure them** (around line 48)

```tsx
export const UniversalBoard: React.FC<UniversalBoardProps> = ({
  // ... existing props ...
  mobileSquare = false,
  mobileControls = false,
}) => {
```

**Step 3: Update board container sizing** (around line 160)

Replace:
```tsx
<div className="relative w-[min(95vw,60vh)] h-[min(95vw,60vh)] lg:w-[min(60vw,70vh)] lg:h-[min(60vw,70vh)] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] rounded-xl lg:rounded-2xl overflow-hidden border-[4px] lg:border-[10px] border-[#161b22] bg-[#161b22] shrink-0">
```

With:
```tsx
<div className={cn(
  "relative lg:w-[min(60vw,70vh)] lg:h-[min(60vw,70vh)] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] rounded-xl lg:rounded-2xl overflow-hidden border-[4px] lg:border-[10px] border-[#161b22] bg-[#161b22] shrink-0",
  mobileSquare ? "w-full aspect-square" : "w-[min(95vw,60vh)] h-[min(95vw,60vh)]",
)}>
```

**Step 4: Hide mobile toolbar when `mobileControls` is true** (around line 204)

Replace:
```tsx
<div className="lg:ml-4 flex flex-row lg:flex-col gap-1.5 lg:gap-1.5 shrink-0 justify-center flex-wrap">
```

With:
```tsx
<div className={cn(
  "lg:ml-4 flex flex-row lg:flex-col gap-1.5 shrink-0 justify-center flex-wrap",
  mobileControls && "hidden lg:flex",
)}>
```

**Step 5: Hide study nav on mobile when `mobileControls` is true** (around line 305)

Replace:
```tsx
{mode === 'study' && (
  <div className="flex items-center gap-4 mb-6 bg-[#0d1117] px-6 py-3 rounded-2xl border border-white/10 shadow-2xl animate-in slide-in-from-bottom-4 duration-500 shrink-0">
```

With:
```tsx
{mode === 'study' && !mobileControls && (
  <div className="flex items-center gap-4 mb-6 bg-[#0d1117] px-6 py-3 rounded-2xl border border-white/10 shadow-2xl animate-in slide-in-from-bottom-4 duration-500 shrink-0">
```

**Step 6: Hide engine lines panel on mobile when `mobileControls` is true** (around line 340)

Replace:
```tsx
{showLines && topLines.length > 0 && (
  <div className="mb-6 px-4 w-full max-w-2xl shrink-0">
```

With:
```tsx
{showLines && topLines.length > 0 && !mobileControls && (
  <div className="mb-6 px-4 w-full max-w-2xl shrink-0 hidden lg:block">
```

Wait — we actually want engine lines hidden on mobile in training mode. Use:
```tsx
{showLines && topLines.length > 0 && (
  <div className={cn("mb-6 px-4 w-full max-w-2xl shrink-0", mobileControls && "hidden lg:block")}>
```

**Step 7: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

**Step 8: Commit**

```bash
git add src/components/UniversalBoard.tsx
git commit -m "feat: add mobileSquare + mobileControls props to UniversalBoard"
```

---

## Task 3: Redesign `TrainTab.tsx` mobile layout

**Files:**
- Modify: `src/components/TrainTab.tsx`

Replace the current `h-[45vh]` sidebar stacking with a proper mobile layout. Desktop is unchanged.

The mobile toolbar reads directly from Zustand stores — no prop threading needed.

**Step 1: Update imports**

```tsx
import React, { useState } from 'react';
import { UniversalBoard } from './UniversalBoard';
import { TacticalMonitor } from './TacticalMonitor';
import { MoveLedger } from './MoveLedger';
import { CoachPanel } from './CoachPanel';
import { ModeSelector } from './ModeSelector';
import { TrainingCoachWidget } from './TrainingCoachWidget';
import { useTrainingStore, TrainingMode } from '../stores/trainingStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useEngineStore } from '../stores/engineStore';
import { useSettingsStore } from '../stores/settingsStore';
import { cn } from '../utils/cn';
import {
  ChevronLeft, ChevronRight, RotateCw,
  GraduationCap, BookOpen, Play, Target, Brain,
  Layers, BarChart2, Cpu, Wand2,
} from 'lucide-react';
```

**Step 2: Add store reads + local flip state inside the component**

Add after the existing `const ledger = ...` line:

```tsx
const mode = useTrainingStore(s => s.mode);
const setMode = useTrainingStore(s => s.setMode);
const status = useTrainingStore(s => s.status);
const awaitingNext = useTrainingStore(s => s.awaitingNext);
const repertoireSide = useRepertoireStore(s => s.repertoireSide);
const { training, toggleTrainingVision } = useSettingsStore();
const { showLines, toggleLines, showEvalBar, toggleEvalBar } = useEngineStore();

// Mobile board flip state (independent of desktop orientation in UniversalBoard)
const [mobileFlipped, setMobileFlipped] = useState(false);
const mobileOrientation = mobileFlipped
  ? (repertoireSide === 'white' ? 'black' : 'white')
  : repertoireSide;

const mobileModes: { id: TrainingMode; label: string; icon: any }[] = [
  { id: 'study', label: 'Study', icon: GraduationCap },
  { id: 'learn', label: 'Learn', icon: BookOpen },
  { id: 'full',  label: 'Full',  icon: Play },
  { id: 'weak',  label: 'Weak',  icon: Target },
  { id: 'quiz',  label: 'Quiz',  icon: Brain },
];
```

**Step 3: Replace the return block entirely**

```tsx
return (
  <div className="flex flex-col lg:flex-row h-full w-full overflow-hidden">

    {/* ── MOBILE ONLY: Compact Mode Strip ─────────────────────────────── */}
    <div className="lg:hidden flex shrink-0 border-b border-white/5 bg-[#0a0d14]">
      {mobileModes.map((m) => (
        <button
          key={m.id}
          disabled={status === 'demo'}
          onClick={() => { setMode(m.id); onStartTraining(); }}
          className={cn(
            'flex-1 flex flex-col items-center gap-0.5 py-2 transition-all',
            mode === m.id
              ? 'text-indigo-400 bg-indigo-500/10 border-b-2 border-indigo-500'
              : 'text-slate-600 hover:text-slate-400',
            status === 'demo' && 'opacity-40 cursor-not-allowed',
          )}
        >
          <m.icon size={14} />
          <span className="text-[8px] font-black uppercase tracking-wider">{m.label}</span>
        </button>
      ))}
    </div>

    {/* ── Board Area ───────────────────────────────────────────────────── */}
    <div className="flex-1 min-h-0 relative flex items-stretch justify-center bg-[#0d1117]/20 overflow-hidden">
      <UniversalBoard
        fen={fen}
        onDrop={onDrop}
        onProceed={onProceed}
        onBack={onBack}
        onReset={onReset}
        orientation={mobileOrientation}
        mobileSquare
        mobileControls
      />
    </div>

    {/* ── MOBILE ONLY: Toolbar Row ─────────────────────────────────────── */}
    <div className="lg:hidden flex items-center gap-1 px-3 py-2 bg-[#0a0d14] border-t border-white/5 shrink-0">
      {/* Navigation: back | reset | proceed */}
      <button
        onClick={onBack}
        disabled={status === 'idle'}
        className="p-2 rounded-xl bg-[#0d1117] border border-white/10 text-slate-400 hover:text-white disabled:opacity-20 transition-all active:scale-95"
        aria-label="Back"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        onClick={onReset}
        className="p-2 rounded-xl bg-rose-600/10 border border-rose-500/20 text-rose-400 hover:bg-rose-600/20 transition-all active:scale-95"
        aria-label="Reset"
      >
        <RotateCw size={14} />
      </button>
      <button
        onClick={onProceed}
        disabled={status === 'idle' && !awaitingNext}
        className={cn(
          'p-2 rounded-xl border transition-all active:scale-95',
          awaitingNext
            ? 'bg-indigo-600 border-indigo-500/50 text-white shadow-lg shadow-indigo-600/30'
            : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white disabled:opacity-20',
        )}
        aria-label="Proceed"
      >
        <ChevronRight size={16} />
      </button>

      <div className="h-6 w-px bg-white/10 mx-1 shrink-0" />

      {/* Board flip */}
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

      {/* Vision heatmap */}
      <button
        onClick={toggleTrainingVision}
        className={cn(
          'p-2 rounded-xl border transition-all active:scale-95',
          training.showVision
            ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30'
            : 'bg-[#0d1117] border-white/10 text-slate-400 hover:text-white',
        )}
        aria-label="Vision Heatmap"
      >
        <Layers size={14} />
      </button>

      {/* Eval bar */}
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

      {/* Engine lines */}
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

      {/* Coach (Wand) — placeholder; TrainingCoachWidget is always visible below */}
      <button
        className="p-2 rounded-xl bg-[#0d1117] border border-white/10 text-slate-400 hover:text-violet-400 transition-all active:scale-95 ml-auto"
        aria-label="Coach"
        onClick={onDeepAnalysis}
      >
        <Wand2 size={14} />
      </button>
    </div>

    {/* ── MOBILE ONLY: Merged Coach Widget ─────────────────────────────── */}
    <div className="lg:hidden shrink-0">
      <TrainingCoachWidget
        onDeepAnalysis={onDeepAnalysis}
        onShowSolution={onShowSolution}
        onGiveUp={onGiveUp}
      />
    </div>

    {/* ── DESKTOP ONLY: Right Sidebar (completely unchanged) ───────────── */}
    <div className="hidden lg:flex w-full lg:w-[420px] bg-[#0a0d14] border-t border-b-0 lg:border-t-0 lg:border-l border-white/5 flex-col z-20 shrink-0 lg:h-full overflow-hidden">
      <div className="p-3 lg:p-6 border-b border-white/5 bg-white/[0.02]">
        <ModeSelector onSelect={() => onStartTraining()} />
      </div>
      <TacticalMonitor />
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
          <MoveLedger
            ledger={ledger}
            activeMoveIdx={moveHistory.length - 1}
            onMoveClick={onJumpToMove}
          />
        </div>
      </div>
      <CoachPanel
        onDeepAnalysis={onDeepAnalysis}
        onPlayDemo={onPlayDemo}
        onShowSolution={onShowSolution}
        onGiveUp={onGiveUp}
      />
    </div>

  </div>
);
```

**Step 4: Verify TypeScript**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors. If there are errors about `TrainingMode` not exported from trainingStore, check that the store exports it — if not, change the import to:
```tsx
import { useTrainingStore } from '../stores/trainingStore';
type TrainingMode = 'study' | 'learn' | 'full' | 'weak' | 'quiz';
```

**Step 5: Build and deploy**

```bash
cd "/Users/kevin/Chess Trainer" && npm run build 2>&1 | tail -10
```
Expected: `✓ built in X.XXs`

**Step 6: Commit**

```bash
git add src/components/TrainTab.tsx
git commit -m "feat: mobile training tab redesign — full board, compact toolbar, coach widget"
```

---

## Verification Checklist

After building, test on mobile (ngrok URL):

- [ ] Board fills full width and is always square
- [ ] Mode strip shows 5 icon buttons at top, active mode is indigo
- [ ] Toolbar row shows ◀ ↺ ▶ nav + vision/eval/engine/wand buttons
- [ ] Coach widget is always visible below toolbar
- [ ] Tapping the avatar in idle state triggers AI analysis + avatar pulses
- [ ] Playing a correct move → avatar turns emerald, shows "Correct!" message
- [ ] Playing a wrong move → avatar turns rose, shows error message + hint
- [ ] Show Solution (💡) and Give Up (🏳) buttons appear in coach widget during active training
- [ ] Tapping avatar when in analysis mode reverts to status mode
- [ ] Desktop layout is completely unchanged (sidebar visible on lg:)
- [ ] `npx tsc --noEmit` exits 0
