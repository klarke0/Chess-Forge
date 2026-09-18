# Punish Drills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opponent mistakes harvested into `deviations` (loss_cp ≥ 150 with refutation_pv) become drillable "punish" cards inside the normal Train Now session, with a refutation walkthrough on success and Gemini coaching on failure.

**Architecture:** A fourth drill source in the server session builder converts each punishable deviation into a drill at the position AFTER the opponent's mistake (drill answer = first move of the stored refutation PV, full SAN line shipped to the client). The client renders a punish framing strip, walks the refutation with the existing InteractiveCoach on a correct answer, and routes wrong answers through the existing BlunderExplanation with punish framing. SM-2 treats `punish` as its own source (initial EF 2.0).

**Tech Stack:** Bun server (bun:sqlite, chess.js), React/TS client, existing InteractiveCoach + BlunderExplanation components.

**Spec:** `docs/superpowers/specs/2026-09-17-learn-mode-realignment-design.md` (Pillar 5 source 1 + Pillar 4 interaction split)

## Global Constraints

- Max **3** punish cards per 12-position session.
- Punish source rows: `deviations WHERE notes='opponent' AND loss_cp >= 150 AND refutation_pv IS NOT NULL AND refutation_pv != ''`.
- Drill FEN = position after applying `played_san` to `deviations.fen`; all FENs through `normalizeFen`; client-facing FENs via the file's existing `ensureFullFen`.
- SM-2: source `punish` → initial ease factor **2.0** (between deviation 2.0 and blunder tiers — same as deviation); 30-day interval cap untouched.
- Timer: punish drills get **25s** (same as blunder).
- No new screens or nav; everything lands in the existing TrainNowScreen session loop.
- Style: forge-* tokens, cn(), lucide-react; ESLint bans hardcoded hex/white-alpha.
- `npm run typecheck:server`, `npx tsc --noEmit`, `npm run lint` stay green. `./dev.sh build` before any restart. Frontend has no unit-test runner — client verification is typecheck+lint+build+live smoke.
- Do NOT restart the backend inside implementer tasks (a background audit sweep may be running; the controller owns rollout).

---

### Task 1: Server — punish source, SM-2 ease, coach framing field

**Files:**
- Modify: `server/routes/v2_train_now.ts`
- Modify: `server/routes/progress.ts` (initialEaseFactor)
- Modify: `server/routes/analyze.ts` (optional `framing` body field)
- Test: `server/tests/punish_source.test.ts`

**Interfaces:**
- Consumes: `deviations` columns added by the harvest (loss_cp, refutation_pv), `normalizeFen`, chess.js.
- Produces (client relies on these exact names): `TrainPosition.source` union gains `"punish"`; new optional fields `opponentMove?: string` (the mistake SAN) and `refutationSans?: string[]` (SAN line from the drill FEN, first element === correctSan, length ≤ 5). Exported pure helper `punishCandidateFromRow(row: {fen: string; played_san: string; refutation_pv: string; loss_cp: number; game_id: number; move_number: number; date: string | null}): PunishCandidate | null` where `PunishCandidate = {drillFen: string; opponentMove: string; correctSan: string; refutationSans: string[]; cpLossPawns: number}`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/tests/punish_source.test.ts
import { describe, expect, test } from "bun:test";
import { punishCandidateFromRow } from "../routes/v2_train_now";

// Real harvested row shape: Jobava Nb5 position, opponent ignored the Nxc7+ threat.
const FORK_ROW = {
  fen: "r1bqkb1r/ppp1pppp/2n2n2/1N1p4/3P1B2/8/PPP1PPPP/R2QKBNR b KQkq -",
  played_san: "Qd7",
  refutation_pv: "b5c7 e8d8 c7a8 e7e5 d4e5 f6e4",
  loss_cp: 745,
  game_id: 1,
  move_number: 4,
  date: "2025-12-18T17:08:24.000Z",
};

