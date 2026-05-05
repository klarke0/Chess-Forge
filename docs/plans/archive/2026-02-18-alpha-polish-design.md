# Chess Trainer Alpha Polish — Design Document
**Date:** 2026-02-18
**Scope:** Bring the app to a functional Alpha with all 5 modes working

---

## Problem Statement

The core training loop (repertoire drilling, SM-2 review, Stockfish engine, AI coach) is solid. The surrounding modes are either broken, inconsistently navigated, or non-functional scaffolding. The goal is to make every mode in the sidebar actually work, clean up navigation, and remove dead code.

---

## Current State Summary

| Mode | Status | Issue |
|------|--------|-------|
| Train | ✅ Solid | Minor: dead `gameStore`, weak-spot button broken |
| Review | ✅ Solid | Recently implemented SM-2 |
| Library | 🟡 Broken UX | Opens `ChapterLibrary` as an overlay instead of navigating |
| Analysis | 🔴 Broken | Games list hardcoded to `[]`; ImportModal does double duty |
| Game Lab | 🔴 Skeleton | No pipeline; backend endpoints don't exist |

---

## Design

### 1. Navigation — Unified Full-Screen Pattern

**Problem:** Some modes use the sidebar as routing (Train, Review), others open modal overlays (Library), others are full-screen (Analysis). Inconsistent and confusing.

**Fix:** All 5 modes become full-screen views in `App.tsx`. No mode opens an overlay to represent itself. Overlays are only for transient actions (import dialog, chapter picker initiated from within a mode).

- `training` → existing board + tools layout (unchanged)
- `review` → existing ReviewTab (unchanged)
- `library` → new `LibraryView` full-screen component (replaces ChapterLibrary overlay)
- `analysis` → existing GameHub/GameAnalysis (fixed)
- `lab` → GameLab with real pipeline (rebuilt)

The `repertoire` mode name is renamed to `library` in the union for clarity.

---

### 2. Library Mode — Full-Screen View

**Problem:** Clicking "Library" opens `ChapterLibrary` as an overlay positioned over the training board, then closes back to training. It's not a mode, it's a modal.

**Fix:** Build `LibraryView` as a proper full-screen component that contains:
- Chapter list (cards with mastery % and start button)
- Weak positions list (FENs with mistake counts, jump-to-drill button)
- Repertoire tree toggle

When a chapter is selected from Library, navigate to Training with that chapter loaded.

---

### 3. Analysis Mode — Fix Games Persistence

**Problem:** After a Chess.com sync or PGN import, the parsed game is used once (opened in viewer) then lost. GameHub always receives `games: []` so there's nothing to browse. ImportModal is reused for both PGN upload and Chess.com username entry.

**Fix:**
- Add `games: AnalyzedGame[]` to App state. After any import/sync, push the game to this list.
- GameHub receives the real `games` list and renders clickable game cards.
- Split the import flow: GameHub has two explicit buttons — "Import PGN" (file/paste) and "Sync from Chess.com" (username entry). Each opens its own small modal, not the shared ImportModal.
- Fix `onSelectGame` to set `selectedAnalyzedGame` and switch to viewer.
- Fix "Drill Deviation": when clicked from GameAnalysis, navigate to Training with `jumpToPosition(deviationFen)`. Requires actually computing deviations — compare each game move against `positions[fen]` in the repertoire and collect positions where the player deviated.

---

### 4. Game Lab — Client-Side Move Review Pipeline

**Problem:** Component is a skeleton. API endpoints it calls don't exist. No analysis pipeline.

**Design:** Implement entirely client-side using the existing Stockfish Web Worker.

**User flow:**
1. Land on Game Lab → prompt to upload a PGN or enter a Chess.com game URL
2. Parse PGN → extract moves → build FEN sequence
3. For each position, send to Stockfish at depth 16 → collect best move + centipawn score
4. Compare player move eval vs best move eval → compute centipawn loss
5. Classify each move:
   - `brilliant` — move is only engine choice AND sacrifices material (≤ -100 cp material swing)
   - `excellent` — cp loss 0–10
   - `good` — cp loss 10–25
   - `inaccuracy` — cp loss 25–100
   - `mistake` — cp loss 100–300
   - `blunder` — cp loss > 300
6. Display: eval graph (line chart of eval per move), move list with colored symbols, board navigator (click move → board updates to that position)

**Performance:** Analysis runs sequentially (one position at a time), showing a progress bar. Each position takes ~500ms at depth 16 with the existing Web Worker. A 40-move game ≈ 40 seconds. Show "Analyzing... (move X/Y)" to set expectations.

**No AI commentary in Alpha** — move classification + eval graph is the deliverable. Gemini integration for per-move text is a v1 feature.

---

### 5. Training Polish

**Fixes:**
- Remove `gameStore` — it's dead code (training uses a local ref; the store is never read)
- Fix "Fix Weak Spots" button in `ProgressDashboard` — currently calls `onClose()` only; should navigate to Training with `mode = 'weak'`
- AI Coach error state — if Gemini fails or API key is missing, show "Coach unavailable" with a subtle retry button instead of silent failure or generic text

---

## What Is NOT Changing

- Training loop logic (onDrop, computerMove, mistake count, novelty detection)
- SM-2 algorithm and Review tab
- Stockfish engine integration
- Gemini AI coach integration (just adding proper error state)
- Server/API routes
- Database schema

---

## File Impact Summary

| File | Change |
|------|--------|
| `src/App.tsx` | Add `games` state, fix mode union, fix Analysis flow |
| `src/components/Layout.tsx` | Rename `repertoire` → `library` in union |
| `src/components/LibraryView.tsx` | NEW — full-screen library/chapters view |
| `src/components/AnalysisImportModal.tsx` | NEW — dedicated PGN import dialog |
| `src/components/ChessComModal.tsx` | NEW — dedicated Chess.com sync dialog |
| `src/components/GameHub.tsx` | Fix games list, add import/sync buttons |
| `src/components/GameAnalysis.tsx` | Fix deviation computation + drill button |
| `src/components/GameLab.tsx` | Rebuild with real Stockfish pipeline |
| `src/stores/gameStore.ts` | DELETE |
| `src/hooks/useGameReview.ts` | NEW — Game Lab analysis pipeline hook |
| `src/services/ai_coach.ts` | Add proper error return type |
| `src/components/CoachPanel.tsx` | Handle error state from coach |

---

## Success Criteria

- [ ] Every sidebar item navigates to a real full-screen view
- [ ] Library shows chapters + weak positions; clicking a chapter starts drilling
- [ ] Analysis: imported/synced games persist and appear in GameHub; clicking one opens viewer
- [ ] Game Lab: upload a PGN → see move classification + eval graph after ~30-40 seconds
- [ ] "Fix Weak Spots" button actually enters weak-spot drilling
- [ ] AI Coach shows error state instead of silent failure
- [ ] Zero new TypeScript errors introduced
