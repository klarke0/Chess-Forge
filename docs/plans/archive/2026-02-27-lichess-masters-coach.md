# Lichess Masters DB — Coach Integration Design

**Date:** 2026-02-27
**Goal:** Surface Lichess Masters Database stats in the CoachPanel (always-on widget) and inject them into the Gemini coach prompt for richer, context-aware analysis text.

---

## Problem

The Grandmaster Coach currently gives Gemini only Stockfish evaluation data and repertoire annotations. Master-game frequency statistics — which move titled players actually choose and how it performs — are absent from the training flow, even though the infrastructure already exists in GameAnalysis.

## Solution

Auto-fetch Lichess Masters stats on every position change. Display them as a compact stats widget in CoachPanel. Pass them to Gemini when Deep Analysis is triggered.

---

## Architecture

```
fen changes in trainingStore
    ↓ (debounced 400ms)
useLichessMasters(fen) hook  →  local state: { moves[], totalGames, loading }
    ↓ displayed immediately in CoachPanel widget
    ↓ stored in coachStore.mastersData

user clicks "Deep Analysis"
    ↓
coachStore.triggerAnalysis() reads mastersData from own state
    ↓
POST /api/analyze  (body includes mastersData)
    ↓
server/routes/analyze.ts injects MASTERS DATABASE context block into Gemini prompt
    ↓
Gemini text references master frequencies naturally
```

Fetch is direct from frontend to `explorer.lichess.ovh` (CORS allowed, no proxy needed). Mirrors existing `fetchLichessExplorer` pattern in `api.ts`.

---

## Files

| File | Change |
|------|--------|
| `src/services/api.ts` | Add `fetchLichessMasters(fen)` |
| `src/hooks/useLichessMasters.ts` | New hook — debounce, fetch, loading state |
| `src/stores/coachStore.ts` | Add `mastersData` field + `setMastersData` action |
| `src/components/CoachPanel.tsx` | Use hook, render widget, wire to store |
| `server/routes/analyze.ts` | Accept `mastersData` in body, inject into prompt |
| `src/services/ai_coach.ts` | Pass `mastersData` through to API call |

---

## Stats Widget

Placed between the coach text area and the Show Solution / Give Up buttons.

```
MASTERS DATABASE  ·  2,847 games
─────────────────────────────────
Nd5   ████████████░░░░  45%   W38 D32 L30
Bb3   ███████░░░░░░░░░  28%   W41 D28 L31
f4    ████░░░░░░░░░░░░  12%   W35 D29 L36
```

- Top 3 moves only
- Frequency bar (proportional to highest move's share), percentage, W/D/L
- Game count shown in header
- `totalGames < 10`: dim "Limited data" note, still render
- `moves.length === 0`: widget hidden entirely (natural for deep middlegame positions)
- Loading: three shimmer skeleton rows

---

## Lichess Masters API

```
GET https://explorer.lichess.ovh/masters?fen=<encoded>&moves=12&topGames=0
```

Response shape used:
```ts
interface MastersMove {
  san: string;
  white: number;
  draws: number;
  black: number;
}
interface MastersData {
  white: number;
  draws: number;
  black: number;
  moves: MastersMove[];
}
```

---

## Gemini Prompt Injection

New context block added to `analyzePosition` in `analyze.ts` when `mastersData` is present and has moves:

```
MASTERS DATABASE (titled players, Lichess):
- Nd5: 45% of games — W38% D32% L30%  ← most popular
- Bb3: 28% of games — W41% D28% L31%
- f4:  12% of games — W35% D29% L36%
Total: 2,847 master games at this position.

Use this to contextualize move choices: note when Stockfish's top move
aligns with master practice, or when masters prefer a practical choice
the engine doesn't rate highest.
```

---

## Edge Cases

- **No data / API error:** widget hidden, analysis proceeds without masters context (non-blocking)
- **Position not in DB:** `moves` array empty → widget hidden
- **Rapid position changes:** 400ms debounce prevents excessive API calls during drilling
- **Masters data stale on analysis trigger:** coachStore holds latest fetch result; if analysis is triggered before first fetch completes, mastersData is null and omitted from prompt gracefully
