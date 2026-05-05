# Lichess Masters DB — Coach Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an always-on Lichess Masters stats widget to CoachPanel, and inject those stats into the Gemini coach prompt for richer, context-aware analysis text.

**Architecture:** `fetchLichessMasters` fetches directly from `explorer.lichess.ovh` (CORS allowed, no proxy needed). A debounced `useLichessMasters` hook drives a compact stats widget in CoachPanel. Masters data is stored in `coachStore` so that when Deep Analysis fires, it is automatically included in the Gemini request body, which the server injects as a context block into the prompt.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS v3, Bun (server-side), Gemini 2.0 Flash

---

### Task 1: Add MastersData types + `fetchLichessMasters` to `api.ts`

**Files:**
- Modify: `src/services/api.ts`

**Step 1: Add exported types and fetch function**

After the existing `fetchLichessExplorer` function (around line 83), add:

```ts
export interface MastersMove {
  san: string;
  uci: string;
  white: number;
  draws: number;
  black: number;
}

export interface MastersData {
  white: number;
  draws: number;
  black: number;
  moves: MastersMove[];
}

export async function fetchLichessMasters(fen: string): Promise<MastersData> {
  const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=12&topGames=0`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Lichess Masters API error');
  return res.json();
}
```

**Step 2: Add `mastersData` to `AnalyzeRequest`**

Find the `AnalyzeRequest` interface (around line 222) and add one field:

```ts
export interface AnalyzeRequest {
  fen: string;
  lastMove: string;
  turn: string;
  userColor?: string;
  engineData?: { bestMove: string; eval: string; line: string };
  openingName?: string;
  repertoireComment?: string;
  mode?: string;
  repertoireMoves?: string[];
  mastersData?: MastersData | null;   // ← ADD
}
```

**Step 3: Verify**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

---

### Task 2: Create `useLichessMasters` hook

**Files:**
- Create: `src/hooks/useLichessMasters.ts`

**Step 1: Write the hook**

```ts
import { useState, useEffect } from 'react';
import { fetchLichessMasters, MastersData } from '../services/api';

export function useLichessMasters(fen: string) {
  const [data, setData] = useState<MastersData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fen) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await fetchLichessMasters(fen);
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fen]);

  return { data, loading };
}
```

The 400ms debounce prevents firing on every rapid position change during drilling. The `cancelled` flag prevents stale async responses from overwriting newer data.

**Step 2: Verify**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

---

### Task 3: Add `mastersData` + `setMastersData` to `coachStore`

**Files:**
- Modify: `src/stores/coachStore.ts`

**Step 1: Add import**

At the top of the file, add:

```ts
import type { MastersData } from '../services/api';
```

**Step 2: Extend `CoachState` interface**

```ts
interface CoachState {
  currentInsight: string | null;
  demoLine: string[];
  isAnalyzing: boolean;
  isError: boolean;
  mastersData: MastersData | null;          // ← ADD

