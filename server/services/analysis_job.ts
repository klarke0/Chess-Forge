import { Chess } from "chess.js";
import type { Database } from "bun:sqlite";
import database from "../db";
import { saveGameAnalysis } from "../routes/games";
import { NativeEngine, findStockfishBinary, type EngineEval } from "./engine_native";
import { getCachedEval, putCachedEval, type CachedEval, type EvalToCache } from "./position_cache";
import { ANALYSIS_DEPTH, ANALYSIS_MOVETIME_MS, ANALYSIS_VERSION } from "./analysis_config";
import { MATE_CP, computeCpLoss, gradeMove } from "../utils/grading";
import type { AnalysisMove } from "../utils/analysis";

/** The PGN can't be turned into a game (unparseable, illegal move). Not the engine's fault, not retryable. */
export class GameDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameDataError";
  }
}

/** The slice of NativeEngine the analysis needs. Tests pass stubs. */
export interface AnalysisEngine {
  evaluate(
    fen: string,
    depth: number,
    opts?: { movetimeMs?: number },
  ): Promise<EngineEval>;
}

export interface JobEngine extends AnalysisEngine {
  dispose(): void;
}

export interface EvalCache {
  get(fen: string, depth: number): CachedEval | null;
  put(fen: string, depth: number, value: EvalToCache): void;
}

export function dbEvalCache(db: Database = database): EvalCache {
  return {
    get: (fen, depth) => getCachedEval(fen, depth, db),
    put: (fen, depth, value) => putCachedEval(fen, depth, value, db),
  };
}

export interface AnalyzeOptions {
  depth?: number;
  movetimeMs?: number;
  /** Checked between positions; returning true abandons the game. */
  shouldStop?: () => boolean;
  /** Called with (plies completed, total plies) — once at 0, then after every ply. */
  onProgress?: (ply: number, plies: number) => void;
}

/** Engine score (side-to-move POV) -> centipawns from White's POV, mate clamped to +-MATE_CP. */
function toWhitePov(
  score: { cp: number | null; mate: number | null },
  sideToMove: "w" | "b",
): number {
  const sign = sideToMove === "w" ? 1 : -1;
  // mate > 0: the side to move mates. mate <= 0: it is (or is about to be) mated.
  if (score.mate !== null) return sign * (score.mate > 0 ? MATE_CP : -MATE_CP);
  return sign * (score.cp ?? 0);
}

/**
 * Analyse one game: evaluate the START position and the position after every
 * ply (cache first, engine second), then grade each move from the mover's
 * win% loss. Produces the unchanged `analysis_json` move shape.
 *
 * - `eval` is White's POV, mate clamped to +-2000, as in the browser scan.
 * - `bestMove` on move i is the engine's best move (UCI) for the position
 *   BEFORE move i, i.e. from the parent position's search — so the first move
 *   has one too, because the start position is evaluated rather than assumed.
 * - Terminal moves (mate / stalemate / draw) skip the engine: fixed eval,
 *   cpLoss 0, grade `best`, as before.
 * - Returns null if `shouldStop` fired: a stopped game saves nothing.
 * - Throws GameDataError for an unusable PGN before any engine call; engine
 *   errors propagate to the caller.
 */
