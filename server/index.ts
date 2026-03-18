import { join } from "path";
import { listRepertoires, getPositions, getChapters, importPgn, updateChapterLearnRuns, addPosition } from "./routes/repertoire";
import { getProgress, recordAttempt, getWeakPositions, getDuePositions, getProgressStats } from "./routes/progress";
import { createSession, endSession, listSessions } from "./routes/sessions";
import { syncGames, getGameStats, getLabStats, uploadGames, listGames, getGame, saveAnalysis, getBlunders } from "./routes/games";
import { analyzePosition, generateRepertoireComment } from "./routes/analyze";
import { getPatternReport, runPatternAnalysis } from "./routes/patterns";

const PORT = 3001;
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
  const isLocalHost = host.includes("localhost") || host.includes("127.0.0.1") || host.includes("::1");
  const isPrivateIp = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host);

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
    const [user, pass] = decoded.split(":");
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
      return addCors(Response.json({ error: "Internal server error" }, { status: 500 }));
    }
  },
});

async function route(method: string, path: string, url: URL, req: Request): Promise<Response> {
  // Match routes using simple pattern matching
  const segments = path.split("/").filter(Boolean); // e.g. ["api", "repertoires", "1", "positions"]

  if (segments[0] !== "api") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // GET /api/repertoires
  if (method === "GET" && segments[1] === "repertoires" && segments.length === 2) {
    return listRepertoires();
  }

  // GET /api/repertoires/:id/positions
  if (method === "GET" && segments[1] === "repertoires" && segments[3] === "positions" && segments.length === 4) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getPositions(id);
  }

  // GET /api/repertoires/:id/chapters
  if (method === "GET" && segments[1] === "repertoires" && segments[3] === "chapters" && segments.length === 4) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getChapters(id);
  }

  // POST /api/repertoires/:id/positions
  if (method === "POST" && segments[1] === "repertoires" && segments[3] === "positions" && segments.length === 4) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return addPosition(req, id);
  }

  // POST /api/repertoires/import
  if (method === "POST" && segments[1] === "repertoires" && segments[2] === "import" && segments.length === 3) {
    return importPgn(req);
  }

  // PATCH /api/chapters/:id/learn_runs
  if (method === "PATCH" && segments[1] === "chapters" && segments[3] === "learn_runs" && segments.length === 4) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return updateChapterLearnRuns(req, id);
  }

  // GET /api/progress/:repertoireId/stats
  if (method === "GET" && segments[1] === "progress" && segments[3] === "stats" && segments.length === 4) {
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

  // GET /api/progress/:repertoireId/weak
  if (method === "GET" && segments[1] === "progress" && segments[3] === "weak" && segments.length === 4) {
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getWeakPositions(id);
  }

  // GET /api/progress/:repertoireId/due
  if (method === "GET" && segments[1] === "progress" && segments[3] === "due" && segments.length === 4) {
    if (segments[2] === "all") {
      return getDuePositions('all');
    }
    const id = parseId(segments[2]);
    if (id < 0) return Response.json({ error: "Invalid ID" }, { status: 400 });
    return getDuePositions(id);
  }

  // POST /api/progress/record
  if (method === "POST" && segments[1] === "progress" && segments[2] === "record" && segments.length === 3) {
    return recordAttempt(req);
  }

  // POST /api/sessions
  if (method === "POST" && segments[1] === "sessions" && segments.length === 2) {
    return createSession(req);
  }

  // PATCH /api/sessions/:id
  if (method === "PATCH" && segments[1] === "sessions" && segments.length === 3) {
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
  if (method === "GET" && segments[1] === "games" && segments[2] === "blunders" && segments.length === 3) {
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    return getBlunders(limit);
  }

  // GET /api/games/:id
  if (method === "GET" && segments[1] === "games" && segments.length === 3) {
    return getGame(req);
  }

  // POST /api/games/clear-analysis
  if (method === "POST" && segments[1] === "games" && segments[2] === "clear-analysis" && segments.length === 3) {
    const { clearAllAnalysis } = await import("./routes/games");
    return clearAllAnalysis(req);
  }

  // POST /api/games/:id/analysis
  if (method === "POST" && segments[1] === "games" && segments[3] === "analysis") {
    return saveAnalysis(req);
  }

  // POST /api/games/sync
  if (method === "POST" && segments[1] === "games" && segments[2] === "sync") {
    return syncGames(req);
  }

  // POST /api/games/upload
  if (method === "POST" && segments[1] === "games" && segments[2] === "upload") {
    return uploadGames(req);
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
      if (method === "GET" && segments[1] === "analyze" && segments[2] === "patterns") {
        return getPatternReport(req);
      }
  
      // POST /api/analyze/patterns — run new analysis
      if (method === "POST" && segments[1] === "analyze" && segments[2] === "patterns") {
        return runPatternAnalysis(req);
      }
  
      // POST /api/analyze
      if (method === "POST" && segments[1] === "analyze" && segments.length === 2) {
        return analyzePosition(req);
      }
  // POST /api/analyze/repertoire-comment
  if (method === "POST" && segments[1] === "analyze" && segments[2] === "repertoire-comment" && segments.length === 3) {
    return generateRepertoireComment(req);
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}

console.log(`Chess Forge API running on http://localhost:${PORT}`);
