# Learn Mode Realignment — Design Spec

**Date:** 2026-09-17
**Status:** Approved conceptually in brainstorm; awaiting spec review
**Scope:** The initial learning step ("Training" / Repertoire Run), not the drill loop

## Mission statement

The unit of training is a **decision point**, not a line. Every decision point has
two failure modes: *you* err, or *they* err. The app already drills "you erred"
(blunders, deviations → SM-2). This realignment completes the system:

- **Learn** the audited book (acquire)
- **Promote** learned positions into SM-2 (schedule → retain)
- **Punish** opponent mistakes — practiced, not just recalled

Kevin plays Caro-Kann (Black, rep 2) and Jobava London (White, rep 3) almost
exclusively, so his own games are dense signal about which variations matter.

## Pillars

### 1. Quality gate (build first)

No line enters the Learn queue un-audited. Three signals:

| Signal | Role |
|---|---|
| Course (Bortnyk/Naroditsky) | Trusted by default |
| Engine sweep (offline, one-time + on import) | Blunder tripwire: flag moves losing ≥ ~75cp |
| Lichess masters data | Tiebreak in the gray zone |

Verdict logic: course wins unless engine loss is egregious (≥75cp); masters data
arbitrates between. Flagged lines are **quarantined** from the Learn queue and
surfaced in a review report — Kevin stays the arbiter; nothing silently deleted.
Known target: the Jobava line that hangs a bishop at move 16 (bad source PGN).

This subsumes the paused Track 2 audit. Engine evals stored per book move
(new columns or side table on `positions`).

### 2. Next-lesson front door

One-tap Learn: the app picks the next lesson. Ranking is **hybrid**:

- *Within* a variation: course order (pedagogy holds together)
- *Across* variations: priority from real-game frequency — deviations table +
  game openings say what Kevin actually faces

Card shows why: "Advance Variation — faced in 6 of your last 20 games, you left
book at move 7. ~4 min." Browsable tree deferred (YAGNI; add later if wanted).

### 3. Learning ladder

Per line: **watch → guided → blind**.

- *Watch:* annotated walkthrough; `positions.comment` (course annotations)
  surfaced at branch points — the "why" layer
- *Guided:* Kevin plays his side, hints available
- *Blind:* prove it, no hints
- Passing blind **promotes the line's positions into `progress`** with fresh
  SM-2 state — the missing pipe that unifies learn and drill

`learn_runs` (laps) is replaced as the measure of "learned" by ladder stage.

### 4. Refutation demonstrations (the "why" renderer)

For any mistake — Kevin's or the opponent's — the lesson is the **2–5 move
refutation sequence**, not the verdict.

- **What:** engine PV from the mistake position (already produced by analysis)
- **Why:** Gemini captions per beat (endpoint `/api/analyze/blunder` already
  generates validated walkthrough `steps`; extend to opponent-mistake framing)
- **Performer:** `InteractiveCoach` (fixed 2026-09-17: step-jumps replay
  cumulative beats correctly) becomes the universal renderer

Interaction split:
- *Kevin's errors:* **watch** the demonstration (insight is the point)
- *Punishment training:* **play** it — Kevin must find each refutation move,
  coach plays the defense, hints on demand (generated puzzle from his own games)

### 5. Punishment injection

During Learn/Run, the scripted opponent sometimes deviates into a known mistake,
weighted by real-world frequency. Kevin must (a) notice, (b) punish. This kills
run autopilot and trains recognition, the actual in-game skill.

Mistake sources, in build order:
1. **Faced mistakes** (cheap, data exists): opponent rows in `deviations` —
   engine-evaluate before/after, store refutation PV when loss is meaningful
2. **Likely mistakes** (phase two): Lichess explorer, Kevin's rating band —
   popular-but-bad replies at early branch points, engine-refuted

Punish positions become ordinary SM-2 cards in `progress` (source: 'punish').

## Build sequence

1. **Quality gate / audit pipeline** — engine sweep over both books, flags,
   quarantine report. Foundation for everything; catches the bishop-hang line.
2. **Opponent-mistake harvesting** — evaluate opponent deviations, store
   refutation PVs. (Independent of 1; same engine-sweep tooling.)
3. **Learn ladder + next-lesson ranking** — the new Learn front door, built on
   audited data; blind-pass promotion into SM-2.
4. **Refutation demonstrations** — wire PV + Gemini steps into InteractiveCoach
   for both error classes; play-it mode for punishment.
5. **Punishment injection** — surprise deviations in runs; SM-2 punish cards.
   Explorer-sourced "likely mistakes" last.

## Constraints & invariants

- Drill pool freshness rules (CLAUDE.md) apply to all promotions: session size
  ≤ ~20% of drillable rows; interval cap 30 days. Promotion grows the pool —
  watch the ratio, don't let Learn flood SM-2 faster than it drains.
- FEN-keyed, `normalizeFen` everywhere; positions/progress schema is the spine.
- Engine sweeps run offline/background — never block the UI; app stays
  pick-up-and-play in 30 seconds.
- Mobile-first; forge-* tokens; InteractiveCoach conventions.
- Gemini = captions only; engine = moves/truth. Never let the LLM pick moves.
