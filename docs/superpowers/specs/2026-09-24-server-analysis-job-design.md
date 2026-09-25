# Server-side game analysis job + honest grading — design & plan

Status: approved in chat by Kevin ("start server side analysis job") · Date: 2026-09-24

## Why
Game analysis currently runs in the BROWSER (WASM Stockfish, `src/services/background_analysis.ts`), restarts on every page load (incl. the phone), and the scan never finishes: 614 of 1,325 games have never been analyzed and 401 analyzed games lack `bestMove`. It analyses at **depth 12**, evaluating each position once.

Kevin's suspicion that "a lot of moves are best" is correct, from reading the code (`getGrade`, `winPct = 1/(1+exp(-cp/300))`):
- `best` = any move losing <= 1.5% winning chances (~18 cp in an equal position), NOT "the engine's top move"; plus an override that also grants `best` when the played move equals the depth-12 top move.
- Every band is looser than chess.com's (mistake starts at 12.5% loss; chess.com 10%).
- The first move is graded against an invented start eval of +0.20; every other eval is a single noisy depth-12 search.

## Decisions
1. **Server-side job** using native Stockfish (`server/services/engine_native.ts`), one game at a time, low priority (`nice`), `Threads 2`, **depth 14 with a per-position time cap (3 s, `go depth 14 movetime 3000`)**. Measured on this machine: depth 12 ≈ 0.22 s/position, depth 14 ≈ 0.43 s, depth 16 ≈ 4.9 s (too slow). ≈ 30 s/game → ~8–11 h for the whole backlog, in the background, newest first.
2. **Position eval cache** (`position_evals` table: normalized FEN, depth, cp, mate, best UCI). Repertoire openings repeat across hundreds of games, so a large share of evaluations are cache hits; it also makes re-grading and re-runs cheap. The START position is evaluated (and cached) instead of the magic +0.20.
3. **Honest grading**, one pure module (`server/utils/grading.ts`, mirrored in `src/utils/grading.ts` with a parity test — the repo already mirrors `normalizeFen`):
   - win% = `50 + 50*(2/(1+exp(-0.00368208*cp)) - 1)` (lichess curve), mate -> 100/0; loss = mover's win% before minus after (percentage points).
   - `best` iff (the played move IS the engine's top move AND the measured loss <= 5 pp — if the child search shows a bigger drop the two searches disagree and the loss bands decide) OR loss <= 0.2 pp; `excellent` <= 2; `good` <= 5; `inaccuracy` <= 10; `mistake` <= 20; `blunder` > 20. Bands are exported constants so they can be tuned; re-grading from stored evals needs no engine.
   - Terminal moves (mate/stalemate) keep their existing fixed handling.
4. **`analysis_json` shape is unchanged** (`{san, fen, eval, cpLoss, grade, bestMove}`), so `v2_train_now`, insights and the review UI keep working. New columns on `games`: `analysis_version INTEGER` (NULL = legacy browser depth-12; new = 2), `analysis_depth INTEGER`, `analysis_failed TEXT` (reason; job skips these), `analysis_updated_at TEXT`. Idempotent `ALTER TABLE ... ADD COLUMN` migrations in `server/db.ts`.
5. **Queue selection** (`ANALYSIS_VERSION = 2`): games with `analysis_failed IS NULL` AND (`analysis_json IS NULL` OR `analysis_version IS NULL OR analysis_version < 2`), ordered never-analyzed first, then newest `date` first. Older analyses are OVERWRITTEN in place (no window where a game has no analysis), which also fixes the 401 games missing `bestMove` — `refresh-analysis` becomes unnecessary (leave it, note deprecated).
6. **Saving** goes through one shared function `saveGameAnalysis(gameId, analysis, meta)` extracted from the `saveAnalysis` route body (game_shape, termination, deviations recompute all preserved); the route calls it too.
7. **Triggers**: startup catch-up (30 s after boot), after a successful `games/sync` that inserted games, and manual. **API contract** (used by the client; all responses use the repo's `ok()`/`err()` envelope from `server/utils/response.ts`, i.e. `{ ok: true, data: <payload> }`, and the client's `request<T>` unwraps it):
   - `GET  /api/v2/analysis/status` -> `{ running, current: {gameId, white, black, ply, plies} | null, counts: {pending, done, failed, total}, startedAt, etaSeconds | null, depth, version }`
   - `POST /api/v2/analysis/start` (202 `{ok:true}`), `POST /api/v2/analysis/stop` (`{ok:true}`), `POST /api/v2/analysis/retry-failed`.
8. **Client**: delete the browser scan triggers (AppV2, HomeScreen, GamesTab, Header, App.tsx call `BackgroundAnalysis`); the Games tab shows server progress ("Analyzing on server 132/1,015 · ~6 h left") with Start/Stop; poll `status` only while the Games tab is visible (every 5 s while running, otherwise once on mount). Keep `useGameReview`'s live analysis as a fallback for a game the server hasn't reached yet, but grade it with the shared client grading module.
9. **Drill pool safety** (CLAUDE.md "Drill pool freshness"): session size 12 and the interval cap 30 stay; the pool query reads `analysis_json` for the last 365 days (LIMIT 500 games) so new analyses simply add/replace candidates; SM-2 progress rows are untouched and remain schedule-gated. Grades shift (fewer false `best`, more real mistakes) — expected.
10. **Failure handling**: a game whose analysis throws is marked `analysis_failed` with the reason and skipped; `retry-failed` clears the marks. An engine crash restarts the engine once and retries the current game once.

## Tasks (server first, then client; each: tests first, explicit-path commits)
1. **Engine options + position cache**: `NativeEngine` accepts `{threads, hashMb, nice, movetimeMs}`; `position_evals` table + `getCachedEval/putCachedEval` (in-memory DB tests).
2. **Grading module** (server + client mirror + parity test with a table of cp pairs and every band edge).
3. **Analysis service**: `server/services/analysis_job.ts` (`analyzeGame(pgn, engine, cache)` with an injectable engine; queue runner with state, stop, failure marking, resume), DB migrations, `saveGameAnalysis` extraction, routes + wiring in `server/index.ts` (startup catch-up, post-sync kick), tests with a stub engine.
4. **Client**: remove the browser scan, add server status polling + Start/Stop in `GamesTab`, keep review fallback using the shared grading module.
5. **Verify + rollout**: run the job on a DB COPY against 3 real games and compare with stored analysis; build; restart per the "always restart" rule; start the job on the live DB; update CLAUDE.md (analysis checklist, `analysis_version`, deprecated `refresh-analysis`).

## Risks
- CPU contention with the live app and other processes: mitigated by `nice`, 2 threads, and stop/pause endpoints.
- Grade distribution changes visibly (by design) — the game review summary will show fewer `best`.
- Very long runtime: progress is visible and the job is resumable; newest games finish first.
