# V2 Roadmap

All work is exclusively focused on the v2 interface (`src/v2/`, `server/routes/v2_*.ts`). V1 (`App.tsx`) is frozen.

---

## 🔴 Active / Known Bugs

### Drill pool thin — `bestMove` missing from existing games

All 401 games analyzed before March 2026 have no `bestMove` in `analysis_json`. The blunder-first fallback (`m.bestMove`) is therefore empty for all existing games, meaning only repertoire-matching blunders appear in the pool. Fixed going forward in `background_analysis.ts`, but existing games need re-analysis.
**Fix:** Add a "Re-analyze recent games" option to the UI, or provide a backfill script that clears `analysis_json` for recent games and lets background analysis re-run them.

### Drill pool only shows 3 positions (under investigation)

The API returns 12 positions but the UI shows only 3. Likely related to `firstEncounter` teaching mode interaction or session state bug in `TrainNowScreen.tsx`. Under active investigation.

---

## 🟡 Training Methodology

### Pattern clustering within sessions

8 random unrelated positions teaches 8 isolated facts. Grouping by theme (back rank weakness, overloaded piece, etc.) teaches transferable patterns — this is the core of the Woodpecker Method.
**Implementation:**

- Option A (lightweight): After scoring, batch top ~20 FENs to Gemini for theme classification. Cache in a `position_concepts` table.
- Option B (heuristic): Classify by piece counts, king position, pawn structure.
- Session construction: Group candidates by concept, show a "Today's focus: [theme]" header per cluster.

---

## Completed ✅

- SM-2 recording on drill results
- bestMove captured in `background_analysis.ts` going forward
- HomeScreen count breakdown
- Game context during drilling
- Session composition (blunders first, then deviations, then review)
- Deviation evalDiff unit fix
- Full 6-part FEN returned to frontend
- Move comparison by from/to squares (checkmate fix)
- cpLoss display unit bug fixed
- Show answer plays move visually on board
- Opponent deviations filtered from drill pool (`d.notes = 'player'`)
- Backfill deviations endpoint (`POST /api/v2/backfill-deviations`)
- cpLoss proxy for review positions (`(1 - accuracy) * 3`)
- Phase field in TrainPosition (derived from moveNumber)
- Phase-weighted scoring (1.5× opening, 1.2× middlegame, 1.0× endgame)
- Skip Gemini on first-try correct moves
- "Drill Again" button on complete screen
- Progress bar replacing dot indicators
- Smooth board transition (drilling → explanation)
- First-encounter teaching mode (max 2 per session)
- Source-differentiated SM-2 initial ease factors
- N+1 DB query fix (batch game_positions load)
- SM-2 interval cap (ease_factor ≤ 2.5, interval_days ≤ 180)
- Repaired 40 runaway SM-2 DB rows (max_next_review was year 2119)
- Blunder-first drill pool: repertoire move takes priority, falls back to engine bestMove for non-repertoire positions