export async function analyzeGame(
  pgn: string,
  engine: AnalysisEngine,
  cache: EvalCache,
  opts: AnalyzeOptions = {},
): Promise<AnalysisMove[] | null> {
  const depth = opts.depth ?? ANALYSIS_DEPTH;
  const movetimeMs = opts.movetimeMs ?? ANALYSIS_MOVETIME_MS;
  const stop = () => opts.shouldStop?.() === true;

  let moves;
  try {
    const parsed = new Chess();
    parsed.loadPgn(pgn);
    moves = parsed.history({ verbose: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new GameDataError(`invalid PGN: ${msg}`);
  }

  const plies = moves.length;
  opts.onProgress?.(0, plies);
  if (plies === 0) return [];

  const evalPosition = async (
    fen: string,
  ): Promise<{ cp: number | null; mate: number | null; bestMoveUci: string }> => {
    const hit = cache.get(fen, depth);
    if (hit) return hit;
    const res = await engine.evaluate(fen, depth, { movetimeMs });
    cache.put(fen, depth, { cp: res.cp, mate: res.mate, bestMoveUci: res.bestMoveUci });
    return res;
  };

  if (stop()) return null;
  const start = await evalPosition(moves[0].before);
  // The side to move at the start is the first mover, whichever colour that is.
  let prevEval = toWhitePov(start, moves[0].color);
  let prevBest = start.bestMoveUci;

  const replay = new Chess(moves[0].before);
  const out: AnalysisMove[] = [];

  for (let i = 0; i < plies; i++) {
    if (stop()) return null;
    const m = moves[i];
    const mover = m.color;
    replay.move(m.san);
    const fen = replay.fen();
    const playedUci = `${m.from}${m.to}${m.promotion ?? ""}`;
    const playedIsBest = prevBest !== "" && playedUci === prevBest;

    if (replay.isGameOver()) {
      const terminalEval = replay.isCheckmate() ? (mover === "w" ? MATE_CP : -MATE_CP) : 0;
      out.push({
        san: m.san,
        fen,
        eval: terminalEval,
        cpLoss: 0,
        grade: "best",
        bestMove: prevBest || undefined,
      });
      prevEval = terminalEval;
      prevBest = "";
      opts.onProgress?.(i + 1, plies);
      continue;
    }

    const score = await evalPosition(fen);
    const newEval = toWhitePov(score, replay.turn());
    const { grade } = gradeMove({ prevEvalWhite: prevEval, newEvalWhite: newEval, mover, playedIsBest });
    out.push({
      san: m.san,
      fen,
      eval: newEval,
      cpLoss: computeCpLoss(prevEval, newEval, mover),
      grade,
      bestMove: prevBest || undefined,
    });
    prevEval = newEval;
    prevBest = score.bestMoveUci;
    opts.onProgress?.(i + 1, plies);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queue runner
// ---------------------------------------------------------------------------

export interface AnalysisStatus {
  running: boolean;
  current: { gameId: number; white: string; black: string; ply: number; plies: number } | null;
  counts: { pending: number; done: number; failed: number; total: number };
  startedAt: string | null;
  etaSeconds: number | null;
  depth: number;
  version: number;
}

export interface StartResult {
  started: boolean;
  reason?: "already-running" | "no-engine" | "nothing-pending";
}

export interface AnalysisJobDeps {
  db?: Database;
  /** Builds the job's OWN engine, only when there is work; disposed when the run ends. */
  createEngine?: () => JobEngine;
  hasEngine?: () => boolean;
  /** Clock in ms since epoch. */
  now?: () => number;
  save?: typeof saveGameAnalysis;
  depth?: number;
  movetimeMs?: number;
  version?: number;
  log?: (message: string, err?: unknown) => void;
}

/** Games the queue may take: not marked failed, and no analysis or an older one. */
const SELECTABLE = `analysis_failed IS NULL AND (analysis_json IS NULL OR analysis_version IS NULL OR analysis_version < ?)`;
/** Never-analyzed first, then older analyses; newest game first within each. */
const QUEUE_ORDER = `ORDER BY (analysis_json IS NULL) DESC, date DESC, id DESC`;

/** Recent games averaged for the ETA. */
const ETA_WINDOW = 20;
/** Engine-failed games in a row before the run gives up rather than failing the library. */
const MAX_ENGINE_FAILURES_IN_A_ROW = 3;

/** The engine failed twice on the same game (once, then again after a restart). */
class EngineFailure extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "EngineFailure";
  }
}

/** Something about the run itself is broken (e.g. the engine won't spawn); no game is to blame. */
class RunAbort extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "RunAbort";
  }
}

interface QueuedGame {
  id: number;
  white: string | null;
  black: string | null;
  pgn: string | null;
}

/**
 * Analyses the game library in the background, one game at a time, with its own
 * low-priority Stockfish that exists only while there is work.
 *
 * Selection: games not marked failed whose analysis is missing or older than
 * the current version — never-analyzed first, then older analyses, each newest
 * first. Older analyses are overwritten in place. State lives in the DB, so a
 * restart just resumes.
 */
export class AnalysisJob {
  private readonly db: Database;
  private readonly cache: EvalCache;
  private readonly createEngine: () => JobEngine;
  private readonly hasEngine: () => boolean;
  private readonly now: () => number;
  private readonly save: typeof saveGameAnalysis;
  private readonly depth: number;
  private readonly movetimeMs: number;
  private readonly version: number;
  private readonly log: (message: string, err?: unknown) => void;

