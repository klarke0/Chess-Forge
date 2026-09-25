import { join } from "path";
import {
  listRepertoires,
  getPositions,
  getChapters,
  importPgn,
  updateChapterLearnRuns,
} from "./routes/repertoire";
import {
  getProgress,
  recordAttempt,
  getWeakPositions,
  getDuePositions,
  getProgressStats,
  getWeakestPosition,
} from "./routes/progress";
import { createSession, endSession, listSessions } from "./routes/sessions";
import {
  syncGames,
  getGameStats,
  getLabStats,
  uploadGames,
  listGames,
  getGame,
  saveAnalysis,
  getBlunders,
  backfillDeviations,
} from "./routes/games";
import {
  analyzePosition,
  explainBlunder,
} from "./routes/analyze";
import { getPatternReport, runPatternAnalysis } from "./routes/patterns";
import { trainNow } from "./routes/v2_train_now";
import { insightsVelocity, gameTypeStats, insightsDashboard, insightsWeeklyAccuracy, topOpponents } from "./routes/v2_insights";
import { dismissPosition } from "./routes/v2_dismiss";
import { refreshAnalysis } from "./routes/v2_refresh_analysis";
import { challengeMove } from "./routes/v2_challenge";
import { deleteRepertoireProgress } from "./routes/v2_repertoire_progress";
import {
  auditSweepRoute, auditStatusRoute, auditTiebreakRoute, auditReportRoute,
} from "./routes/v2_audit";
import {
  punishHarvestRoute, punishStatusRoute, punishListRoute,
} from "./routes/v2_punish";
import { learnNextRoute, learnCompleteRoute } from "./routes/v2_learn";
import {
  analysisStatusRoute, analysisStartRoute, analysisStopRoute, analysisRetryFailedRoute,
} from "./routes/v2_analysis";
import { warmCoachEngine } from "./services/coach_engine";
import { kickAnalysis } from "./services/analysis_job";

const PORT = Number(process.env.PORT) || 3001;
const DIST_PATH = join(import.meta.dir, "../dist");
const REMOTE_PASSWORD = process.env.REMOTE_PASSWORD || "";

function corsHeaders(): HeadersInit {
  const origin = process.env.CORS_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function addCors(response: Response): Response {
  const headers = corsHeaders();
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

function checkAuth(req: Request): boolean {
  if (!REMOTE_PASSWORD) return true;

  // 1. Determine if the request is local
  const host = req.headers.get("host") || "";
  const forwarded = req.headers.get("x-forwarded-for");
  const forwardedHost = req.headers.get("x-forwarded-host");

  // If there are no forwarding headers AND the host is local, skip auth
  const isLocalHost =
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("::1");
  const isPrivateIp = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(
    host,
  );

  if (!forwarded && !forwardedHost && (isLocalHost || isPrivateIp)) {
    return true;
  }

  // 2. Otherwise, require Basic Auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;

  try {
    const [type, credentials] = authHeader.split(" ");
    if (type !== "Basic") return false;

    const decoded = atob(credentials);
    const [_user, pass] = decoded.split(":");
    return pass === REMOTE_PASSWORD;
  } catch {
    return false;
  }
}

function parseId(segment: string): number {
  const n = parseInt(segment, 10);
  if (isNaN(n)) return -1;
  return n;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    console.log(`[${new Date().toISOString()}] ${method} ${path}`);

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Auth check for both API and Static files (if password is set)
    if (REMOTE_PASSWORD && !checkAuth(req)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Chess Forge"',
          ...corsHeaders(),
        },
      });
    }

    // Serve static files for non-API routes
    if (!path.startsWith("/api")) {
      const filePath = join(DIST_PATH, path === "/" ? "index.html" : path);
      const file = Bun.file(filePath);

      if (await file.exists()) {
        return new Response(file);
      }

      // SPA fallback to index.html
      const indexFile = Bun.file(join(DIST_PATH, "index.html"));
      if (await indexFile.exists()) {
        return new Response(indexFile);
      }

      return new Response("Not found", { status: 404 });
    }

    // API Routes
    try {
      const response = await route(method, path, url, req);
      return addCors(response);
    } catch (err) {
      console.error("Server error:", err);
      return addCors(
        Response.json({ error: "Internal server error" }, { status: 500 }),
      );
    }
  },
});

warmCoachEngine();

// Startup catch-up for the game-analysis job: 30 s after boot, analyse whatever
// is still pending (a no-op when the queue is empty or Stockfish is missing).
// ANALYSIS_AUTOSTART=0 disables it (dev servers, smoke tests on a DB copy).
if (process.env.ANALYSIS_AUTOSTART !== "0") {
  setTimeout(() => kickAnalysis("startup"), 30_000).unref();
}

