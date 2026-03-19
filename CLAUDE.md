# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server:** `npm run dev` (Vite)
- **Start all services:** `./dev.sh`
- **Start tunnel (ngrok):** `./dev.sh tunnel`
- **Stop all services:** `./dev.sh stop`
- **Build (Strict):** `./dev.sh build` (Always use this before restarting for mobile testing)

## AI Agent Protocols: Mobile Testing
**CRITICAL:** When pushing changes for mobile testing via ngrok, the backend serves the `dist/` folder. You MUST run `./dev.sh build` synchronously in the foreground and verify its success `exit 0` BEFORE attempting to restart the backend. Never string build and restart commands together in the background (`npm run build && restart &`), as silent TypeScript errors will result in the old buggy bundle being served to the user.
- **Lint:** `npm run lint` (ESLint with TypeScript + React hooks rules)
- **Preview prod build:** `npm run preview`
- **Rebuild repertoire data:** `node scripts/parseJobava.cjs` (parses PGN files from `bortnyk-and-naroditsky-s-jobava-london/` into `src/data/jobava_full.json`)

## Architecture

Single-page React/TypeScript app (Vite + Tailwind CSS) that drills chess opening repertoire moves. No backend, no routing, no state management library.

### Core Data Flow

```
PGN files → parseJobava.cjs → src/data/jobava_full.json → App.tsx (static import)
```

The repertoire JSON has two keys:
- `chapters`: Array of 10 chapter objects (`name`, `startMoves[]`, `firstFen`)
- `positions`: FEN-keyed map → array of `{ san, nextFen, comment? }` — the move tree

### Training Loop

User plays White against the repertoire. On `onPieceDrop`, the played move is checked against `positions[currentFen]`. Correct moves advance; wrong moves shake the panel and increment `mistakeCount`. After 2 mistakes, the correct move is revealed. After each correct White move, a "Proceed" gate appears, then the app plays Black's response randomly from the repertoire tree.

Novelty detection: if a wrong move has Stockfish eval > +0.50, it's flagged as a "novelty" instead of an error.

### Key Services

- **`services/engine.ts`** — `StockfishEngine` class fetches Stockfish 10 from CDN, creates a Web Worker (via Blob URL for CORS), runs MultiPV 3. The `useStockfish()` hook manages lifecycle and parses UCI output into `EngineLine[]`.
- **`services/ai_coach.ts`** — Calls Gemini 2.0 Flash with the current FEN + last move. Parses structured `ANALYSIS:` / `LINE:` output. API key from `VITE_GEMINI_API_KEY` in `.env.local`.

### v2 Data Layer

- **`GET /api/v2/train-now?repertoireId=X`** — Returns top 8 mistake-pool positions scored by:
  `score = cpLossWeight * recencyWeight * repetitionWeight / familiarityDecay`
  Sources: progress table (accuracy < 0.7 or due), recent blunders (90 days, CP loss > 0.5), deviations table (90 days).
- **`POST /api/analyze/blunder`** — Gemini-powered blunder explanation (GM coaching style). Returns `{ text, concept }`.
- **Deviation persistence** — `server/utils/deviations.ts` runs after `saveAnalysis`, computing repertoire deviations and writing to the `deviations` table.
- **`server/routes/v2_train_now.ts`** — Mistake pool builder and scoring logic.

### Current State

Everything lives in a single `App.tsx` (~510 lines) with all state as `useState` hooks. The `src/utils/` directory exists but is empty. Weak positions are tracked in localStorage (`jobava_weak_points`) as a `Record<FEN, count>` but not yet surfaced in the UI.

## Path Alias

`@/` maps to `./src/` (configured in both `vite.config.ts` and `tsconfig.json`).

## Style Conventions

- Tailwind CSS utility classes with `cn()` helper (clsx + tailwind-merge) for conditional classes
- Dark theme: near-black backgrounds (`#050507`, `#0d1117`), slate text, indigo accents
- Very large border-radius on cards (`rounded-[3.5rem]`, `rounded-[4rem]`)
- Sounds loaded from chess.com CDN URLs
- Icons from lucide-react
