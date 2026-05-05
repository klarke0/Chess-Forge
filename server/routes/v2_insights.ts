import db from "../db";
import { batchLoadGamePositions } from "../utils/gamePositions";
import { formatWeekLabel } from "../utils/dateFormat";
import { normalizeFen } from "../utils/fen";
import { parseAnalysisJson } from "../utils/analysis";

/** Return the Monday (start of ISO week) for a given date. */
function weekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function insightsVelocity(req: Request): Response {
  const url = new URL(req.url);
  const repertoireIdParam = url.searchParams.get("repertoireId");

  if (!repertoireIdParam) {
    return Response.json(
      { error: "repertoireId query param required" },
      { status: 400 },
    );
  }
  const repertoireId = parseInt(repertoireIdParam, 10);
  if (isNaN(repertoireId)) {
    return Response.json({ error: "Invalid repertoireId" }, { status: 400 });
  }

  const NUM_WEEKS = 8;
  const now = new Date();
  const currentWeekStart = weekStart(now);

  // Build week buckets (newest first in computation, reversed at the end)
  const weekBuckets: {
    start: Date;
    label: string;
    blunders: number;
    games: number;
    totalCpLoss: number;
    blunderMoves: number;
  }[] = [];
  for (let w = 0; w < NUM_WEEKS; w++) {
    const start = new Date(currentWeekStart);
    start.setDate(start.getDate() - w * 7);
    weekBuckets.push({
      start,
      label: formatWeekLabel(start),
      blunders: 0,
      games: 0,
      totalCpLoss: 0,
      blunderMoves: 0,
    });
  }

  // Cutoff: 8 weeks before the current week start
  const cutoff = new Date(currentWeekStart);
  cutoff.setDate(cutoff.getDate() - (NUM_WEEKS - 1) * 7);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  // Load games with analysis in the window
  const games = db
    .query(
      `SELECT g.id, g.analysis_json, g.date, g.user_color
       FROM games g
       WHERE g.analysis_json IS NOT NULL AND g.date >= ?
       ORDER BY g.date DESC`,
    )
    .all(cutoffStr) as {
    id: number;
    analysis_json: string;
    date: string;
    user_color: string;
  }[];

  // Load repertoire position FENs for filtering to in-repertoire blunders
  const repFens = new Set<string>();
  const posRows = db
    .query("SELECT DISTINCT fen FROM positions WHERE repertoire_id = ?")
    .all(repertoireId) as { fen: string }[];
  for (const row of posRows) {
    repFens.add(row.fen);
  }

  // Batch-load game_positions for all games in the window in a single query
  // (replaces the per-game N+1 SELECT that previously ran inside the loop).
  const positionsByGame = batchLoadGamePositions(games.map((g) => g.id));

  for (const game of games) {
    const gameDate = new Date(game.date);
    const gameWeekStart = weekStart(gameDate);

    // Find which bucket this game belongs to
    const bucket = weekBuckets.find(
      (b) => b.start.getTime() === gameWeekStart.getTime(),
    );
    if (!bucket) continue;

    bucket.games++;

    const moves = parseAnalysisJson(game.analysis_json, game.id);
    if (!moves) continue;

    const positions = positionsByGame.get(game.id) ?? [];

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const isWhiteMove = i % 2 === 0;
      const isUserMove =
        game.user_color === "white" ? isWhiteMove : !isWhiteMove;
      if (!isUserMove) continue;

      const cpLossPawns = (m.cpLoss ?? 0) / 100;
      if (cpLossPawns < 0.5) continue;
      if (m.grade !== "blunder" && m.grade !== "mistake") continue;

      const fenBefore = positions[i]?.fen_before;
      if (!fenBefore) continue;

      // Only count blunders in repertoire positions
      const nFen = normalizeFen(fenBefore);
      if (!repFens.has(nFen)) continue;

      bucket.blunders++;
      bucket.totalCpLoss += cpLossPawns;
      bucket.blunderMoves++;
    }
  }

  // Build response (oldest week first)
  const weeks = weekBuckets.reverse().map((b) => ({
    label: b.label,
    blunders: b.blunders,
    games: b.games,
    avgCpLoss:
      b.blunderMoves > 0
        ? Math.round((b.totalCpLoss / b.blunderMoves) * 100) / 100
        : 0,
  }));

  return Response.json({ weeks });
}

export interface TimeOfDayBucket {
  bucket: "morning" | "afternoon" | "evening" | "night";
  label: string;
  hourRange: string;
  sessions: number;
  accuracy: number; // 0-100
}

