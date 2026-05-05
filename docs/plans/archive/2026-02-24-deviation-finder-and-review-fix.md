# Deviation Finder + SM-2 Review Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the already-built `computeDeviations()` utility into the Games tab so deviations from the repertoire are shown inline in the notation and drillable with one click, and fix the Review tab's hardcoded board orientation and uninformative error state.

**Architecture:** All deviation logic runs client-side on game load — no backend changes. `computeDeviations()` in `src/utils/deviations.ts` is already correct; it just needs to be called. The drill flow is: `GamesTab` → `App.tsx` callback → `jumpToPosition()` + tab switch. Review tab orientation reads from the Zustand `repertoireSide` field.

**Tech Stack:** React, TypeScript, Zustand, chess.js, Tailwind CSS, Bun backend (no changes needed)

---

### Task 1: Expose `jumpToPosition` in `App.tsx` and add `onDrillDeviation` prop to `GamesTab`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/GamesTab.tsx`

**Step 1: Destructure `jumpToPosition` from `useTraining` in `App.tsx`**

In `src/App.tsx`, update the destructuring on line ~17:

```tsx
const {
  getFen, onDrop, handleNext, startTraining,
  playDemo, handleDeepAnalysis, jumpToMove,
  showSolution, giveUp, resetGame, restartChapter,
  stepBackward, jumpToPosition,
} = useTraining();
```

**Step 2: Pass `onDrillDeviation` to `GamesTab`**

Replace the `<GamesTab />` render in `App.tsx` with:

```tsx
{activeTab === 'games' && (
  <GamesTab
    onDrillDeviation={(fen) => {
      jumpToPosition(fen);
      setActiveTab('train');
    }}
  />
)}
```

**Step 3: Add the prop to `GamesTab`**

At the top of `src/components/GamesTab.tsx`, add the prop interface and destructure it:

```tsx
interface GamesTabProps {
  onDrillDeviation: (fen: string) => void;
}

export const GamesTab: React.FC<GamesTabProps> = ({ onDrillDeviation }) => {
```

**Step 4: Verify TypeScript is clean**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```

Expected: 0 errors (the prop isn't wired to anything yet, so no usage errors).

**Step 5: Commit**

```bash
cd "/Users/kevin/Chess Trainer"
git add src/App.tsx src/components/GamesTab.tsx
git commit -m "feat: expose jumpToPosition and add onDrillDeviation prop to GamesTab"
```

---

### Task 2: Compute deviations on game load and wire drill callback

**Files:**
- Modify: `src/components/GamesTab.tsx`

**Step 1: Add imports at the top of `GamesTab.tsx`**

```tsx
import { computeDeviations } from '../utils/deviations';
```

`useRepertoireStore` is already imported.

**Step 2: Compute deviations inside `handleGameSelect`**

Find the `handleGameSelect` function. After `const parsed = parsedResults[0];`, add:

```ts
const positions = useRepertoireStore.getState().positions;
const deviations = computeDeviations(parsed, positions, game.user_color || 'white');
```

**Step 3: Pass deviations into `AnalyzedGame`**

Replace:
```ts
const analyzed: AnalyzedGame = {
  id: String(game.id),
  white: game.white_username || 'White',
  black: game.black_username || 'Black',
  result: game.result || '*',
  date: game.date ? new Date(game.date).toLocaleDateString() : 'Unknown Date',
  deviations: [],
  analysis_json: game.analysis_json
};
```

With:
```ts
const analyzed: AnalyzedGame = {
  id: String(game.id),
  white: game.white_username || 'White',
  black: game.black_username || 'Black',
  result: game.result || '*',
  date: game.date ? new Date(game.date).toLocaleDateString() : 'Unknown Date',
  deviations,
  analysis_json: game.analysis_json
};
```

**Step 4: Wire `onDrillDeviation` through to `GameAnalysis`**

Find the `<GameAnalysis>` render inside `GamesTab`. Replace:
```tsx
onDrillDeviation={() => {}}
```
With:
```tsx
onDrillDeviation={(deviation) => onDrillDeviation(deviation.fen)}
```

**Step 5: Verify TypeScript is clean**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```

Expected: 0 errors.