  setInsight: (insight: string | null) => void;
  setDemoLine: (line: string[]) => void;
  clearInsight: () => void;
  setMastersData: (data: MastersData | null) => void;  // ← ADD
  analyzePosition: (fen: string, lastMove: string, turn: string, engineData?: { bestMove: string; eval: string; line: string }, repertoireComment?: string, userColor?: string, mode?: string, repertoireMoves?: string[]) => Promise<void>;
}
```

**Step 3: Add initial state + action**

In the `create` call, add to initial state:
```ts
mastersData: null,
```

Add the new action alongside `setInsight` etc.:
```ts
setMastersData: (data) => set({ mastersData: data }),
```

**Step 4: Thread mastersData into `analyzePosition`**

Update the existing `analyzePosition` action to read its own `mastersData` state and pass it through:

```ts
analyzePosition: async (fen, lastMove, turn, engineData, repertoireComment, userColor, mode, repertoireMoves) => {
  set({ isAnalyzing: true, isError: false });
  try {
    const openingName = useRepertoireStore.getState().repertoireName || 'your opening';
    const { mastersData } = useCoachStore.getState();  // ← ADD: read own latest state
    const result = await analyzePosition(fen, lastMove, turn, engineData, openingName, repertoireComment, userColor, mode, repertoireMoves, mastersData);
    set({ currentInsight: result.text, demoLine: result.demoLine, isError: result.isError, isAnalyzing: false });
  } catch (e) {
    console.error(e);
    set({ isError: true, isAnalyzing: false });
  }
},
```

Note: `useCoachStore.getState()` is a standard Zustand pattern for self-referencing store state inside an action.

**Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

---

### Task 4: Thread `mastersData` through `ai_coach.ts`

**Files:**
- Modify: `src/services/ai_coach.ts`

**Step 1: Add import + extend signature**

The file currently imports `* as api`. Add a type import:

```ts
import type { MastersData } from './api';
```

Update `analyzePosition` to accept and forward `mastersData`:

```ts
export async function analyzePosition(
  fen: string,
  lastMove: string,
  turn: string,
  engineData?: { bestMove: string; eval: string; line: string },
  openingName = 'your opening',
  repertoireComment?: string,
  userColor?: string,
  mode?: string,
  repertoireMoves?: string[],
  mastersData?: MastersData | null,   // ← ADD
) {
  try {
    return await api.analyzePosition({
      fen, lastMove, turn, userColor, engineData,
      openingName, repertoireComment, mode, repertoireMoves,
      mastersData,                               // ← ADD
    });
  } catch (error) {
    console.error("AI Coach error:", error);
    return {
      text: "Coach unavailable — check your connection or start the backend server.",
      demoLine: [],
      isError: true,
    };
  }
}
```

**Step 2: Verify**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

---

### Task 5: Inject masters context into Gemini prompt in `server/routes/analyze.ts`

**Files:**
- Modify: `server/routes/analyze.ts`

**Step 1: Add `mastersData` to request body type**

The inline type cast on `req.json()` (around line 5) — add `mastersData`:

```ts
const body = await req.json() as {
  fen: string;
  lastMove: string;
  turn: string;
  userColor?: string;
  engineData?: { bestMove: string; eval: string; line: string };
  openingName?: string;
  repertoireComment?: string;
  mode?: string;
  repertoireMoves?: string[];
  mastersData?: {             // ← ADD
    white: number;
    draws: number;
    black: number;
    moves: Array<{ san: string; white: number; draws: number; black: number }>;
  } | null;
};
```

**Step 2: Destructure it**

Find the destructure line (around line 25) and add `mastersData`:

```ts
const { fen, lastMove, engineData, openingName = "your opening", repertoireComment, userColor, mode, repertoireMoves, mastersData } = body;
```

**Step 3: Add masters context block**

After the existing `if (engineData)` context block (around line 55), add:

```ts
if (mastersData && mastersData.moves.length > 0) {
  const totalGames = mastersData.white + mastersData.draws + mastersData.black;
  const topMoves = mastersData.moves.slice(0, 3).map((m) => {
    const moveTotal = m.white + m.draws + m.black;
    const pct = Math.round((moveTotal / totalGames) * 100);
    const wPct = Math.round((m.white / moveTotal) * 100);
    const dPct = Math.round((m.draws / moveTotal) * 100);
    const lPct = 100 - wPct - dPct;
    return `- ${m.san}: ${pct}% of games — W${wPct}% D${dPct}% L${lPct}%`;
  });
  const mostPopular = mastersData.moves[0]?.san ?? '';
  context += `
    MASTERS DATABASE (titled players, Lichess — ${totalGames.toLocaleString()} games):
    ${topMoves.join('\n    ')}
    The most popular move among masters is ${mostPopular}.

    Use this to contextualize move choices: note when Stockfish's recommendation aligns with master practice, or when masters favor a practical choice the engine doesn't rate highest.
    `;
}
```

**Step 4: Verify TypeScript on both frontend and server**

```bash
cd "/Users/kevin/Chess Trainer" && npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors (server files are `.ts` and included in tsc scope).

---

### Task 6: Add `fen` prop + masters widget to `CoachPanel`

**Files:**
- Modify: `src/components/CoachPanel.tsx`

**Step 1: Update imports**

Change the React import to include `useEffect`:
```ts
import React, { useEffect } from 'react';
```

