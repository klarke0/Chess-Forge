import { ok, err } from "../utils/response";
import { getAnalysisJob, type AnalysisJob } from "../services/analysis_job";

/** GET /api/v2/analysis/status — always available, even without Stockfish. */
export function analysisStatusRoute(job: AnalysisJob = getAnalysisJob()): Response {
  return ok(job.status());
}

/**
 * POST /api/v2/analysis/start — begin or resume the queue. 202 whether it just
 * started, was already running, or had nothing to do (`data.started` says
 * which); 503 only when Stockfish isn't installed.
 */
export function analysisStartRoute(job: AnalysisJob = getAnalysisJob()): Response {
  const r = job.start();
  if (r.reason === "no-engine") return err("Stockfish not installed", 503);
  return ok(r.reason ? { started: r.started, reason: r.reason } : { started: r.started }, {
    status: 202,
  });
}

/** POST /api/v2/analysis/stop — takes effect at the next position boundary. */
export function analysisStopRoute(job: AnalysisJob = getAnalysisJob()): Response {
  const wasRunning = job.status().running;
  job.stop();
  return ok({ stopping: wasRunning });
}

/**
 * POST /api/v2/analysis/retry-failed — clear every failure mark, then kick the
 * queue (best effort: with no Stockfish the marks are still cleared).
 */
export function analysisRetryFailedRoute(job: AnalysisJob = getAnalysisJob()): Response {
  const cleared = job.retryFailed();
  const started = cleared > 0 && job.start().started;
  return ok({ cleared, started });
}
