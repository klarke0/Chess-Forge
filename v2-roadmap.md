# V2 Improvement Roadmap

Compiled from chess-expert, ui-agent, and data-agent. Grouped by area, ordered by impact.

---

## 🔴 Correctness / Bug Fixes

### Opponent deviations polluting the drill pool
**Source:** data-agent
Deviations table stores both player and opponent side. The `train-now` query fetches all deviations without filtering by `notes = 'player'`. The user is being drilled on moves *the opponent* deviated from, which they had no control over.
**Fix:** Add `AND d.notes = 'player'` to the deviations query in `v2_train_now.ts` (line ~247).

### Deviations missing for games analyzed before v2 shipped
**Source:** data-agent
`computeAndPersistDeviations` only runs on newly analyzed games. Any game analyzed before this code shipped has zero deviations in the DB, so the deviation training pool will be empty for most users.
**Fix:** Add a `POST /api/v2/backfill-deviations` endpoint (or one-time script) that iterates all games with `analysis_json IS NOT NULL` and runs `computeAndPersistDeviations` on each.

---

## 🟠 Data Quality / Scoring

### Review positions score too low (cpLoss = 0 always)
**Source:** data-agent
Progress-table positions enter the scoring with `cpLoss: 0`, giving them `cpLossWeight = 1` regardless of how often or badly the user misses them. A chronically wrong position scores the same as a trivially missed one.
**Fix:** Use `(1 - accuracy) * 3` as a proxy cpLoss for review positions, or merge cpLoss from the blunder/deviation entries when the same FEN appears in both.

### Phase field missing from TrainPosition
**Source:** data-agent, chess-expert
`BlunderExplanation` accepts a `phase` prop but it's always `undefined`. Gemini doesn't know if the blunder is opening/middlegame/endgame.
**Fix:** Derive phase from `moveNumber` in `v2_train_now.ts` (`<= 15` = opening, `<= 35` = middlegame, else endgame). Include `phase` in the `TrainPosition` response.

### Source-differentiated SM-2 initial ease factors
**Source:** chess-expert
All positions start with ease factor 2.5 regardless of severity. A 3-pawn blunder should review much sooner than a repertoire refresh.
**Fix:** Set initial ease based on source + cpLoss when creating a new progress record: blunders > 2 pawns → 1.3, blunders 1–2 pawns → 1.8, deviations → 2.0, review → 2.5.

### N+1 DB queries in train-now endpoint
**Source:** data-agent
`game_positions` is queried individually per game (twice — for blunders and for fenCounts). With 200 games this is 400 extra DB round-trips per request.
**Fix:** Batch-load all `game_positions` for candidate game IDs upfront in a single query, index by `game_id` in a Map.

---

## 🟡 Training Methodology

### First-encounter teaching mode
**Source:** chess-expert, task #15
Positions appearing for the first time (`total_attempts === 0`) should be *taught* before *tested*. Cold-testing a fresh blunder causes frustration without building understanding.
**Implementation:**
- Backend: Add `firstEncounter: boolean` to `TrainPosition` (check progress table).
- Frontend: New `TeachingCard` state — shows board statically with "You played X, but Y was better" + AI explanation upfront. "Got it" button records grade 4, queues for testing next session.
- Limit 2 teaching cards per session max.

### Pattern clustering within sessions
**Source:** chess-expert, task #16
8 random unrelated positions teaches 8 isolated facts. Grouping by theme (back rank weakness, overloaded piece, etc.) teaches transferable patterns — this is the core of the Woodpecker Method.
**Implementation:**
- Option A (lightweight): After scoring, batch top ~20 FENs to Gemini for theme classification. Cache in a `position_concepts` table.
- Option B (heuristic): Classify by piece counts, king position, pawn structure.
- Session construction: Group candidates by concept, show a "Today's focus: [theme]" header per cluster.

### Phase-weighted scoring
**Source:** chess-expert, task #17
Opening blunders should score higher than endgame inaccuracies — the opening is where repertoire-specific knowledge matters most.
**Fix:** Multiply score by a phase multiplier: opening (move ≤ 15) → 1.5×, middlegame → 1.2×, endgame → 1.0×.

---

## 🟢 UI / Polish

### Drill sounds
**Source:** ui-agent
No audio feedback makes the drill loop feel unresponsive on mobile. Chess.com CDN sounds already used in v1.
**Fix:** Load move/capture/check/error sounds in a `useRef` on mount. Play on drop based on move type and correctness. Add error buzz paired with the shake animation.

### Smooth drilling → explanation board transition
**Source:** ui-agent
The board jumps from `max-h-[60vh]` to `max-h-[40vh]` when moving from drilling to explanation state — jarring on mobile.
**Fix:** Single board instance with `transition-all duration-300` on its size classes. Slide `BlunderExplanation` up from below with a transform animation.

### Skip Gemini call on first-try correct moves
**Source:** ui-agent
`BlunderExplanation` fires `POST /analyze/blunder` even when `wrongMove` is null (no mistake made). Wastes a Gemini call and adds latency for positions the user already knows.
**Fix:** Only call Gemini if `mistakes > 0` or `revealed === true`. On clean correct moves, show a brief "Well played" + Next button with no AI call.

### "Drill Again" on complete screen
**Source:** ui-agent
After finishing, the only exit is "Back to Home." Users want to immediately re-drill without extra navigation.
**Fix:** Add a primary "Drill Again" button that calls `loadSession()` and resets state. Keep "Back to Home" as secondary.

### Progress bar instead of dots
**Source:** ui-agent
Dots overflow with larger session sizes and don't convey session progress clearly.
**Fix:** Replace with a thin horizontal progress bar with colored segments: emerald (correct), amber (revealed), white/10 (remaining).

---

## Completed ✅
- SM-2 recording on drill results (#10)
- bestMove stored in analysis_json (#11)
- HomeScreen count breakdown (#12)
- Game context during drilling (#13)
- Session composition 60/20/20 (#14)
- Deviation evalDiff unit fix (#18)
- Full 6-part FEN returned to frontend
- Move comparison by from/to squares (checkmate fix)
- cpLoss display unit bug fixed
- Show answer plays move visually on board
