import { describe, expect, test } from "bun:test";
import { AnalysisJob } from "../services/analysis_job";
import { ANALYSIS_DEPTH, ANALYSIS_VERSION } from "../services/analysis_config";
import {
  analysisRetryFailedRoute,
  analysisStartRoute,
  analysisStatusRoute,
  analysisStopRoute,
} from "../routes/v2_analysis";
import { PGN_A, insertGame, makeStubEngine, memoryDb } from "./support/analysis_stubs";

function setup(hasEngine = true) {
  const db = memoryDb();
  const job = new AnalysisJob({
    db,
    hasEngine: () => hasEngine,
    createEngine: () => makeStubEngine({}),
    log: () => {},
  });
  return { db, job };
}

describe("GET /api/v2/analysis/status", () => {
  test("200 with the ok() envelope and the exact payload keys", async () => {
    const { db, job } = setup();
    insertGame(db, { pgn: PGN_A });
    const res = analysisStatusRoute(job);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(
      ["counts", "current", "depth", "etaSeconds", "running", "startedAt", "version"].sort(),
    );
    expect(body.data).toEqual({
      running: false,
      current: null,
      counts: { pending: 1, done: 0, failed: 0, total: 1 },
      startedAt: null,
      etaSeconds: null,
      depth: ANALYSIS_DEPTH,
      version: ANALYSIS_VERSION,
    });
  });

  test("still works when Stockfish is not installed", async () => {
    const { job } = setup(false);
    const res = analysisStatusRoute(job);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe("POST /api/v2/analysis/start", () => {
  test("202 { ok: true } and the job runs", async () => {
    const { db, job } = setup();
    insertGame(db, { pgn: PGN_A });
    const res = analysisStartRoute(job);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, data: { started: true } });
    await job.idle();
    expect(job.status().counts.done).toBe(1);
  });

  test("starting an already-running job is still a 202, with started:false", async () => {
    const { db, job } = setup();
    insertGame(db, { pgn: PGN_A });
    analysisStartRoute(job);
    const res = analysisStartRoute(job);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, data: { started: false, reason: "already-running" } });
    await job.idle();
  });

  test("nothing to do is a 202 with started:false (and no engine is spawned)", async () => {
    const { job } = setup();
    const res = analysisStartRoute(job);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, data: { started: false, reason: "nothing-pending" } });
  });

  test("503 { ok: false, error } when Stockfish is not installed", async () => {
    const { db, job } = setup(false);
    insertGame(db, { pgn: PGN_A });
    const res = analysisStartRoute(job);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "Stockfish not installed" });
  });
});

describe("POST /api/v2/analysis/stop", () => {
  test("200 { ok: true } and the run ends without saving the interrupted game", async () => {
    const db = memoryDb();
    const id = insertGame(db, { pgn: PGN_A });
    let route: () => Response = () => new Response();
    const job = new AnalysisJob({
      db,
      hasEngine: () => true,
      createEngine: () =>
        makeStubEngine({
          onCall: (n) => {
            if (n === 2) route();
          },
        }),
      log: () => {},
    });
    let stopRes: Response | null = null;
    route = () => (stopRes = analysisStopRoute(job));
    analysisStartRoute(job);
    await job.idle();
    expect(stopRes!.status).toBe(200);
    expect(((await stopRes!.json()) as { ok: boolean }).ok).toBe(true);
    const r = db.query("SELECT analysis_json FROM games WHERE id = ?").get(id) as { analysis_json: string | null };
    expect(r.analysis_json).toBeNull();
  });

  test("stopping an idle job is fine", async () => {
    const { job } = setup();
    const res = analysisStopRoute(job);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe("POST /api/v2/analysis/retry-failed", () => {
  test("clears the failed marks, reports how many, and restarts the queue", async () => {
    const { db, job } = setup();
    const id = insertGame(db, { pgn: PGN_A, analysisFailed: "engine error: boom" });
    expect(job.status().counts).toMatchObject({ failed: 1, pending: 0 });
    const res = analysisRetryFailedRoute(job);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { cleared: 1, started: true } });
    await job.idle();
    const r = db.query("SELECT analysis_failed, analysis_version FROM games WHERE id = ?").get(id) as {
      analysis_failed: string | null;
      analysis_version: number | null;
    };
    expect(r.analysis_failed).toBeNull();
    expect(r.analysis_version).toBe(ANALYSIS_VERSION);
  });

  test("with no failures it clears nothing", async () => {
    const { job } = setup();
    const res = analysisRetryFailedRoute(job);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { cleared: 0, started: false } });
  });

  test("without Stockfish the marks are still cleared, but nothing starts", async () => {
    const { db, job } = setup(false);
    insertGame(db, { pgn: PGN_A, analysisFailed: "x" });
    const res = analysisRetryFailedRoute(job);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { cleared: 1, started: false } });
  });
});
