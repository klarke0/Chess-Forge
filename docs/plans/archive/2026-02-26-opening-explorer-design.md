# Opening Explorer Mode — Design

**Date:** 2026-02-26

## Goal

Add an "Explore" mode to the training tab: a free-form opening explorer where the user controls both sides, sees their repertoire branches as clickable move chips, compares book moves against engine evaluations, and can auto-play the mainline from any position.

## Architecture

Add `'explore'` to the `TrainingMode` union. The mode reuses the existing training infrastructure (game ref, move history, step backward, demo mechanism) with minimal changes to board behavior.

### Board Behavior

- `onDrop`: allows any legal move — no repertoire checking, no status transitions (correct/wrong/novelty), no computer response
- Back (`stepBackward`): goes back 1 move (same as study mode — already handled)
- Reset: returns to chapter start (existing `restartChapter`)
- No `awaitingNext` gate — moves play instantly
- All existing toolbar controls apply: nav arrows, flip, vision heatmap, eval bar, engine lines toggle, wand (AI analysis)

### Engine vs. Repertoire Comparison

No extra engine calls. Algorithm:
1. Take the first move of each of the top 3 engine PVs (`topLines[0..2].pv.split(' ')[0]`)
2. Convert each from UCI to SAN using a temp `Chess` instance at the current FEN
3. Match those SANs against the repertoire chips at the current position
4. Badge matching chips: "Engine #1", "Engine #2", "Engine #3" (indigo/emerald/slate badges)
5. Non-matching chips render with a subtle grey tint to signal divergence from engine preference

### Mainline Autoplay

Button: "Play mainline ▶"

Algorithm in `useTraining`:
```
function playMainline():
  line = []
  fen = current FEN
  while repertoire moves exist at fen:
    take first move (index 0)
    apply to temp Chess instance
    push SAN to line
    fen = new fen
  demo the line using existing demo mechanism (800ms/move, indigo arrows, returns to start)
```

### New Functions in `useTraining`

- `playRepertoireMove(san: string)` — plays a SAN move freely (used when tapping a chip)
- `playMainline()` — builds and demos the mainline from current position

### New Component: `ExplorePanel`

Desktop sidebar panel (replaces `TacticalMonitor` + `CoachPanel` when mode === 'explore').

Sections:
1. **Repertoire Lines** — move chips with engine rank badges and annotation excerpts. Off-book message when empty.
2. **Engine Lines** (only when `showLines` is true) — top 3 engine lines shown as clickable rows (score + formatted moves). Clicking demos that line.
3. **Mainline** button — shown when repertoire moves exist.

Props: `fen: string`, `onPlayMove(san: string)`, `onPlayMainline()`, `onDemoEngineLine(pv: string)`

### Mobile Layout

`TrainingCoachWidget` in explore mode shows two sections:
1. **Book Moves** — same chips as desktop, tappable
2. **Engine Lines** — shown when `showLines` is true, tappable to demo

The UniversalBoard engine lines panel is hidden in explore mode (lines shown in widget/sidebar instead to avoid duplication).

## Files Changed

| File | Change |
|------|--------|
| `src/stores/trainingStore.ts` | Add `'explore'` to `TrainingMode` |
| `src/hooks/useTraining.ts` | Add `playRepertoireMove`, `playMainline`, `demoEngineLine`; update `onDrop` |
| `src/components/ExplorePanel.tsx` | **New** — desktop sidebar panel |
| `src/components/ModeSelector.tsx` | Add Explorer entry |
| `src/components/TrainTab.tsx` | Add explore to mobile strip; wire `ExplorePanel` in desktop sidebar; pass new functions |
| `src/components/TrainingCoachWidget.tsx` | Handle explore mode UI (chips + engine lines) |
| `src/components/UniversalBoard.tsx` | Hide engine lines panel in explore mode |
| `src/App.tsx` | Export `playRepertoireMove`, `playMainline`, `demoEngineLine` from `useTraining`; pass to `TrainTab` |

## Non-Goals

- No progress tracking or spaced repetition in explore mode
- No branch depth indicators (deferred)
- No transposition detection (deferred)
- No off-book snap-back prompt (deferred)