  private running = false;
  private stopRequested = false;
  private runPromise: Promise<void> | null = null;
  private engine: JobEngine | null = null;
  private current: NonNullable<AnalysisStatus["current"]> | null = null;
  private startedAt: number | null = null;
  private durations: number[] = [];

  constructor(deps: AnalysisJobDeps = {}) {
    this.db = deps.db ?? database;
    this.cache = dbEvalCache(this.db);
    this.createEngine = deps.createEngine ?? (() => new NativeEngine({ threads: 2, nice: 10 }));
    this.hasEngine = deps.hasEngine ?? (() => findStockfishBinary() !== null);
    this.now = deps.now ?? Date.now;
    this.save = deps.save ?? saveGameAnalysis;
    this.depth = deps.depth ?? ANALYSIS_DEPTH;
    this.movetimeMs = deps.movetimeMs ?? ANALYSIS_MOVETIME_MS;
    this.version = deps.version ?? ANALYSIS_VERSION;
    this.log =
      deps.log ??
      ((message, err) => (err === undefined ? console.log(message) : console.warn(message, err)));
  }

  /** Begin (or resume) the queue. Never throws; `started:false` says why nothing began. */
  start(opts: { maxGames?: number } = {}): StartResult {
    if (this.running) {
      // A stop that has not finished unwinding is cancelled by asking to start.
      if (this.stopRequested) {
        this.stopRequested = false;
        return { started: true };
      }
      return { started: false, reason: "already-running" };
    }
    if (!this.hasEngine()) return { started: false, reason: "no-engine" };
    if (this.counts().pending === 0) return { started: false, reason: "nothing-pending" };

    this.running = true;
    this.stopRequested = false;
    this.startedAt = this.now();
    this.runPromise = this.run(opts.maxGames);
    return { started: true };
  }

  /** Ask the run to stop at the next position boundary. The interrupted game saves nothing. */
  stop(): void {
    if (this.running) this.stopRequested = true;
  }

  /** Resolves when the current run (if any) has fully wound down. */
  idle(): Promise<void> {
    return this.runPromise ?? Promise.resolve();
  }

  /** Clear every `analysis_failed` mark so those games are queued again. Returns how many. */
  retryFailed(): number {
    const res = this.db
      .query(`UPDATE games SET analysis_failed = NULL WHERE analysis_failed IS NOT NULL`)
      .run();
    return Number(res.changes);
  }

  /** Ids in the order the queue would take them (diagnostics / tests). */
  queue(limit = 25): number[] {
    const rows = this.db
      .query(
        `SELECT id FROM games WHERE ${SELECTABLE} ${QUEUE_ORDER} LIMIT ?`,
      )
      .all(this.version, limit) as { id: number }[];
    return rows.map((r) => r.id);
  }

  status(): AnalysisStatus {
    const counts = this.counts();
    return {
      running: this.running,
      current: this.current ? { ...this.current } : null,
      counts,
      startedAt: this.startedAt === null ? null : new Date(this.startedAt).toISOString(),
      etaSeconds: this.eta(counts.pending),
      depth: this.depth,
      version: this.version,
    };
  }

  // -- internals ------------------------------------------------------------