export interface RepertoireAccuracy {
  id: number;
  name: string;
  positions: number;
  attempts: number;
  accuracy: number; // 0-100
}

export interface InsightsDashboard {
  timeOfDay: TimeOfDayBucket[];
  repertoireAccuracy: RepertoireAccuracy[];
}

/**
 * GET /api/v2/insights/dashboard
 * Returns:
 *   - timeOfDay: SM-2 accuracy bucketed into morning/afternoon/evening/night
 *   - repertoireAccuracy: per-repertoire accuracy from the progress table
 */
export function insightsDashboard(_req: Request): Response {
  // ── Time-of-day buckets ──────────────────────────────────────────────────────
  // Bucket definitions: morning 5-11, afternoon 12-17, evening 18-21, night 22-4
  const hourRows = db
    .query(
      `SELECT
         CAST(strftime('%H', last_reviewed) AS INTEGER) AS hour,
         COUNT(*) AS sessions,
         SUM(correct_attempts) AS correct,
         SUM(total_attempts) AS attempts
       FROM progress
       WHERE last_reviewed IS NOT NULL AND total_attempts > 0
       GROUP BY hour`,
    )
    .all() as { hour: number; sessions: number; correct: number; attempts: number }[];

  const buckets = {
    morning:   { label: "Morning",   hourRange: "5–11am",  sessions: 0, correct: 0, attempts: 0 },
    afternoon: { label: "Afternoon", hourRange: "12–5pm",  sessions: 0, correct: 0, attempts: 0 },
    evening:   { label: "Evening",   hourRange: "6–9pm",   sessions: 0, correct: 0, attempts: 0 },
    night:     { label: "Night",     hourRange: "10pm–4am",sessions: 0, correct: 0, attempts: 0 },
  };

  for (const row of hourRows) {
    const h = row.hour;
    let key: keyof typeof buckets;
    if (h >= 5 && h <= 11) key = "morning";
    else if (h >= 12 && h <= 17) key = "afternoon";
    else if (h >= 18 && h <= 21) key = "evening";
    else key = "night";
    buckets[key].sessions += row.sessions;
    buckets[key].correct += row.correct;
    buckets[key].attempts += row.attempts;
  }

  const timeOfDay: TimeOfDayBucket[] = (
    ["morning", "afternoon", "evening", "night"] as const
  ).map((key) => {
    const b = buckets[key];
    return {
      bucket: key,
      label: b.label,
      hourRange: b.hourRange,
      sessions: b.sessions,
      accuracy: b.attempts > 0 ? Math.round((b.correct / b.attempts) * 100) : 0,
    };
  });

  // ── Per-repertoire accuracy ──────────────────────────────────────────────────
  const repRows = db
    .query(
      `SELECT
         r.id,
         r.name,
         COUNT(p.id) AS positions,
         SUM(p.total_attempts) AS attempts,
         SUM(p.correct_attempts) AS correct
       FROM repertoires r
       LEFT JOIN progress p ON p.repertoire_id = r.id
       GROUP BY r.id
       ORDER BY r.id`,
    )
    .all() as { id: number; name: string; positions: number; attempts: number; correct: number }[];

  const repertoireAccuracy: RepertoireAccuracy[] = repRows.map((r) => ({
    id: r.id,
    name: r.name,
    positions: r.positions ?? 0,
    attempts: r.attempts ?? 0,
    accuracy: r.attempts > 0 ? Math.round((r.correct / r.attempts) * 100) : 0,
  }));

  const dashboard: InsightsDashboard = { timeOfDay, repertoireAccuracy };
  return Response.json(dashboard);
}

/** GET /api/v2/insights/game-type-stats — win/draw/loss split by time_class */
export function gameTypeStats(_req: Request): Response {
  const rows = db
    .query(
      `SELECT
         COALESCE(time_class, 'unknown') as time_class,
         COUNT(*) as games,
         SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
         SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) as draws,
         SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
       FROM games
       WHERE time_class IS NOT NULL
       GROUP BY time_class
       ORDER BY games DESC`,
    )
    .all() as {
    time_class: string;
    games: number;
    wins: number;
    draws: number;
    losses: number;
  }[];

  const byType = rows.map((r) => ({
    timeClass: r.time_class,
    games: r.games,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    winPct: r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0,
    drawPct: r.games > 0 ? Math.round((r.draws / r.games) * 100) : 0,
    lossPct: r.games > 0 ? Math.round((r.losses / r.games) * 100) : 0,
  }));

  return Response.json({ byType });
}
