# Mobile Game Review Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the mobile scroll-snap problem in game review by replacing the vertical notation panel with a horizontal move ticker, making the eval strip tap-expandable, and moving the Coach/Engine panel into a bottom drawer.

**Architecture:** Two new shared components (`MoveTickerStrip`, `BottomDrawer`) are used inside `GameAnalysis` and `GameLab`. On mobile, the outer container becomes a fixed `flex flex-col overflow-hidden` layout — nothing scrolls at the page level. Desktop (`lg:`) layout is completely untouched.

**Tech Stack:** React, TypeScript, Tailwind CSS, Lucide icons. No new dependencies.

---

## Task 1: Create MoveTickerStrip component

**Files:**
- Create: `src/components/MoveTickerStrip.tsx`

### Step 1: Create the file

```tsx
// src/components/MoveTickerStrip.tsx
import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../utils/cn';

const GRADE_TEXT: Record<string, string> = {
  blunder:    'text-rose-400',
  mistake:    'text-orange-400',
  inaccuracy: 'text-amber-300',
  excellent:  'text-emerald-400',
  good:       'text-slate-300',
  standard:   'text-slate-400',
};

const GRADE_LABEL: Record<string, string> = {
  blunder: '??', mistake: '?', inaccuracy: '?!', excellent: '!',
};

export interface TickerMove {
  idx: number;
  san: string;
  grade?: string;
  moveNumber: number;
  isWhite: boolean;
}

interface MoveTickerStripProps {
  moves: TickerMove[];
  currentIdx: number; // -1 = start position
  onSelect: (idx: number) => void;
  onPrev: () => void;
  onNext: () => void;
  accentColor?: string; // Tailwind active bg class, defaults to indigo
}

export const MoveTickerStrip: React.FC<MoveTickerStripProps> = ({
  moves,
  currentIdx,
  onSelect,
  onPrev,
  onNext,
  accentColor = 'bg-indigo-500/30 ring-indigo-500/50 text-white',
}) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Scroll active chip to center — uses manual scrollLeft to avoid page-level scroll
  useEffect(() => {
    if (activeRef.current && stripRef.current) {
      const strip = stripRef.current;
      const active = activeRef.current;
      const targetLeft =
        active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2;
      strip.scrollTo({ left: targetLeft, behavior: 'smooth' });
    }
  }, [currentIdx]);

  return (
    <div className="lg:hidden shrink-0 flex items-center h-10 bg-[#0a0d14] border-t border-white/5 px-1 gap-1">
      {/* Prev arrow */}
      <button
        onClick={onPrev}
        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-white active:bg-white/5 transition-colors"
        aria-label="Previous move"
      >
        <ChevronLeft size={16} />
      </button>

      {/* Scrollable strip */}
      <div
        ref={stripRef}
        className="flex-1 overflow-x-auto flex items-center gap-0.5 scrollbar-none"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {moves.length === 0 ? (
          <span className="text-[11px] text-slate-600 px-2 italic">No moves yet</span>
        ) : (
          moves.map((m) => {
            const isActive = currentIdx === m.idx;
            const gradeText = GRADE_TEXT[m.grade ?? ''] ?? 'text-slate-300';
            const gradeLabel = GRADE_LABEL[m.grade ?? ''] ?? '';
            return (
              <React.Fragment key={m.idx}>
                {m.isWhite && (
                  <span className="text-[10px] font-mono text-slate-600 shrink-0 px-0.5 select-none">
                    {m.moveNumber}.
                  </span>
                )}
                <button
                  ref={isActive ? activeRef : undefined}
                  onClick={() => onSelect(m.idx)}
                  className={cn(
                    'shrink-0 px-1.5 py-0.5 rounded text-[12px] font-medium transition-all whitespace-nowrap',
                    isActive
                      ? cn('ring-1 font-bold', accentColor)
                      : cn('hover:bg-white/5', gradeText),
                  )}
                >
                  {m.san}
                  {gradeLabel && (
                    <span className="text-[8px] font-black opacity-80 ml-0.5">{gradeLabel}</span>
                  )}
                </button>
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* Next arrow */}
      <button
        onClick={onNext}
        className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-white active:bg-white/5 transition-colors"
        aria-label="Next move"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
};
```

### Step 2: Verify TypeScript compiles

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors referencing `MoveTickerStrip.tsx`.

### Step 3: Commit

```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/MoveTickerStrip.tsx
git commit -m "feat: add MoveTickerStrip mobile component"
```

---

## Task 2: Create BottomDrawer component

**Files:**
- Create: `src/components/BottomDrawer.tsx`

### Step 1: Create the file