  private counts(): AnalysisStatus["counts"] {
    const row = this.db
      .query(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN analysis_failed IS NOT NULL THEN 1 ELSE 0 END), 0) AS failed,
           COALESCE(SUM(CASE WHEN ${SELECTABLE} THEN 1 ELSE 0 END), 0) AS pending
         FROM games`,
      )
      .get(this.version) as { total: number; failed: number; pending: number };
    return {
      pending: row.pending,
      done: row.total - row.failed - row.pending,
      failed: row.failed,
      total: row.total,
    };
  }

  private eta(pending: number): number | null {
    if (!this.running || pending === 0 || this.durations.length === 0) return null;
    const avg = this.durations.reduce((a, b) => a + b, 0) / this.durations.length;
    return Math.round(avg * pending);
  }

  private nextGame(): QueuedGame | null {
    const row = this.db
      .query(
        `SELECT id, white_username AS white, black_username AS black, pgn
         FROM games WHERE ${SELECTABLE} ${QUEUE_ORDER} LIMIT 1`,
      )
      .get(this.version) as QueuedGame | null;
    return row ?? null;
  }

  private async run(maxGames?: number): Promise<void> {
    let processed = 0;
    let engineFailuresInARow = 0;
    try {
      while (!this.stopRequested && (maxGames === undefined || processed < maxGames)) {
        const game = this.nextGame();
        if (!game) break;
        processed++;
        this.current = {
          gameId: game.id,
          white: game.white ?? "",
          black: game.black ?? "",
          ply: 0,
          plies: 0,
        };
        const t0 = this.now();
        try {
          const moves = await this.analyzeWithRetry(game);
          if (moves === null) {
            // Stopped mid-game: nothing saved, and if the stop was cancelled the
            // same game is simply picked up again.
            processed--;
            continue;
          }
          this.save(game.id, moves, { version: this.version, depth: this.depth }, this.db);
          this.recordDuration((this.now() - t0) / 1000);
          engineFailuresInARow = 0;
        } catch (e) {
          if (e instanceof RunAbort) {
            this.log("[analysis] run aborted: could not start the engine", e);
            break;
          }
          this.markFailed(game.id, failureReason(e));
          this.log(`[analysis] game ${game.id} failed: ${failureReason(e)}`);
          engineFailuresInARow = e instanceof EngineFailure ? engineFailuresInARow + 1 : 0;
          if (engineFailuresInARow >= MAX_ENGINE_FAILURES_IN_A_ROW) {
            this.log(
              `[analysis] ${MAX_ENGINE_FAILURES_IN_A_ROW} games in a row failed on the engine; stopping the run`,
            );
            break;
          }
        }
      }
    } catch (e) {
      this.log("[analysis] run crashed", e);
    } finally {
      // Never hold the engine when idle.
      this.dropEngine();
      this.running = false;
      this.stopRequested = false;
      this.current = null;
      this.startedAt = null;
    }
  }

  /** One attempt, then (on an engine error) one restart + one more attempt. */
  private async analyzeWithRetry(game: QueuedGame): Promise<AnalysisMove[] | null> {
    if (!game.pgn) throw new GameDataError("invalid PGN: game has no PGN");
    for (let attempt = 1; ; attempt++) {
      let engine: JobEngine;
      try {
        engine = this.ensureEngine();
      } catch (e) {
        throw new RunAbort(e);
      }
      try {
        return await analyzeGame(game.pgn, engine, this.cache, {
          depth: this.depth,
          movetimeMs: this.movetimeMs,
          shouldStop: () => this.stopRequested,
          onProgress: (ply, plies) => {
            if (this.current) {
              this.current.ply = ply;
              this.current.plies = plies;
            }
          },
        });
      } catch (e) {
        if (e instanceof GameDataError) throw e;
        this.dropEngine();
        if (this.stopRequested) return null;
        if (attempt >= 2) throw new EngineFailure(e);
        this.log(`[analysis] engine error on game ${game.id}; restarting it once`, e);
      }
    }
  }

  private ensureEngine(): JobEngine {
    if (!this.engine) this.engine = this.createEngine();
    return this.engine;
  }

  private dropEngine(): void {
    const engine = this.engine;
    this.engine = null;
    if (!engine) return;
    try {
      engine.dispose();
    } catch {
      /* already dead */
    }
  }

  private markFailed(gameId: number, reason: string): void {
    this.db.query(`UPDATE games SET analysis_failed = ? WHERE id = ?`).run(reason, gameId);
  }

  private recordDuration(seconds: number): void {
    this.durations.push(seconds);
    if (this.durations.length > ETA_WINDOW) this.durations.shift();
  }
}

function failureReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const prefix = e instanceof EngineFailure ? "engine error: " : "";
  return (prefix + msg).replace(/\s+/g, " ").trim().slice(0, 200);
}

// ---------------------------------------------------------------------------
// Process-wide instance (routes + triggers)
// ---------------------------------------------------------------------------

let shared: AnalysisJob | null = null;

export function getAnalysisJob(): AnalysisJob {
  if (!shared) shared = new AnalysisJob();
  return shared;
}

/**
 * Best-effort trigger (startup catch-up, after a sync). Never throws: an
 * analysis problem must never break the request that happened to kick it.
 */
export function kickAnalysis(reason: string): void {
  try {
    const result = getAnalysisJob().start();
    console.log(`[analysis] kick (${reason}):`, result.started ? "started" : `not started (${result.reason})`);
  } catch (e) {
    console.warn(`[analysis] kick (${reason}) failed:`, e);
  }
}
