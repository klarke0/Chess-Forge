# Coach: engine-grounded explanations — design

Status: draft for review · Date: 2026-09-24 · Branch: v2
Source: `docs/audit-2026-09/coach-eval.md` (findings F1–F11), merged in `docs/audit-2026-09/SUMMARY.md` (#1, #9).

## Problem

`POST /api/analyze/blunder` (`explainBlunder` in `server/routes/analyze.ts`) asks Gemini to analyze a position it has no engine data for. In the audit, 15 of 32 real outputs (47%) contained a verifiably false claim (invented attacks, undefended pieces, mate threats), and only 3 of 32 explained the *why*. Causes:

- The "opponent's best refutation" is a heuristic (first capture of the moved piece, else 5 arbitrary legal moves), labelled ground truth.
- The model gets `cpLoss` only — no evals, no best line, no stalemate/mate flags. Stored `cpLoss` is also noisy (21/32 differ from Stockfish depth 14 by >1 pawn).
- Prose and steps are two independent Gemini calls, so they can contradict (S12) or drop the refutation beat (S19, T5).
- Errors return HTTP 200 `"Coach unavailable"`, which the UI renders as coach text; malformed input gives a bare 500; no timeouts; no caching; the UI effect has no abort.

## Goal and success criteria

The model **narrates verified facts; it does not analyze.** Success, measured by re-running the audit's 32 organic + 5 tricky positions:

1. Zero false attack/defend/hang/capture claims that survive to the response (verifier + template fallback).
2. Every move in `steps` is legal and chosen by the server, never the model. Beat count/roles always complete.
3. Close calls (loss < 0.3 pawn), same-move, illegal-move and stalemate/mate cases are handled correctly (S23, T1, T2, T5).
4. Gemini/engine failures surface as errors the UI already handles ("Engine recommends X"), never as coach text.
5. Cold latency stays acceptable (target ≤ ~6s, measured, not assumed); warm calls come from cache.

Non-goals: cleaning stored `cpLoss`/`bestMove` in `games.analysis_json` (separate item, SUMMARY #4 — the coach no longer depends on them); changing the streaming `analyzePosition` path; coach UI redesign; Learn-mode coaching.

## Architecture

New module `server/services/coach_facts.ts` (pure logic + one engine dependency), used by a slimmed `explainBlunder`. Keeps `analyze.ts` from growing.

```
request ─► validate ─► cache lookup ─► buildFacts(engine + chess.js)
                                          │
                              severity / short-circuit cases
                                          │
                        one Gemini call (JSON schema, temp 0.2)
                                          │
                      verifyClaims (chess.js) ─fail─► retry once ─fail─► template from facts
                                          │
                        assemble steps (server-fixed SANs) ─► cache write ─► response
```

### 1. Request validation
`fen` must parse in chess.js; `correctMove` must be legal from `fen`; `wrongMove` (nullable) must be legal if present. Otherwise **400** with a message (was: bare 500). `wrongMove == correctMove` → short-circuit (see 4).

### 2. Facts (`buildFacts`)
Uses a lazily created shared `NativeEngine` (`server/services/engine_native.ts`; already used by audit sweep/punish harvest; requests are serialized internally). Depth 14, mover's POV:

| Fact | Source |
|---|---|
| `evalBefore`, `evalAfterWrong`, `evalAfterBest` (cp or mate-in-n) | 3× `engine.evaluate` (two are on child positions, sign-corrected) |
| `lossPawns` = best − wrong | derived; **replaces the stored `cpLoss`** in the prompt |
| `severity` | `equal` < 0.3 pawn · `inaccuracy` 0.3–0.7 · `mistake` 0.7–1.5 · `blunder` ≥ 1.5 · `decisive` when the played move allows a forced mate or flips a won position to lost (initial values from the audit; tuned after the fixture rerun) |
| `bestPvSan` (first ≤4 plies) | engine PV → SAN via chess.js |
| `replySan`, `refutationPvSan` | engine best reply after `wrongMove` + PV |
| per-move facts for wrong/best/reply: landing square, attackers, defenders, captured piece, gives check/mate | chess.js (extends the existing `computeMoveFacts`) |
| flags: `isStalemate`, `isCheckmate`, `wrongEqualsBest`, `mateFor` | chess.js + engine |
| masters top moves (optional) | existing `fetchMastersData`, now under the same 4s cap, in parallel with the engine |

If the engine binary is missing or errors: respond **503** `{ error }` (UI falls back to "Engine recommends X"). No silent degradation to the old ungrounded prompt.

### 3. One Gemini call
Replaces the prose and steps calls. `responseMimeType: application/json` with a `responseSchema`:
`{ concept, analysis, captions: { wrong, reply?, best, why } }`. Temperature 0.2. The prompt is the audit's proposed prompt (coach-eval.md, "Proposed prompt"): facts block as ground truth, rules "name only pieces/squares in PIECES or FACTS", "no attacks/defends/hangs/wins/forks/pins/threatens-mate unless FACTS states it", ≤55 words analysis, ≤14 words per caption. **The server builds `steps`**: `playMove(wrong, red)`, `playMove(replySan, red)` (omitted when `equal`), `playMove(best, green)`, `highlight(...)` on the best move's key squares — the model supplies only the caption text. This removes illegal/arbitrary beats and prose↔steps contradiction. Response shape stays `{ concept, analysis, steps }`, so `BlunderExplanation` and `InteractiveCoach` need no shape change.

### 4. Short-circuits (no Gemini call)
- `wrongEqualsBest` → deterministic "that was the best move" card.
- `severity == equal` (loss < 0.3) → prompt is switched to "both fine; one practical reason to prefer {best}", no refutation beat. (Still one Gemini call; it just cannot invent a tactic.)
- Stalemate/mate flags are injected into FACTS so T1/S23-style cases narrate correctly.

### 5. Verifier + template fallback (`verifyClaims`)
After generation, check with chess.js: (a) every SAN token in `analysis`/captions is legal from the appropriate position or is one of the fixed moves; (b) claims of the form "<piece> on <sq> attacks/defends/hangs <piece/sq>" match `attackers()`; (c) no `+`/`#` unless FACTS says check/mate; (d) no piece/square absent from PIECES. Fail → regenerate once with the failed claims listed → fail again → **template fallback** built purely from FACTS (e.g. "{best} {does X per facts}. {wrong} allows {reply}, which {loses material per facts}."). Decision confirmed in review: the template is shown (correct and still useful), not the bare "Engine recommends X".

### 6. Errors, timeouts, cancellation
- Gemini and Lichess fetches get `AbortSignal.timeout` (~6s / 4s). Missing key / Gemini failure → non-2xx (502/503), never HTTP 200 + "Coach unavailable" string.
- `BlunderExplanation.tsx`: add an abort/stale-request guard to the fetch effect so a slow response for the previous FEN cannot overwrite the current card. UI error path (existing) handles non-2xx.
- Client timeout in `src/services/api.ts` is 10s for all requests. Keep it; the server budget must fit under it (see Latency).

### 6b. Latency budget
Three depth-14 evals + Gemini + optional masters. Masters run in parallel with the evals. **Measured (2026-09-24, this machine):** engine warm-up about 1.1s; depth 14 about 0.2-0.8s per position. Total server budget is 9s under the client's 10s timeout. End-to-end on the 35-case fixture run (cold, real Gemini, 2 attempts on most cases because the verifier rejected first tries): median 3001ms, max 7486ms. Warm hits are cache reads.

### 7. Cache
New table `coach_cache(fen_norm, wrong, correct, prompt_version, response_json, created_at, PRIMARY KEY(fen_norm, wrong, correct, prompt_version))` created in `runMigrations` like existing tables. `prompt_version` is a constant in `coach_facts.ts` bumped on any prompt/model/threshold change — that is the "clear stale outputs" mechanism required by CLAUDE.md (old versions simply stop matching). Errors and template-fallbacks are cached only for the template case (deterministic); Gemini/engine errors are never cached.

## Testing

- **Unit (bun test, no network):** `buildFacts` on fixed FENs with a stubbed engine (stalemate T1, both-mate S23, equal S19/S30, same-move T2, illegal T5); `verifyClaims` accepts true claims and rejects the audit's known false ones (S02 "c3 hangs", S28 "e6 undefended", S09 "Ne4 attacks the queen"); step assembly always yields legal, complete beats; cache key/versioning.
- **Fixture rerun:** the audit's `samples.json` (37 positions) through the new endpoint against the DB copy; grade with the same chess.js checks as the audit. Report pass rates against the success criteria above and record before/after in `docs/audit-2026-09/coach-eval.md`.
- **Spend cap:** ~one Gemini call per uncached position now (retries add ≤1). Fixture rerun budget: ≤ ~80 calls, counted at the call site, and hard-stopped by a counter (the audit overspent because each endpoint call was 2–3 Gemini calls).
- `npm run typecheck:server`, `./dev.sh build` (exit 0), lint clean on touched files.

## Rollout (per CLAUDE.md "coach prompt or model" checklist)
1. Land behind the existing route path (`/api/analyze/blunder`, same response shape).
2. `./dev.sh build`, restart backend.
3. `curl` the endpoint with a known-bad FEN (e.g. audit T1/S02) to confirm the new behavior before debugging from screenshots (stale PWA).
4. Update CLAUDE.md (Gemini 2.5 Flash; coach cache now persisted in `coach_cache`, cleared by bumping `prompt_version`).

## Risks / open questions
- **Stockfish binary required on the server** (`brew install stockfish`; `findStockfishBinary()` checks fixed paths). Already a dependency of audit sweep/punish harvest; if absent the coach returns 503 rather than degrading.
- **Latency** (above) is the main unknown; measured first.
- **Verifier false rejects**: regex claim-parsing is conservative by design; a rejected-but-true claim costs one retry or the template, never a wrong explanation.
- **Thresholds** (0.3 equal cutoff; severity bands) are taken from the audit's proposal and may need tuning after the fixture rerun.