```tsx
// src/components/BottomDrawer.tsx
import React, { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn';

interface BottomDrawerProps {
  children: React.ReactNode;
  label: string;
  secondaryLabel?: string; // e.g. "Engine"
}

export const BottomDrawer: React.FC<BottomDrawerProps> = ({
  children,
  label,
  secondaryLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="lg:hidden shrink-0 flex flex-col-reverse overflow-hidden transition-[max-height] duration-300 ease-in-out"
         style={{ maxHeight: isOpen ? '55vh' : '1.75rem' }}>
      {/* Handle — always visible at bottom, rendered first in DOM for flex-col-reverse */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="shrink-0 h-7 w-full flex items-center justify-center gap-2 bg-[#0a0d14] border-t border-white/10 text-slate-500 hover:text-white transition-colors"
      >
        {isOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        <span className="text-[10px] font-black uppercase tracking-widest">
          {label}
          {secondaryLabel && (
            <span className="text-slate-600 mx-1.5">·</span>
          )}
          {secondaryLabel && secondaryLabel}
        </span>
      </button>

      {/* Content — slides up above the handle */}
      <div className="flex-1 overflow-y-auto bg-[#0a0d14] min-h-0">
        {children}
      </div>
    </div>
  );
};
```

### Step 2: Verify TypeScript compiles

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

### Step 3: Commit

```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/BottomDrawer.tsx
git commit -m "feat: add BottomDrawer mobile slide-up panel component"
```

---

## Task 3: Update GameAnalysis.tsx — mobile layout

**Files:**
- Modify: `src/components/GameAnalysis.tsx`

This task has several sub-steps. Work through them sequentially.

### Context: What changes on mobile vs desktop

**On mobile (default, no `lg:` prefix):**
- Outer container: remove `overflow-y-auto`, use `overflow-hidden` so page never scrolls
- Board area: no change to board itself
- Eval strip: add `evalExpanded` state — toggled by chevron button in top-right of strip
  - Collapsed: `h-8` (32px)
  - Expanded: `h-24` (96px), same curve but taller, grade dots appear on the SVG
- Sidebar (`w-full lg:w-[420px]`): add `hidden lg:flex` so it disappears on mobile
- Below board area (mobile only): add `<MoveTickerStrip>` and `<BottomDrawer>`

**On desktop (`lg:`):**
- Everything unchanged — all existing `lg:` classes remain

### Step 1: Add imports

At the top of `GameAnalysis.tsx`, add these two imports alongside existing component imports:

```tsx
import { MoveTickerStrip, TickerMove } from './MoveTickerStrip';
import { BottomDrawer } from './BottomDrawer';
```

Also add `ChevronDown, ChevronUp` to the lucide-react import line (they may already be there; check first).

### Step 2: Add evalExpanded state

In the component body, alongside the other `useState` declarations (around line 75):

```tsx
const [evalExpanded, setEvalExpanded] = useState(false);
```

### Step 3: Build tickerMoves derived value

After the existing `graphPoints` useMemo (around line 188), add:

```tsx
const tickerMoves = useMemo((): TickerMove[] => {
  return movesList.map((move, idx) => ({
    idx,
    san: move.san,
    grade: reviewedMoves[idx]?.grade,
    moveNumber: Math.floor(idx / 2) + 1,
    isWhite: idx % 2 === 0,
  }));
}, [movesList, reviewedMoves]);
```

### Step 4: Fix the outer container — remove mobile overflow-y-auto

Find this line (around line 375):
```tsx
<div className="flex-1 flex overflow-y-auto lg:overflow-hidden flex-col lg:flex-row pb-24 lg:pb-0">
```

Replace with:
```tsx
<div className="flex-1 flex overflow-hidden flex-col lg:flex-row">
```

(Removed `overflow-y-auto`, `pb-24 lg:pb-0`. Now nothing scrolls at page level on mobile.)

### Step 5: Update eval strip — expandable with grade dots

Find the eval chart section (around line 416-433):
```tsx
{/* Eval Chart */}
{reviewedMoves.length > 0 && (
  <div className="w-full max-w-2xl relative h-[36px] rounded-lg overflow-hidden border border-white/5 bg-black/40 shrink-0 cursor-pointer select-none group">
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="w-full h-full">
      ...4 children...
    </svg>
    <div className="absolute inset-0" onClick={...} />
  </div>
)}
```