**Step 6: Manual smoke test**

- Start both servers: `npm run dev` and `cd server && bun run dev`
- Go to Games tab, open any imported game
- Open DevTools console — should see no errors
- The analysis view opens as before (no visible change yet, deviations UI comes next)

**Step 7: Commit**

```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/GamesTab.tsx
git commit -m "feat: compute deviations on game load and wire drill callback"
```

---

### Task 3: Render deviation badges inline in the `GameAnalysis` notation table

**Files:**
- Modify: `src/components/GameAnalysis.tsx`

**Step 1: Build a `Set` of deviation FENs for O(1) lookup**

Inside `GameAnalysis`, near the other `useMemo` blocks (around line 107), add:

```ts
const deviationFens = useMemo(
  () => new Set(game.deviations.map(d => d.fen)),
  [game.deviations],
);
```

**Step 2: Add amber badge to deviation moves in the notation table**

In the White move cell (the `<td>` block for `wMove`), inside the `<div className="flex items-center justify-between">`, after the existing grade badge block, add:

```tsx
{wMove && deviationFens.has(wMove.fenBefore) && (
  <span className="text-[9px] font-black px-1 rounded-sm text-amber-400 bg-amber-500/10">
    ⇒
  </span>
)}
```

Do the same for the Black move cell (`bMove`):

```tsx
{bMove && deviationFens.has(bMove.fenBefore) && (
  <span className="text-[9px] font-black px-1 rounded-sm text-amber-400 bg-amber-500/10">
    ⇒
  </span>
)}
```

**Step 3: Add a "Drill" button when the selected move is a deviation**

The `isRepertoireMove` value is already computed. Add a drill button in the sidebar — a good place is just above the tab content area, visible whenever a deviation move is selected. Find the tab buttons row in `GameAnalysis` and add below it:

```tsx
{!isRepertoireMove && game.deviations.length > 0 && (
  <div className="px-4 py-2 border-b border-white/5 bg-amber-500/5 flex items-center justify-between shrink-0">
    <div className="flex items-center gap-2">
      <span className="text-amber-400 text-[10px] font-black uppercase tracking-widest">
        ⇒ Repertoire Deviation
      </span>
    </div>
    <button
      onClick={() => {
        const deviation = game.deviations.find(
          d => d.fen === movesList[currentMoveIdx]?.fenBefore
        );
        if (deviation) onDrillDeviation(deviation);
      }}
      className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-500/30 transition-all flex items-center gap-1.5"
    >
      <Target size={10} /> Drill This
    </button>
  </div>
)}
```

(`Target` is already imported in `GameAnalysis`.)

**Step 4: Verify TypeScript is clean**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```

**Step 5: Manual smoke test**

- Open a game where you deviated from the Jobava London
- Navigate to a move where you deviated — amber `⇒` badge should appear in the notation cell
- The amber "Repertoire Deviation / Drill This" bar should appear in the sidebar
- Click "Drill This" — should switch to Train tab at that board position with message "Training from selected position."

**Step 6: Commit**

```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/GameAnalysis.tsx
git commit -m "feat: show deviation badges inline in notation and add drill button"
```

---

### Task 4: Fix `ReviewTab` board orientation and error state

**Files:**
- Modify: `src/components/ReviewTab.tsx`

**Step 1: Import `useRepertoireStore` and read `repertoireSide`**

At the top of `ReviewTab.tsx`, add:

```tsx
import { useRepertoireStore } from '../stores/repertoireStore';
```

Inside the `ReviewTab` component, before the `useSpacedRepetition()` call, add:

```tsx
const repertoireSide = useRepertoireStore(s => s.repertoireSide);
```

**Step 2: Use `repertoireSide` for board orientation**

Find the `<Chessboard>` in the active review section (around line 136) and replace:

```tsx
boardOrientation="white"
```

With:

```tsx
boardOrientation={repertoireSide}
```

**Step 3: Improve the error state message**

Find the error render block (around line 44). Replace the `<p>` text:

```tsx
<p className="text-slate-300 text-lg font-bold">Failed to load review queue</p>
```

With:

```tsx
<p className="text-slate-300 text-lg font-bold">Failed to load review queue</p>
<p className="text-slate-500 text-sm text-center max-w-xs">
  Make sure the backend is running:<br />
  <code className="text-indigo-400 text-xs">cd server && bun run dev</code>