Add two more imports below the existing ones:
```ts
import { useLichessMasters } from '../hooks/useLichessMasters';
```

(`useCoachStore` is already imported on line 3.)

**Step 2: Add `fen` to props interface**

```ts
interface CoachPanelProps {
  fen: string;               // ← ADD
  onDeepAnalysis: () => void;
  onPlayDemo: () => void;
  onShowSolution: () => void;
  onGiveUp: () => void;
}
```

**Step 3: Destructure `fen` and wire the hook**

In the component body, after the existing store reads:
```ts
const setMastersData = useCoachStore(s => s.setMastersData);
const { data: mastersData, loading: mastersLoading } = useLichessMasters(fen);

useEffect(() => {
  setMastersData(mastersData);
}, [mastersData, setMastersData]);
```

**Step 4: Add the stats widget JSX**

Place this block between the closing `</div>` of the scrollable content area and the `<div className="flex gap-3 ...">` training actions section:

```tsx
{/* Masters Database widget */}
{(mastersLoading || (mastersData && mastersData.moves.length > 0)) && (
  <div className="relative z-10 mb-4">
    <div className="border border-white/5 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-white/[0.02] border-b border-white/5">
        <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-500">
          Masters Database
        </span>
        {mastersData && (
          <span className="text-[9px] font-bold text-slate-600">
            {(mastersData.white + mastersData.draws + mastersData.black).toLocaleString()} games
          </span>
        )}
      </div>

      {/* Rows */}
      <div className="divide-y divide-white/[0.03]">
        {mastersLoading && !mastersData ? (
          [0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 animate-pulse">
              <div className="w-8 h-2.5 bg-white/5 rounded" />
              <div className="flex-1 h-1.5 bg-white/5 rounded-full" />
              <div className="w-6 h-2.5 bg-white/5 rounded" />
            </div>
          ))
        ) : (
          mastersData?.moves.slice(0, 3).map((move) => {
            const totalGames = mastersData.white + mastersData.draws + mastersData.black;
            const moveTotal = move.white + move.draws + move.black;
            const pct = Math.round((moveTotal / totalGames) * 100);
            const maxTotal = mastersData.moves[0]
              ? mastersData.moves[0].white + mastersData.moves[0].draws + mastersData.moves[0].black
              : 1;
            const barWidth = Math.round((moveTotal / maxTotal) * 100);
            const wPct = Math.round((move.white / moveTotal) * 100);
            const dPct = Math.round((move.draws / moveTotal) * 100);
            const lPct = 100 - wPct - dPct;

            return (
              <div key={move.san} className="flex items-center gap-2.5 px-3 py-2">
                <span className="text-[11px] font-black text-slate-300 w-8 shrink-0">{move.san}</span>
                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500/60 rounded-full"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-slate-400 w-7 text-right shrink-0">{pct}%</span>
                <span className="text-[9px] font-mono text-slate-600 shrink-0">
                  W{wPct} D{dPct} L{lPct}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  </div>
)}
```

**Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: 0 errors.

---

### Task 7: Pass `fen` from `TrainTab` to `CoachPanel`

**Files:**
- Modify: `src/components/TrainTab.tsx`

`TrainTab` already receives `fen` as a prop. Find the `<CoachPanel>` JSX (around line 299) and add the prop:

```tsx
<CoachPanel
  fen={fen}                         {/* ← ADD */}
  onDeepAnalysis={onDeepAnalysis}
  onPlayDemo={onPlayDemo}
  onShowSolution={onShowSolution}
  onGiveUp={onGiveUp}
/>
```

**Step 2: Verify + build**

```bash
cd "/Users/kevin/Chess Trainer"
npx tsc --noEmit 2>&1   # must exit 0
./dev.sh build           # must exit 0
```

**Step 3: Manual smoke test**

- [ ] Open training view, enter any well-known opening position — Masters widget appears with move stats
- [ ] Clicking through moves updates the widget (brief loading shimmer between positions)
- [ ] Click "Deep Analysis" — coach text references master move frequencies
- [ ] Navigate to a deep middlegame position — widget disappears (no master games)
- [ ] Loading state: three skeleton rows visible briefly on position change