Replace the entire block with:
```tsx
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
      {/* Grade dots — only in expanded state */}
      {evalExpanded && reviewedMoves.map((m, i) => {
        const dotColor =
          m.grade === 'blunder'    ? '#f43f5e' :
          m.grade === 'mistake'    ? '#fb923c' :
          m.grade === 'inaccuracy' ? '#fcd34d' :
          m.grade === 'excellent'  ? '#34d399' : null;
        if (!dotColor) return null;
        const cx = ((i + 0.5) / reviewedMoves.length) * 1000;
        const cy = 50 * (1 - Math.tanh((m as any).eval / 600));
        return (
          <circle key={i} cx={cx} cy={cy} r="14" fill={dotColor} fillOpacity="0.85" />
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
    {/* Seek overlay (whole strip except chevron) */}
    <div
      className="absolute inset-0"
      style={{ right: '28px' }}
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
      aria-label={evalExpanded ? 'Collapse eval' : 'Expand eval'}
    >
      {evalExpanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
    </button>
  </div>
)}
```

### Step 6: Hide the sidebar on mobile

Find (around line 438):
```tsx
<div className="w-full lg:w-[420px] bg-[#0a0d14] lg:border-l border-white/5 flex flex-col shrink-0">
```

Replace `flex` with `hidden lg:flex`:
```tsx
<div className="w-full lg:w-[420px] bg-[#0a0d14] lg:border-l border-white/5 hidden lg:flex flex-col shrink-0">
```

### Step 7: Add MoveTickerStrip and BottomDrawer after the main flex row

The main flex row is:
```tsx
<div className="flex-1 flex overflow-hidden flex-col lg:flex-row">
  {/* LEFT: Board Area */}
  ...
  {/* RIGHT: Sidebar */}
  ...
</div>
```

After the closing `</div>` of this flex row (and still inside the outer `absolute inset-0` container, after the header), add:

```tsx
{/* Mobile-only: move ticker */}
<MoveTickerStrip
  moves={tickerMoves}
  currentIdx={currentMoveIdx}
  onSelect={setCurrentMoveIdx}
  onPrev={() => handleNav(-1)}
  onNext={() => handleNav(1)}
/>

{/* Mobile-only: Coach + Engine + Deviations drawer */}
<BottomDrawer label="Coach" secondaryLabel="Engine">
  {/* Coach / Engine tab bar */}
  <div className="flex border-b border-white/5 bg-white/[0.02]">
    <button
      onClick={() => setActiveTab('coach')}
      className={cn(
        'flex-1 py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
        activeTab === 'coach'
          ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5'
          : 'text-slate-500 hover:text-slate-300',
      )}
    >
      <Brain size={12} /> Coach
    </button>
    <button
      onClick={() => setActiveTab('engine')}
      className={cn(
        'flex-1 py-3 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
        activeTab === 'engine'
          ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5'
          : 'text-slate-500 hover:text-slate-300',
      )}
    >
      <Zap size={12} /> Engine
    </button>
  </div>
  {/* Reuse existing Coach/Engine tab content — copy the same JSX that's in the desktop sidebar BOTTOM PANEL */}
  <div className="overflow-y-auto p-5">
    {activeTab === 'coach' ? (
      /* PASTE: exact copy of the coach tab content from the desktop sidebar (lines ~532–570) */
      <CoachTabContent
        isCoachAnalyzing={isCoachAnalyzing}
        isThinking={isThinking}
        currentInsight={currentInsight}
        demoLine={demoLine}
        isPlayingLine={isPlayingLine}
        onAnalyze={handleAnalysisRequest}
        onMouseEnterLine={handleMouseEnterLine}
        onMouseLeaveLine={handleMouseLeaveLine}
        onJumpToLineEnd={jumpToLineEnd}
        onPlayLine={playLine}
      />
    ) : (
      /* PASTE: exact copy of the engine tab content from the desktop sidebar (lines ~572–end) */
      <EngineTabContent ... />
    )}
  </div>
  {/* Deviations panel (if any) */}
  {game.deviations.length > 0 && (
    /* PASTE: existing deviations panel JSX from the desktop sidebar TOP PANEL */
    ...
  )}
</BottomDrawer>
```

> **Implementation note:** Rather than extracting sub-components like `CoachTabContent`, simply copy-paste the JSX from the existing desktop sidebar BOTTOM PANEL (lines ~521–end of sidebar). Both mobile (drawer) and desktop (sidebar) will have the same rendered content — they just use different containers. This is intentional duplication to avoid over-engineering.