async function route(
  method: string,
  path: string,
  url: URL,
  req: Request,
): Promise<Response> {
  // Match routes using simple pattern matching
  const segments = path.split("/").filter(Boolean); // e.g. ["api", "repertoires", "1", "positions"]

  if (segments[0] !== "api") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // GET /api/repertoires
  if (
    method === "GET" &&
    segments[1] === "repertoires" &&
    segments.length === 2
  ) {
    return listRepertoires();
  }

  // GET /api/repertoires/:id/positions
  if (
    method === "GET" &&
    segments[1] === "repertoires" &&
    segments[3] === "positions" &&
    segments.length === 4
  ) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getPositions(id);
  }

  // GET /api/repertoires/:id/chapters
  if (
    method === "GET" &&
    segments[1] === "repertoires" &&
    segments[3] === "chapters" &&
    segments.length === 4
  ) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getChapters(id);
  }

  // POST /api/repertoires/import
  if (
    method === "POST" &&
    segments[1] === "repertoires" &&
    segments[2] === "import" &&
    segments.length === 3
  ) {
    return importPgn(req);
  }

  // PATCH /api/chapters/:id/learn_runs
  if (
    method === "PATCH" &&
    segments[1] === "chapters" &&
    segments[3] === "learn_runs" &&
    segments.length === 4
  ) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return updateChapterLearnRuns(req, id);
  }

  // GET /api/progress/:repertoireId/stats
  if (
    method === "GET" &&
    segments[1] === "progress" &&
    segments[3] === "stats" &&
    segments.length === 4
  ) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getProgressStats(id);
  }

  // GET /api/progress/:repertoireId
  if (method === "GET" && segments[1] === "progress" && segments.length === 3) {
    // Check for /weak or /due subpaths — handled below
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getProgress(id);
  }

  // GET /api/progress/:repertoireId/weakest
  if (
    method === "GET" &&
    segments[1] === "progress" &&
    segments[3] === "weakest" &&
    segments.length === 4
  ) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getWeakestPosition(id);
  }

  // GET /api/progress/:repertoireId/weak
  if (
    method === "GET" &&
    segments[1] === "progress" &&
    segments[3] === "weak" &&
    segments.length === 4
  ) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getWeakPositions(id);
  }

  // GET /api/progress/:repertoireId/due
  if (
    method === "GET" &&
    segments[1] === "progress" &&
    segments[3] === "due" &&
    segments.length === 4
  ) {
    if (segments[2] === "all") {
      return getDuePositions("all");
    }
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getDuePositions(id);
  }

  // POST /api/progress/record
  if (
    method === "POST" &&
    segments[1] === "progress" &&
    segments[2] === "record" &&
    segments.length === 3
  ) {
    return recordAttempt(req);
  }

  // POST /api/sessions
  if (
    method === "POST" &&
    segments[1] === "sessions" &&
    segments.length === 2
  ) {
    return createSession(req);
  }

  // PATCH /api/sessions/:id
  if (
    method === "PATCH" &&
    segments[1] === "sessions" &&
    segments.length === 3
  ) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return endSession(req, id);
  }

  // GET /api/sessions
  if (method === "GET" && segments[1] === "sessions" && segments.length === 2) {
    const repertoireId = url.searchParams.get("repertoireId");
    return listSessions(repertoireId ? parseInt(repertoireId, 10) : undefined);
  }

  // GET /api/games
  if (method === "GET" && segments[1] === "games" && segments.length === 2) {
    return listGames(req);
  }

  // GET /api/games/blunders
  if (
    method === "GET" &&
    segments[1] === "games" &&
    segments[2] === "blunders" &&
    segments.length === 3
  ) {
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    return getBlunders(limit);
  }

  // GET /api/games/:id
  if (method === "GET" && segments[1] === "games" && segments.length === 3) {
    return getGame(req);
  }

  // POST /api/games/clear-analysis
  if (
    method === "POST" &&
    segments[1] === "games" &&
    segments[2] === "clear-analysis" &&
    segments.length === 3
  ) {
    const { clearAllAnalysis } = await import("./routes/games");
    return clearAllAnalysis(req);
  }

  // POST /api/games/:id/analysis
  if (
    method === "POST" &&
    segments[1] === "games" &&
    segments[3] === "analysis"
  ) {
    return saveAnalysis(req);
  }

  // POST /api/games/sync
  if (method === "POST" && segments[1] === "games" && segments[2] === "sync") {
    // New games -> kick the analysis job (fire-and-forget; never affects the response).
    return syncGames(req, () => kickAnalysis("sync"));
  }

  // POST /api/games/upload
  if (
    method === "POST" &&
    segments[1] === "games" &&
    segments[2] === "upload"
  ) {
    return uploadGames(req, () => kickAnalysis("upload"));
  }

  // GET /api/games/stats
  if (method === "GET" && segments[1] === "games" && segments[2] === "stats") {
    return getGameStats(req);
  }

  // GET /api/lab/stats
  if (method === "GET" && segments[1] === "lab" && segments[2] === "stats") {
    return getLabStats(req);
  }

  // GET /api/analyze/patterns — return cached report
  if (
    method === "GET" &&
    segments[1] === "analyze" &&
    segments[2] === "patterns"
  ) {
    return getPatternReport(req);
  }

  // POST /api/analyze/patterns — run new analysis
  if (
    method === "POST" &&
    segments[1] === "analyze" &&
    segments[2] === "patterns"
  ) {
    return runPatternAnalysis(req);
  }

  // POST /api/analyze
  if (method === "POST" && segments[1] === "analyze" && segments.length === 2) {
    return analyzePosition(req);
  }
  // GET /api/v2/train-now
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "train-now" &&
    segments.length === 3
  ) {
    return trainNow(req);
  }

  // GET /api/v2/insights/dashboard
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "insights" &&
    segments[3] === "dashboard" &&
    segments.length === 4
  ) {
    return insightsDashboard(req);
  }

  // GET /api/v2/insights/velocity
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "insights" &&
    segments[3] === "velocity" &&
    segments.length === 4
  ) {
    return insightsVelocity(req);
  }

  // GET /api/v2/insights/game-type-stats
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "insights" &&
    segments[3] === "game-type-stats" &&
    segments.length === 4
  ) {
    return gameTypeStats(req);
  }

  // GET /api/v2/insights/weekly-accuracy
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "insights" &&
    segments[3] === "weekly-accuracy" &&
    segments.length === 4
  ) {
    return insightsWeeklyAccuracy(req);
  }

  // GET /api/v2/insights/top-opponents
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "insights" &&
    segments[3] === "top-opponents" &&
    segments.length === 4
  ) {
    return topOpponents(req);
  }

  // POST /api/v2/backfill-deviations
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "backfill-deviations" &&
    segments.length === 3
  ) {
    return backfillDeviations();
  }

  // POST /api/v2/dismiss-position
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "dismiss-position" &&
    segments.length === 3
  ) {
    return dismissPosition(req);
  }

  // POST /api/v2/refresh-analysis
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "refresh-analysis" &&
    segments.length === 3
  ) {
    return refreshAnalysis(req);
  }

  // GET /api/v2/analysis/status
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "analysis" &&
    segments[3] === "status" &&
    segments.length === 4
  ) {
    return analysisStatusRoute();
  }

  // POST /api/v2/analysis/start
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "analysis" &&
    segments[3] === "start" &&
    segments.length === 4
  ) {
    return analysisStartRoute();
  }

  // POST /api/v2/analysis/stop
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "analysis" &&
    segments[3] === "stop" &&
    segments.length === 4
  ) {
    return analysisStopRoute();
  }

  // POST /api/v2/analysis/retry-failed
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "analysis" &&
    segments[3] === "retry-failed" &&
    segments.length === 4
  ) {
    return analysisRetryFailedRoute();
  }

  // POST /api/v2/challenge-move
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "challenge-move" &&
    segments.length === 3
  ) {
    return challengeMove(req);
  }

  // POST /api/v2/audit/sweep
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "audit" &&
    segments[3] === "sweep" &&
    segments.length === 4
  ) {
    return auditSweepRoute(req);
  }

  // GET /api/v2/audit/status
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "audit" &&
    segments[3] === "status" &&
    segments.length === 4
  ) {
    return auditStatusRoute();
  }

  // POST /api/v2/audit/tiebreak
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "audit" &&
    segments[3] === "tiebreak" &&
    segments.length === 4
  ) {
    return auditTiebreakRoute(req);
  }

  // GET /api/v2/audit/report
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "audit" &&
    segments[3] === "report" &&
    segments.length === 4
  ) {
    return auditReportRoute(url);
  }

  // POST /api/v2/punish/harvest
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "punish" &&
    segments[3] === "harvest" &&
    segments.length === 4
  ) {
    return punishHarvestRoute();
  }

  // GET /api/v2/punish/status
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "punish" &&
    segments[3] === "status" &&
    segments.length === 4
  ) {
    return punishStatusRoute();
  }

  // GET /api/v2/punish/list
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "punish" &&
    segments[3] === "list" &&
    segments.length === 4
  ) {
    return punishListRoute(url);
  }

  // GET /api/v2/learn/next
  if (
    method === "GET" &&
    segments[1] === "v2" &&
    segments[2] === "learn" &&
    segments[3] === "next" &&
    segments.length === 4
  ) {
    return learnNextRoute(url);
  }

  // POST /api/v2/learn/complete
  if (
    method === "POST" &&
    segments[1] === "v2" &&
    segments[2] === "learn" &&
    segments[3] === "complete" &&
    segments.length === 4
  ) {
    return learnCompleteRoute(req);
  }

  // POST /api/analyze/blunder
  if (
    method === "POST" &&
    segments[1] === "analyze" &&
    segments[2] === "blunder" &&
    segments.length === 3
  ) {
    return explainBlunder(req);
  }

  // DELETE /api/v2/repertoire/:id/progress
  if (
    method === "DELETE" &&
    segments[1] === "v2" &&
    segments[2] === "repertoire" &&
    segments[4] === "progress" &&
    segments.length === 5
  ) {
    const id = parseId(segments[3]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return deleteRepertoireProgress(id);
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

console.log(`Chess Forge API running on http://localhost:${PORT}`);
