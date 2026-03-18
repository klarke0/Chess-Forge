# Mobile Game Review Redesign

**Date:** 2026-02-25
**Scope:** `GameAnalysis.tsx`, `GameLab.tsx` (mobile only — `lg:` desktop layout untouched)
**Status:** Approved

---

## Problem

On mobile, the game review screens use `overflow-y-auto` at the page level. When navigating moves, the notation list calls `scrollIntoView`, which yanks the viewport past the board down to the notation panel. The board disappears from view on every move advance.

---

## Solution: Sticky Board + Bottom Drawer

Convert the mobile layout from a scrollable column to a fixed `h-dvh` viewport. Nothing scrolls at the page level. The board stays on screen at all times.

---

## Layout Structure (mobile)

```
┌─────────────────────────────┐  h-14  sticky header
├─────────────────────────────┤
│                             │
│        BOARD                │  flex-1, fills remaining height
│                             │
├─────────────────────────────┤  h-10  ← ▶ → nav controls
├─────────────────────────────┤  h-8   eval strip (collapsed)
│  ▁▂▃▄▅▃▂▁▂▄▅▆▅▄▃▂▁▂▃▄▅▃  │        (tap → expands to h-24)
├─────────────────────────────┤  h-10  move ticker (horiz scroll)
│  12.Nc3 · 12...d5 · 13.Bf4  │
├─────────────────────────────┤
│  ╱╲ Coach ▼                 │  h-7   bottom drawer handle
└─────────────────────────────┘  h-16  app bottom nav (existing)
```

Desktop (`lg:`) layout is **completely unchanged**.

---

## Components

### MoveTickerStrip (new shared component)
- `overflow-x-auto` horizontal strip, ~40px tall
- Move chips: move number shown at start of each pair, e.g. `1. e4  e5  2. Nf3  Nc6`
- Active move: indigo pill highlight
- Auto-scroll: `scrollIntoView({ inline: 'center', block: 'nearest' })` — scrolls the strip horizontally, never the page
- Tapping a chip jumps to that move
- Used in both `GameAnalysis` and `GameLab`

### Eval Strip (modified in-place)
- **Collapsed (default):** 32px, same SVG curve as current
- **Expanded (tap toggle):** animates to 96px via `transition-all duration-300`
- Expanded state shows colored grade dots on the curve: 🔴 blunder, 🟠 mistake, 🟡 inaccuracy
- Chevron icon (⌄/⌃) in top-right signals tappability
- Click-to-seek behavior preserved

### BottomDrawer (new shared component)
- Fixed-position panel, anchored above app bottom nav (`bottom-16`)
- **Closed state:** 28px drag handle + "Coach · Engine" label
- **Open state:** slides up to ~50vh via `transform: translateY(...)` CSS transition; semi-transparent backdrop
- Contains existing Coach and Engine tab content (unchanged)
- Close by tapping handle or backdrop

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/components/MoveTickerStrip.tsx` | New component |
| `src/components/BottomDrawer.tsx` | New component |
| `src/components/GameAnalysis.tsx` | Mobile layout restructure: remove page `overflow-y-auto`, add ticker, drawer, expand eval strip |
| `src/components/GameLab.tsx` | Same mobile layout treatment |

---

## Key Constraints

- `lg:` classes on all existing elements must not change
- No new dependencies — use CSS transitions only (no animation libraries)
- Ticker auto-scroll must not trigger page-level scroll
- Eval strip grade dots require access to `reviewedMoves` array with grade info