### Step 8: Verify TypeScript compiles

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -40
```
Expected: 0 errors.

### Step 9: Commit

```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/GameAnalysis.tsx
git commit -m "feat: mobile game review — ticker strip, expandable eval, bottom drawer"
```

---

## Task 4: Update GameLab.tsx — mobile layout

**Files:**
- Modify: `src/components/GameLab.tsx`

GameLab is simpler — no coach panel. The right sidebar is only a move list.

### Step 1: Add import

```tsx
import { MoveTickerStrip, TickerMove } from './MoveTickerStrip';
```

### Step 2: Add evalExpanded state

```tsx
const [evalExpanded, setEvalExpanded] = useState(false);
```

### Step 3: Build tickerMoves

After the existing `graphPoints` useMemo (~line 134), add:

```tsx
const tickerMoves = useMemo((): TickerMove[] =>
  reviewedMoves.map((m, idx) => ({
    idx,
    san: m.san,
    grade: m.grade,
    moveNumber: Math.floor(idx / 2) + 1,
    isWhite: idx % 2 === 0,
  })),
[reviewedMoves]);
```

### Step 4: Hide right panel on mobile

Find (around line 352):
```tsx
<div className="w-full lg:w-[340px] bg-[#0a0d14] border-l border-white/5 flex flex-col shrink-0 overflow-hidden">
```

Change `flex` to `hidden lg:flex`:
```tsx
<div className="w-full lg:w-[340px] bg-[#0a0d14] border-l border-white/5 hidden lg:flex flex-col shrink-0 overflow-hidden">
```

### Step 5: Make eval graph expandable

Find the eval graph div (around line 270):
```tsx
<div className="w-full max-w-[min(55vh,420px)] h-12 rounded-xl border border-white/5 overflow-hidden relative shrink-0 bg-[#0a0d14]">
```

Replace the entire eval graph section with the same expandable pattern as GameAnalysis, using `evalExpanded` state and the `gl-upper`/`gl-lower` clip IDs. The chevron button toggles `evalExpanded`.

Height classes: `h-12 lg:h-12` when collapsed, `h-24 lg:h-12` when expanded. (On desktop it stays `h-12` always.)

Add grade dots in expanded state using `reviewedMoves` with the same logic as Task 3 Step 5.

### Step 6: Add MoveTickerStrip below the navigator

The current layout in the `results` view has:
```tsx
<div className="flex-[1.5] flex flex-col items-center p-4 lg:p-6 gap-4 ...">
  <board />
  <eval-graph />
  <navigator />
</div>
```

After the `</div>` that closes the left panel (`flex-[1.5]`), before the right panel, add:

```tsx
<MoveTickerStrip
  moves={tickerMoves}
  currentIdx={currentMoveIndex}
  onSelect={setCurrentMoveIndex}
  onPrev={() => setCurrentMoveIndex(i => Math.max(-1, i - 1))}
  onNext={() => setCurrentMoveIndex(i => Math.min(reviewedMoves.length - 1, i + 1))}
  accentColor="bg-cyan-500/20 ring-cyan-500/40 text-cyan-100"
/>
```

(GameLab uses cyan accent to match its existing cursor color.)

### Step 7: Verify TypeScript compiles

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -40
```

### Step 8: Commit

```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/GameLab.tsx
git commit -m "feat: mobile game lab — ticker strip + expandable eval"
```

---

## Task 5: Visual QA checklist

Check the following in the browser (mobile viewport, ~390px wide):

**GameAnalysis:**
- [ ] Board stays on screen when pressing Next/Prev — no page scroll
- [ ] Move ticker scrolls horizontally to center the active chip
- [ ] Tapping a chip in the ticker jumps to that move
- [ ] Eval strip is 32px tall by default, expands to 96px on tap of chevron
- [ ] Grade dots (🔴🟠🟡🟢) appear on eval strip when expanded
- [ ] Clicking the eval strip (not chevron) seeks to that move
- [ ] Bottom drawer handle is visible at all times
- [ ] Tapping "Coach · Engine" handle slides up the drawer
- [ ] Coach and Engine tabs work inside the drawer
- [ ] Desktop (`lg:`) layout is completely unchanged

**GameLab:**
- [ ] Board stays visible during navigation
- [ ] Ticker appears below the eval graph
- [ ] Cyan accent color used for active move chip
- [ ] Eval graph expandable with chevron

---

## Notes

- The `movesScrollRef` and `scrollIntoView` call in `GameAnalysis.tsx` (around line 306–311) can be left in place — it only affects the desktop sidebar scroll (which still exists at `lg:`). It won't cause page scroll because the sidebar has its own `overflow-y-auto` on mobile it's `hidden`.
- If `ChevronUp`/`ChevronDown` are not yet imported in `GameAnalysis.tsx`, add them to the lucide-react import line.
- The `Brain`, `Zap` imports are already present in `GameAnalysis.tsx` — no new lucide imports needed for the drawer content.
