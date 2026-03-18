# Chess Trainer — Improvement Plan

> Personal chess opening trainer. Currently drills the Jobava London (White). Goal: evolve into a full-featured, multi-repertoire training tool with AI coaching, game analysis, and progress tracking.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Storage | Bun backend + SQLite (`bun:sqlite`) | Chess.com API needs CORS proxy; SQLite enables rich queries on progress data |
| State management | Zustand (split stores) | Minimal boilerplate, scales well, no provider wrappers |
| Color support | White + Black from day one | Easier to architect now than retrofit |
| Punishment mode | Progressive | 1st mistake = gentle, 2nd = auto-demo of opponent refutation |
| Game imports | Chess.com first, Lichess later | User's primary platform |
| Repertoire tree | Yes | Visual opening tree with mastery color-coding |
| Refactor first | Yes | Clean architecture before features |

---

## Phase 1: Refactor Architecture — ✅ COMPLETE

**Owner: Claude/Gemini**
**Status:** Monolith decomposed into modular components and Zustand stores.

### 1.1 Install Zustand — ✅ Done
### 1.2 Create Zustand Stores — ✅ Done
- `useGameStore`, `useEngineStore`, `useRepertoireStore`, `useTrainingStore` implemented. 
### 1.3 Extract Components — ✅ Done
- `Header`, `ChessBoard`, `MoveLedger`, `TacticalMonitor`, `CoachPanel`, `ChapterLibrary`, `ModeSelector` created.
### 1.4 Extract Hooks — ✅ Done
- `useTraining.ts` created to manage the training loop logic.
### 1.5 Make Training Color-Agnostic — 🔄 In Progress
### 1.6 Update `cn()` Utility — ✅ Done

---

## Phase 2: Bun Backend + SQLite

**Owner: Claude**
**Goal:** Lightweight server for data persistence and API proxying.

### 2.1 Server Setup — 🔄 In Progress
### 2.2 SQLite Schema — ✅ Done
### 2.3 API Endpoints — 🔄 In Progress

---

## Phase 3: Smarter Training

**Owner: Claude (logic) + Gemini (UI)**

### 3.1 Spaced Repetition (SM-2 Algorithm)
### 3.2 Training Modes UI — ✅ Done
- `ModeSelector` component implemented.
### 3.3 Progress Dashboard — ✅ Done
- `ProgressDashboard` connected to real application state (Weak Points, Repertoire).
### 3.4 Progressive Punishment — ✅ Initial Demo Version Done

---

## Phase 4: Multi-Repertoire Support

**Owner: Claude (import logic) + Gemini (UI)**

### 4.1 Generic PGN Import
### 4.2 Lichess Study Import
### 4.3 Chess.com Game Import
### 4.4 Repertoire Deviation Finder

---

## Phase 5: Enhanced AI Coach

**Owner: Claude (integration) + Gemini (prompt engineering)**

### 5.1 Mistake Explanation
### 5.2 Strategic Concept Teaching
### 5.3 Quiz Mode
### 5.4 Opponent Punishment Demos — ✅ Done
- "Play Demo" feature visualizes AI coach's tactical lines.
### 5.5 Practice Recommendations

---

## Phase 6: Repertoire Tree Visualization — ✅ COMPLETE

**Owner: Gemini (UI) with Claude (data)**

### 6.1 Tree Data Structure — ✅ Done
- Recursive tree building from repertoire data.
### 6.2 Visualization — ✅ Done
- `RepertoireTree` component with color-coded mastery and instant-jump functionality.

---

## Task Assignment Summary

| Task | Owner | Phase | Status |
|---|---|---|---|
| Decompose App.tsx into components + hooks | Claude | 1 | ✅ Done |
| Create Zustand stores | Claude | 1 | ✅ Done |
| Make training color-agnostic | Claude | 1 | 🔄 In Progress |
| Bun server setup + SQLite schema | Claude | 2 | ✅ In Progress |
| API endpoints | Claude | 2 | 🔄 In Progress |
| SM-2 spaced repetition logic | Claude | 3 | Pending |
| Training mode logic (random quiz, weak drill) | Claude | 3 | Pending |
| Progress Dashboard UI | Gemini | 3 | ✅ Done |
| Progressive punishment integration | Claude + Gemini | 3 | ✅ Done |
| PGN import (generalize parser) | Claude | 4 | Pending |
| Chess.com game import + deviation finder | Claude | 4 | Pending |
| Lichess study import | Claude | 4 | Pending |
| Import/repertoire management UI | Gemini | 4 | Pending |
| AI coach prompt engineering | Claude + Gemini | 5 | ✅ Done |
| Quiz mode UI | Gemini | 5 | Pending |
| Repertoire tree data endpoint | Claude | 6 | Pending |
| Tree visualization component | Gemini | 6 | ✅ Done |

---

## Dev Setup

```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Backend
cd server && bun run index.ts
```

## File Structure Current State

```
Chess Trainer/
├── src/
│   ├── components/ (Modular UI)
│   ├── stores/ (Global State)
│   ├── hooks/ (Custom Logic)
│   ├── services/ (Engine + AI Coach)
│   └── utils/ (Utilities)
├── server/ (Bun + SQLite Backend)
```
