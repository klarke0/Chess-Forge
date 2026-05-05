# Design: Deviation Finder + SM-2 Review Fix

**Date:** 2026-02-24

## Overview

Two related improvements that make the existing Games and Review tabs actually useful:

1. **Deviation Finder** — wire up the already-built `computeDeviations()` utility so that loading a game in the Analysis Studio shows which of your moves deviated from the repertoire, and lets you drill those positions directly in training.
2. **SM-2 Review Fix** — fix the hardcoded board orientation and the uninformative error state when the backend is unavailable.

---

## Feature 1: Deviation Finder

### What Already Exists

- `src/utils/deviations.ts` — `computeDeviations(parsedGame, positions, playerColor)` is correct and complete
- `Deviation` type in `GameAnalysis.tsx`
- `AnalyzedGame.deviations` array (always `[]` currently)
- `isRepertoireMove` computed value in `GameAnalysis` (checks deviations, works once populated)
- `onDrillDeviation` prop on `GameAnalysis` (currently a no-op `() => {}`)

### What Changes

**`GamesTab.tsx`**
- Add `onDrillDeviation: (fen: string) => void` prop
- In `handleGameSelect`, after parsing the PGN, call:
  ```ts
  const positions = useRepertoireStore.getState().positions;
  const deviations = computeDeviations(parsed, positions, game.user_color || 'white');
  ```
  Pass `deviations` into `AnalyzedGame` instead of `[]`
- Wire the `onDrillDeviation` prop through to `GameAnalysis`

**`GameAnalysis.tsx` notation table**
- Build a `Set<string>` of deviation FENs from `game.deviations` for O(1) lookup
- For each move cell, if `move.fenBefore` is in that set, render an amber `⇒` badge in the same badge slot as `??`/`?`
- No new click handler needed — clicking the move still navigates to that position

**`App.tsx`**
- Expose `jumpToPosition` from `useTraining`
- Pass to `GamesTab`:
  ```tsx
  <GamesTab
    onDrillDeviation={(fen) => {
      jumpToPosition(fen);
      setActiveTab('train');
    }}
  />
  ```

### No Backend Changes

Deviations are computed client-side on game load. The `deviations` DB table is reserved for future server-side batch processing.

---

## Feature 2: SM-2 Review Fix

### Board Orientation

`ReviewTab` hardcodes `boardOrientation="white"`. Fix: read `repertoireSide` from `useRepertoireStore` and pass it to `boardOrientation`.

Same fix applies to `GameAnalysis.tsx` (also hardcodes `"white"` in two places: the board and `VisionOverlay`).

### Error State

Current behavior: if the backend is down, `useSpacedRepetition` sets `isError = true` and shows "Failed to load review queue" with no context.

Fix: catch the API failure gracefully. Show a message explaining the backend must be running, with a "Retry" button. This is already the UI — just improve the error message text to include actionable guidance.

### "Not Working" Investigation

The most likely cause: backend not running → API failure → error state. Secondary cause: progress table empty → "All Clear" with no useful positions.

During implementation, verify by checking:
1. Does `getDuePositions` return data when backend is running with recorded attempts?
2. Is there a structural bug in `onReviewDrop` preventing moves from registering?

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/GamesTab.tsx` | Add `onDrillDeviation` prop, call `computeDeviations`, import `useRepertoireStore` |
| `src/components/GameAnalysis.tsx` | Render amber deviation badges in notation, use adaptive board orientation |
| `src/components/ReviewTab.tsx` | Use `repertoireSide` for board orientation, improve error message |
| `src/App.tsx` | Expose `jumpToPosition`, pass `onDrillDeviation` to `GamesTab` |

No new files. No backend changes.