describe("punishCandidateFromRow", () => {
  test("builds the drill at the post-mistake position with the refutation as answer", () => {
    const c = punishCandidateFromRow(FORK_ROW);
    expect(c).not.toBeNull();
    // Drill FEN: after ...Qd7 it is White to move
    expect(c!.drillFen.split(" ")[1]).toBe("w");
    expect(c!.opponentMove).toBe("Qd7");
    // b5c7 from the drill FEN is the knight fork Nxc7+
    expect(c!.correctSan).toBe("Nxc7+");
    expect(c!.refutationSans[0]).toBe("Nxc7+");
    expect(c!.refutationSans.length).toBeLessThanOrEqual(5);
    expect(c!.cpLossPawns).toBeCloseTo(7.45, 2);
  });

  test("returns null when the recorded mistake move is illegal at the stored FEN", () => {
    expect(punishCandidateFromRow({ ...FORK_ROW, played_san: "Qxa1" })).toBeNull();
  });

  test("returns null when the refutation PV's first move is illegal after the mistake", () => {
    expect(
      punishCandidateFromRow({ ...FORK_ROW, refutation_pv: "a8a1 e8d8" }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server/tests/punish_source.test.ts`
Expected: FAIL — `punishCandidateFromRow` is not exported.

- [ ] **Step 3: Implement the helper + wire the source**

In `server/routes/v2_train_now.ts`:

3a. Extend the interface:

```typescript
  source: "blunder" | "deviation" | "review" | "repertoire" | "punish";
  /** punish drills: the opponent's mistake move (SAN) that created this position */
  opponentMove?: string;
  /** punish drills: refutation line in SAN from the drill FEN; [0] === correctSan */
  refutationSans?: string[];
```

3b. Add the exported pure helper (near the other helpers):

```typescript
export interface PunishCandidate {
  drillFen: string;
  opponentMove: string;
  correctSan: string;
  refutationSans: string[];
  cpLossPawns: number;
}

/**
 * Convert one harvested opponent deviation into a punish drill candidate.
 * The drill position is AFTER the opponent's mistake — the user is to move
 * and must find the engine's refutation. Returns null when the stored data
 * doesn't replay cleanly (illegal recorded move / stale PV).
 */
export function punishCandidateFromRow(row: {
  fen: string;
  played_san: string;
  refutation_pv: string;
  loss_cp: number;
  game_id: number;
  move_number: number;
  date: string | null;
}): PunishCandidate | null {
  try {
    const chess = new Chess(ensureFullFen(row.fen));
    if (!chess.move(row.played_san)) return null;
    const drillFen = chess.fen();
    const refutationSans: string[] = [];
    for (const uci of row.refutation_pv.split(/\s+/).slice(0, 5)) {
      const m = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as "q" | "r" | "b" | "n" | undefined) ?? "q",
      });
      if (!m) break;
      refutationSans.push(m.san);
    }
    if (refutationSans.length === 0) return null;
    return {
      drillFen,
      opponentMove: row.played_san,
      correctSan: refutationSans[0],
      refutationSans,
      cpLossPawns: row.loss_cp / 100,
    };
  } catch {
    return null;
  }
}
```

(chess.js `.move()` throws on illegal in some versions — the try/catch covers both null-return and throw styles.)

3c. Add "Source 4" after the deviation block, feeding the same `candidates` map:

```typescript
  // ---------- Source 4: Punishable opponent mistakes (harvested) ----------
  const punishRows = db
    .query(
      `SELECT d.fen, d.played_san, d.refutation_pv, d.loss_cp, d.game_id, d.move_number, g.date
       FROM deviations d
       JOIN games g ON d.game_id = g.id
       WHERE d.repertoire_id = ? AND d.notes = 'opponent'
         AND d.loss_cp >= 150
         AND d.refutation_pv IS NOT NULL AND d.refutation_pv != ''
       ORDER BY d.loss_cp DESC`,
    )
    .all(repertoireId) as any[];

  for (const row of punishRows) {
    const cand = punishCandidateFromRow(row);
    if (!cand) continue;
    const nFen = normalizeFen(cand.drillFen);
    if (dismissedSet.has(nFen)) continue;
    if (candidates.has(nFen)) continue; // another source already owns this FEN
    candidates.set(nFen, {
      san: cand.opponentMove,
      correctSan: cand.correctSan,
      totalCpLoss: cand.cpLossPawns,
      occurrences: 1,
      source: "punish",
      gameId: row.game_id,
      moveNumber: row.move_number,
      date: row.date,
      context: buildContext(row.game_id, row.move_number),
      fullFen: cand.drillFen,
      opponentMove: cand.opponentMove,
      refutationSans: cand.refutationSans,
    });
  }
```

The candidate map's value type needs the two new optional fields (`opponentMove`, `refutationSans`) — add them where the map's shape is declared, and carry them through the `scored.push({...})` assembly so they reach the response payload.

3d. Cap punish cards at 3 per session. After the existing jitter/tier assembly produces the final ordered list and before it is sliced to session size, filter:

```typescript
  // Punish cards are spice, not the meal: at most 3 per session.
  let punishCount = 0;
  const capped = finalOrdered.filter((p) =>
    p.source === "punish" ? ++punishCount <= 3 : true,
  );
```

(Adapt `finalOrdered` to whatever the local variable is at that point; keep the existing 12-position slice downstream.)

3e. In `server/routes/progress.ts`, extend `initialEaseFactor`:

```typescript
  if (source === "deviation") return 2.0;
  if (source === "punish") return 2.0;
```

3f. In `server/routes/analyze.ts`, accept an optional `framing?: string` in the POST /api/analyze/blunder body and, when present, append it to the Gemini prompt as its own paragraph before the output instructions (find where the prompt string is assembled and interpolate `framing ? `\n\nCONTEXT: ${framing}` : ""`). No behavior change when absent.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test server/tests/punish_source.test.ts` → 3 pass.
Run: `bun test server/tests/` → all suites pass (no regressions).
Run: `npm run typecheck:server` → clean.

- [ ] **Step 5: Commit**

```bash
git add server/routes/v2_train_now.ts server/routes/progress.ts server/routes/analyze.ts server/tests/punish_source.test.ts
git commit -m "feat(punish): punish drill source in train-now, SM-2 ease, coach framing"
```

---

### Task 2: Client — punish framing, refutation walkthrough, coach wiring

**Files:**
- Modify: `src/v2/TrainNowScreen.tsx`
- Modify: `src/v2/BlunderExplanation.tsx`
- Modify: `src/services/api.ts` (only if the TrainPosition client type / analyze body type live there — mirror the new fields)

**Interfaces:**
- Consumes (exact names from Task 1): drill items may have `source: "punish"`, `opponentMove?: string`, `refutationSans?: string[]`. `POST /api/analyze/blunder` accepts optional `framing: string`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Mirror the payload types**

Find the client-side type for train-now positions (grep `source` in `src/services/api.ts` and `src/v2/TrainNowScreen.tsx`) and add `"punish"` to the source union plus the two optional fields, matching Task 1's names exactly.

- [ ] **Step 2: Punish framing strip**

In `TrainNowScreen.tsx`, where source-specific hint text renders (the block with `"— you missed this before"` / `"— stay in your repertoire"`), add the punish variant, and add a distinct framing strip above the board area when `currentPosition.source === "punish"`:

```tsx
{currentPosition.source === "punish" && currentPosition.opponentMove && (
  <div className="flex items-center gap-2 rounded-forge-lg bg-forge-card border border-amber-500/30 px-3 py-2">
    <Zap size={14} className="text-amber-400 shrink-0" />
    <span className="text-[12px] font-bold text-slate-300">
      They left book:{" "}
      <span className="text-rose-400 font-black">{currentPosition.opponentMove}</span>
      {" — punish it."}
    </span>
  </div>
)}
```

(Place it consistently with the existing context line; reuse surrounding spacing conventions. Import `Zap` from lucide-react if not present.)

Also: `getTimerDuration` → punish gets 25s:

```typescript
function getTimerDuration(source?: string): number {
  return source === "blunder" || source === "punish" ? 25 : 15;
}
```

Update the session-summary source counts block (the one counting blunders/deviations/review/repertoire) to include a punish count so the pre-session breakdown stays accurate.

- [ ] **Step 3: Refutation walkthrough on correct answer**

When a punish drill is answered correctly and `refutationSans.length > 1`, show the continuation instead of instantly advancing. Build coach steps client-side (no Gemini call) and render the existing `InteractiveCoach` in the explanation phase:

```typescript
function buildPunishSteps(
  refutationSans: string[],
  opponentMove: string,
): CoachStep[] {
  return refutationSans.map((san, i) => ({
    text:
      i === 0
        ? `Punishing ${opponentMove}: ${san} is the move.`
        : i % 2 === 1
          ? `Their best try: ${san}.`
          : `You continue with ${san}.`,
    action: {
      type: "playMove",
      san,
      highlight: i % 2 === 0 ? "green" : "red",
    },
  }));
}
```

Match `CoachStep`'s actual shape (see `src/v2/InteractiveCoach.tsx` props and how `BlunderExplanation` feeds it) — adjust field names to the real interface rather than inventing new ones. Wire it through the same board-callback props BlunderExplanation uses (`onPlayMove`/`onResetBoard` pattern) so the walkthrough animates on the drill board. The user can skip/advance with the existing coach controls; on walkthrough end, the normal "next drill" flow resumes.

First-try-correct punish drills SHOULD show this walkthrough (unlike blunder drills, which skip explanation on first-try correct) — seeing the full punishment line is the lesson. Keep the skip behavior for other sources untouched.

- [ ] **Step 4: Wrong answer → Gemini with punish framing**

`BlunderExplanation` already fires on wrong answers. Add an optional `framing?: string` prop, pass it into the `/api/analyze/blunder` request body, and from TrainNowScreen supply it for punish drills:

```typescript
framing: currentPosition.source === "punish"
  ? `The opponent just blundered with ${currentPosition.opponentMove} (a ${currentPosition.cpLoss.toFixed(1)}-pawn mistake). The student was asked to find the punishment ${currentPosition.correctSan} and played ${wrongMove} instead. Explain what the punishment achieves and what the student's move lets the opponent escape.`
  : undefined
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → clean.
Run: `npx eslint src/v2/TrainNowScreen.tsx src/v2/BlunderExplanation.tsx` → no errors.
Run: `./dev.sh build` → exit 0. Do NOT restart.

- [ ] **Step 6: Commit**

```bash
git add src/v2/TrainNowScreen.tsx src/v2/BlunderExplanation.tsx src/services/api.ts
git commit -m "feat(punish): punish framing, refutation walkthrough, coach wiring in Train Now"
```

---

### Task 3: Rollout + live verification (controller-run)

- [ ] **Step 1:** `./dev.sh build` (exit 0) then `./dev.sh restart` — only when no audit sweep is mid-run, or after accepting the sweep will resume.
- [ ] **Step 2:** `curl -s "localhost:3001/api/v2/train-now?repertoireId=3"` (exact path per server/index.ts) — verify the session JSON contains ≤3 items with `"source":"punish"`, each carrying `opponentMove` and non-empty `refutationSans` whose first element equals `correctSan`.
- [ ] **Step 3:** Record an attempt against a punish FEN via POST /api/progress/record with `source: "punish"`, then confirm the progress row's ease_factor is 2.0 for a first correct attempt. Clean up the test row.
- [ ] **Step 4:** Mobile smoke on the phone (Kevin): start a session, confirm the punish strip renders and the walkthrough plays. (Deferred to Kevin's next session if he's away.)

## Self-Review Notes

- Spec coverage: Pillar 5 source-1 drilling + Pillar 4 "play-it for punishment / Gemini on failure" → Tasks 1–2. Injection into repertoire runs and explorer-sourced mistakes remain explicitly out (spec build order).
- Type consistency: `opponentMove`/`refutationSans` names identical across Task 1 payload, Task 2 client mirror; `punishCandidateFromRow` exported for the test; `framing` field name matches across analyze.ts, BlunderExplanation, TrainNowScreen.
- Placeholders: Task 2 steps 1 and 3 direct the implementer to match existing client type/prop names rather than dictating them blind — deliberate, since the plan author verified the components exist but not every field name; the instruction names the exact files and greps to resolve them.