</p>
```

**Step 4: Verify TypeScript is clean**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```

**Step 5: Manual smoke test**

- Start backend: `cd server && bun run dev`
- Navigate to Review tab
- If progress table has entries: board should appear at correct orientation
- Stop the backend, reload, navigate to Review — should show improved error message with server instructions

**Step 6: Commit**

```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/ReviewTab.tsx
git commit -m "fix: adaptive board orientation in ReviewTab, improve error message"
```

---

### Task 5: Fix `GameAnalysis` board orientation

**Files:**
- Modify: `src/components/GameAnalysis.tsx`

**Step 1: Import `useRepertoireStore` and read `repertoireSide`**

Add to the existing store reads near the top of the `GameAnalysis` component body:

```tsx
const repertoireSide = useRepertoireStore(s => s.repertoireSide);
```

Add the import if not already present:
```tsx
import { useRepertoireStore } from '../stores/repertoireStore';
```

**Step 2: Fix board orientation (two occurrences)**

Find `boardOrientation="white"` in the `<Chessboard>` render (around line 370) and replace with:

```tsx
boardOrientation={repertoireSide}
```

Find `orientation="white"` in the `<VisionOverlay>` render (around line 377) and replace with:

```tsx
orientation={repertoireSide}
```

**Step 3: Verify TypeScript is clean**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```

**Step 4: Manual smoke test**

- Open the Games tab and load a game
- Board should be oriented from White's perspective for Jobava London (no visible change unless you have a Black repertoire loaded)

**Step 5: Commit**

```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/GameAnalysis.tsx
git commit -m "fix: adaptive board orientation in GameAnalysis"
```

---

### Task 6: Investigate and fix Review tab "not working"

**Files:**
- Investigate: `src/hooks/useSpacedRepetition.ts`, `server/routes/progress.ts`

**Step 1: Diagnose with backend running**

With both servers running, open Review tab and observe which state renders:
- "Loading Review Queue" (spinner) → API call is in-flight or hanging
- "Failed to load review queue" → API error (check network tab)
- "All Clear!" → no due positions in DB (progress table empty or all reviewed)
- Board renders → working correctly

**Step 2: If "All Clear" with empty progress table**

This is expected: the SM-2 queue only contains positions you've already attempted in training. It's not pre-seeded. If you've never drilled, the queue is empty. No fix needed — the UX is correct. The "All Clear" message could say more:

In `ReviewTab.tsx`, find the empty-queue render block and update the secondary text:

```tsx
<p className="text-slate-400 mt-2 text-sm">No positions are due for review today.</p>
<p className="text-slate-500 mt-1 text-xs">Positions appear here after you drill them in Train mode.</p>
```

**Step 3: If board renders but moves don't register**

Add a temporary `console.error` inside `onReviewDrop` just before `return false` in the wrong-move branch to confirm the callback is firing. Check that `getCorrectMoves(reviewFen)` returns a non-empty array by inspecting in DevTools:

```ts
// In browser console:
window.__zustand = useRepertoireStore; // temporarily expose
```

Or simply log inside `onReviewDrop`:
```ts
console.error('correctMoves:', getCorrectMoves(reviewFen), 'reviewFen:', reviewFen);
```

Fix any FEN mismatch found.

**Step 4: Remove any temporary debug logging**

**Step 5: Verify TypeScript is clean**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit
```

**Step 6: Commit**

```bash
cd "/Users/kevin/Chess Trainer"
git add src/components/ReviewTab.tsx src/hooks/useSpacedRepetition.ts
git commit -m "fix: improve Review tab empty-state messaging"
```

---

## Summary of All Changed Files

| File | Tasks |
|------|-------|
| `src/App.tsx` | Task 1 |
| `src/components/GamesTab.tsx` | Tasks 1, 2 |
| `src/components/GameAnalysis.tsx` | Tasks 3, 5 |
| `src/components/ReviewTab.tsx` | Tasks 4, 6 |

**No backend changes. No new files.**
