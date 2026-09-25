import type { Database } from "bun:sqlite";
import db from "../db";
import { Chess } from "chess.js";
import { classifyGameShape } from "../utils/gameShape";
import { computeAndPersistDeviations } from "../utils/deviations";
import { batchLoadGamePositions } from "../utils/gamePositions";
import { parseAnalysisJson } from "../utils/analysis";
import { ANALYSIS_VERSION } from "../services/analysis_config";
import { mapChessComResult } from "../utils/gameResult";

function deriveTimeClass(timeControl: string): string {
  const base = parseInt(timeControl?.split("+")[0] || "0", 10);
  const increment = parseInt(timeControl?.split("+")[1] || "0", 10);
  const total = base + 40 * increment;
  if (total < 180) return "bullet";
  if (total < 600) return "blitz";
  if (total < 1800) return "rapid";
  return "classical";
}

function classifyOpening(
  history: string[],
  pgnHeaders?: Record<string, string | null | undefined>,
): string {
  // 1. Check PGN Header first (most reliable if present)

  const headerOpening = pgnHeaders?.["Opening"] || "";

  if (headerOpening.toLowerCase().includes("jobava")) return "Jobava London";

  if (history.length === 0) return "Other";

  const h = history;

  // E4 Openings

  // ... (keep existing e4 logic)

  if (h[0] === "e4") {
    if (h[1] === "c5") return "Sicilian";

    if (h[1] === "e5") {
      if (h[2] === "Nf3") {
        if (h[3] === "Nc6") {
          if (h[4] === "Bb5") return "Ruy Lopez";

          if (h[4] === "Bc4") return "Italian Game";

          if (h[4] === "d4") return "Scotch Game";
        }

        if (h[3] === "Nf6") return "Petrov Defense";
      }

      return "Open Game";
    }

    if (h[1] === "c6") return "Caro-Kann";

    if (h[1] === "e6") return "French Defense";

    if (h[1] === "d6") return "Pirc Defense";

    if (h[1] === "g6") return "Modern Defense";

    if (h[1] === "Nf6") return "Alekhine Defense";

    if (h[1] === "d5") return "Scandinavian";
  }

  // D4 Openings

  if (h[0] === "d4") {
    // Detect Jobava London (1. d4 ... 2. Nc3 ... 3. Bf4)

    // We check if White plays Nc3 and Bf4 in their first 3 moves

    const whiteMoves = [h[0], h[2], h[4]];

    if (whiteMoves[1] === "Nc3" && whiteMoves[2] === "Bf4")
      return "Jobava London";

    if (h[1] === "d5") {
      if (h[2] === "c4") {
        if (h[3] === "e6") return "Queen's Gambit Declined";

        if (h[3] === "c6") return "Slav Defense";

        return "Queen's Gambit";
      }

      if (
        h[2] === "Bf4" ||
        (h[2] === "Nf3" && h[3] !== "Nc3" && h[4] === "Bf4")
      )
        return "London System";
    }

    if (h[1] === "Nf6") {
      if (h[2] === "c4") {
        if (h[3] === "e6") return "Nimzo / Queen's Indian";

        if (h[3] === "g6") return "King's Indian / Grünfeld";

        if (h[3] === "c5") return "Benoni Defense";
      }

      if (h[2] === "Nf3" && h[3] === "e6" && h[4] === "Bf4")
        return "London System";
    }
  }

  // Other
  if (h[0] === "c4") return "English Opening";
  if (h[0] === "Nf3") return "Réti Opening";

  return "Other";
}

/**
 * `onImported` fires (fire-and-forget; errors are swallowed) with the number of
 * newly inserted games, so the server can kick the analysis job without the
 * sync response ever depending on it.
 */
export async function syncGames(
  req: Request,
  onImported?: (imported: number) => void,
): Promise<Response> {
  const { username } = (await req.json()) as { username: string };
  if (!username)
    return Response.json({ error: "Username required" }, { status: 400 });

  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${username}/games/archives`,
  );
  if (!archivesRes.ok)
    return Response.json({ error: "Chess.com API error" }, { status: 502 });

  const { archives } = await archivesRes.json();
  const lastMonths = archives.slice(-3); // last 3 months

  let importedCount = 0;

  const insertGame = db.prepare(`
    INSERT OR IGNORE INTO games (
      uuid, white_username, black_username, user_color, result,
      white_result, black_result, time_control, time_class,
      pgn, opening_class, opening_name, eco, date, termination
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPos = db.prepare(
    `INSERT INTO game_positions (game_id, fen, fen_before, san) VALUES (?, ?, ?, ?)`,
  );

  for (const url of lastMonths) {
    const gamesRes = await fetch(url);
    if (!gamesRes.ok) continue;
    const { games } = await gamesRes.json();

    const transaction = db.transaction((gamesBatch: any[]) => {
      for (const g of gamesBatch) {
        if (!g.pgn) continue;

        const isWhite =
          g.white.username.toLowerCase() === username.toLowerCase();
        const userColor = isWhite ? "white" : "black";
        const myResult = isWhite ? g.white.result : g.black.result;
        const opponentResult = isWhite ? g.black.result : g.white.result;
        // chess.com's codes are per player ("resigned", "timeout", "agreed", ...);
        // see utils/gameResult.ts for the full table.
        const result = mapChessComResult(myResult, opponentResult);

        const timeControl = g.time_control || "";
        const timeClass = g.time_class || deriveTimeClass(timeControl);

        let verboseHistory: any[] = [];
        let opening = "Other";
        let openingName = null;
        let ecoCode = null;
        try {
          const chess = new Chess();
          chess.loadPgn(g.pgn);
          const headers = chess.header();
          openingName = headers["Opening"] || null;
          ecoCode = headers["ECO"] || null;
          opening = classifyOpening(chess.history(), headers);
          verboseHistory = chess.history({ verbose: true });
        } catch {
          continue;
        }

        // Extract Termination header from PGN
        const terminationMatch = g.pgn.match(/\[Termination\s+"([^"]+)"\]/);
        const termination = terminationMatch ? terminationMatch[1] : null;

        const res = insertGame.run(
          g.uuid,
          g.white.username,
          g.black.username,
          userColor,
          result,
          g.white.result,
          g.black.result,
          timeControl,
          timeClass,
          g.pgn,
          opening,
          openingName,
          ecoCode,
          new Date(g.end_time * 1000).toISOString(),
          termination,
        );
        if (res.changes === 0) continue;

        const gameId = res.lastInsertRowid;
        importedCount++;

        const replay = new Chess();
        for (const move of verboseHistory) {
          const fenBefore = replay.fen();
          replay.move(move);
          insertPos.run(gameId, replay.fen(), fenBefore, move.san);
        }
      }
    });

    transaction(games);
  }

  notifyImported(onImported, importedCount);
  return Response.json({ imported: importedCount });
}

function notifyImported(
  onImported: ((imported: number) => void) | undefined,
  imported: number,
): void {
  if (!onImported || imported <= 0) return;
  try {
    onImported(imported);
  } catch (e) {
    console.warn("[games] onImported hook failed:", e);
  }
}

export async function uploadGames(
  req: Request,
  onImported?: (imported: number) => void,
): Promise<Response> {
  const { pgn, username } = (await req.json()) as {
    pgn: string;
    username: string;
  };
  if (!pgn) return Response.json({ error: "PGN required" }, { status: 400 });

  const rawGames = pgn.split(/\n\n(?=\[Event)/);
  let importedCount = 0;

  const insertGame = db.prepare(`
    INSERT OR IGNORE INTO games (
      uuid, white_username, black_username, user_color, result, pgn,
      opening_class, opening_name, eco, date, termination
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPos = db.prepare(
    `INSERT INTO game_positions (game_id, fen, fen_before, san) VALUES (?, ?, ?, ?)`,
  );

  const transaction = db.transaction((gamesList: string[]) => {
    for (const gamePgn of gamesList) {
      try {
        const chess = new Chess();
        chess.loadPgn(gamePgn);
        const header = chess.header();
        const white = header["White"] || "Unknown";
        const black = header["Black"] || "Unknown";
        const dateStr = header["Date"] || new Date().toISOString();
        const uuid = `upload-${white}-${black}-${dateStr}-${Math.random().toString(36).slice(2)}`;

        const isWhite = white.toLowerCase() === (username || "").toLowerCase();
        const userColor = isWhite ? "white" : "black";
        let result = "draw";
        if (header["Result"] === "1-0") result = isWhite ? "win" : "loss";
        if (header["Result"] === "0-1") result = isWhite ? "loss" : "win";

        const opening = classifyOpening(chess.history(), header);
        const openingName = header["Opening"] || null;
        const ecoCode = header["ECO"] || null;
        const verboseHistory = chess.history({ verbose: true });

        const terminationMatch = gamePgn.match(/\[Termination\s+"([^"]+)"\]/);
        const termination = terminationMatch ? terminationMatch[1] : null;

        const res = insertGame.run(
          uuid,
          white,
          black,
          userColor,
          result,
          gamePgn,
          opening,
          openingName,
          ecoCode,
          dateStr,
          termination,
        );
        if (res.changes === 0) continue;

        const gameId = res.lastInsertRowid;
        importedCount++;

        const replay = new Chess();
        for (const move of verboseHistory) {
          const fenBefore = replay.fen();
          replay.move(move);
          insertPos.run(gameId, replay.fen(), fenBefore, move.san);
        }
      } catch (e) {
        console.warn("Upload parse error:", e);
      }
    }
  });

  transaction(rawGames);
  notifyImported(onImported, importedCount);
  return Response.json({ imported: importedCount });
}

export function getGameStats(_req: Request): Response {
  const rows = db
    .query(
      `
    SELECT opening_class, user_color, COUNT(*) as total,
           SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
           SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
           SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) as draws
    FROM games
    GROUP BY opening_class, user_color
  `,
    )
    .all();
  return Response.json(rows);
}

export function getLabStats(req: Request): Response {
  const url = new URL(req.url);
  const fen = url.searchParams.get("fen");

  if (!fen) return Response.json({ error: "FEN required" }, { status: 400 });

  // 1. Get games that reached this position
  const games = db
    .query(
      `
    SELECT DISTINCT g.id, g.white_username, g.black_username, g.result, g.date, g.uuid, g.opening_class, g.opening_name, g.eco
    FROM games g
    JOIN game_positions gp ON g.id = gp.game_id
    WHERE gp.fen = ?
    ORDER BY g.date DESC
    LIMIT 50
  `,
    )
    .all(fen);

  // 2. Get next moves statistics
  // We look for positions where fen_before == current_fen
  const moves = db
    .query(
      `
    SELECT 
      gp.san,
      COUNT(*) as count,
      SUM(CASE WHEN g.result = 'win' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN g.result = 'loss' THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN g.result = 'draw' THEN 1 ELSE 0 END) as draws
    FROM game_positions gp
    JOIN games g ON gp.game_id = g.id
    WHERE gp.fen_before = ?
    GROUP BY gp.san
    ORDER BY count DESC
  `,
    )
    .all(fen);

  return Response.json({ games, moves });
}

export function listGames(req: Request): Response {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const unanalyzedOnly = url.searchParams.get("unanalyzedOnly") === "true";

  let query = `
    SELECT id, uuid, white_username, black_username, user_color, result,
           white_result, black_result, time_control, time_class,
           opening_class, opening_name, eco, analysis_json, date, created_at as imported_at
    FROM games
  `;

  const params: any[] = [];
  if (unanalyzedOnly) {
    query += ` WHERE analysis_json IS NULL `;
  }

  query += ` ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ? `;
  params.push(limit, offset);

  const rows = db.query(query).all(...params);

  return Response.json(rows);
}

export function getGame(req: Request): Response {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idStr = parts[parts.length - 1];
    const id = parseInt(idStr, 10);

    console.log(
      `[GET /api/games/:id] Request for ID: "${idStr}" (parsed: ${id})`,
    );

    if (isNaN(id)) {
      return Response.json({ error: "Invalid ID" }, { status: 400 });
    }

    const game = db.query(`SELECT * FROM games WHERE id = ?`).get(id) as
      | { white_username?: string; black_username?: string; [k: string]: unknown }
      | undefined;

    if (!game) {
      console.warn(`[GET /api/games/:id] Game not found for ID: ${id}`);
      return Response.json({ error: "Game not found" }, { status: 404 });
    }

    console.log(
      `[GET /api/games/:id] Success: Found game "${game.white_username} vs ${game.black_username}"`,
    );
    return Response.json(game);
  } catch (err: any) {
    console.error(`[GET /api/games/:id] Server Error:`, err);
    return Response.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function clearAllAnalysis(_req: Request): Promise<Response> {
  try {
    db.prepare(
      `UPDATE games SET analysis_json = NULL, game_shape = NULL`,
    ).run();
    console.log(`[POST /api/games/clear-analysis] Cleared all game analysis`);
    return Response.json({ ok: true });
  } catch (err: any) {
    console.error(`[POST /api/games/clear-analysis] Server Error:`, err);
    return Response.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}

/** The fields of an analysis row this module reads; clients may send more. */
type SavedMove = {
  san?: string;
  fen?: string;
  eval?: number;
  cpLoss?: number;
  grade?: string;
};

/**
 * Persist a game's per-move analysis: analysis_json, game_shape, termination,
 * the analysis_* bookkeeping columns, and a fresh deviations pass. Shared by the
 * `POST /api/games/:id/analysis` route and the server-side analysis job.
 *
 * `meta` says how the analysis was produced. With it (the job) the game is
 * stamped version/depth and any `analysis_failed` mark is cleared. Without it
 * (the browser client) the analysis is legacy, so version/depth go back to NULL
 * and the job will eventually overwrite it; `analysis_failed` is left alone.
 *
 * Downgrade guard: a save WITHOUT `meta` never overwrites an existing analysis
 * whose `analysis_version` is already >= ANALYSIS_VERSION (a browser depth-12
 * result must not replace the server's). It returns `{ ignored: true }` and
 * changes nothing — not the row, not the deviations.
 */
export function saveGameAnalysis(
  gameId: number,
  analysis: SavedMove[],
  meta?: { version: number; depth: number },
  database: Database = db,
): { found: false } | { found: true; shape: string | null; ignored?: true } {
  // One read: the PGN (Termination header) and what is already stored.
  const gameRow = database
    .query(
      `SELECT pgn, analysis_json, analysis_version, game_shape FROM games WHERE id = ?`,
    )
    .get(gameId) as {
    pgn: string | null;
    analysis_json: string | null;
    analysis_version: number | null;
    game_shape: string | null;
  } | null;

  if (
    !meta &&
    gameRow?.analysis_json != null &&
    gameRow.analysis_version != null &&
    gameRow.analysis_version >= ANALYSIS_VERSION
  ) {
    return { found: true, ignored: true, shape: gameRow.game_shape };
  }

  // Compute game shape from analysis
  const evals: number[] = analysis.map((m) => m.eval ?? 0);
  const grades: string[] = analysis.map((m) => m.grade ?? "good");
  const gameShape = classifyGameShape(evals, grades);

  let termination: string | null = null;
  if (gameRow?.pgn) {
    const termMatch = gameRow.pgn.match(/\[Termination\s+"([^"]+)"\]/);
    if (termMatch) termination = termMatch[1];
  }

  const res = meta
    ? database
        .prepare(
          `UPDATE games SET analysis_json = ?, game_shape = ?, termination = ?,
             analysis_version = ?, analysis_depth = ?, analysis_failed = NULL,
             analysis_updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(
          JSON.stringify(analysis),
          gameShape,
          termination,
          meta.version,
          meta.depth,
          gameId,
        )
    : database
        .prepare(
          `UPDATE games SET analysis_json = ?, game_shape = ?, termination = ?,
             analysis_version = NULL, analysis_depth = NULL,
             analysis_updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(JSON.stringify(analysis), gameShape, termination, gameId);

  if (res.changes === 0) return { found: false };

  // v2: Compute and persist deviations against all repertoires
  try {
    computeAndPersistDeviations(Number(gameId), analysis, database);
  } catch (devErr) {
    console.warn(
      `[saveAnalysis] Deviation computation failed for game ${gameId}:`,
      devErr,
    );
  }

  return { found: true, shape: gameShape };
}

export async function saveAnalysis(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parseInt(parts[parts.length - 2], 10); // /api/games/:id/analysis

    const { analysis } = (await req.json()) as { analysis: SavedMove[] };

    if (isNaN(id))
      return Response.json({ error: "Invalid ID" }, { status: 400 });

    const saved = saveGameAnalysis(id, analysis);
    if (!saved.found)
      return Response.json({ error: "Game not found" }, { status: 404 });

    if (saved.ignored) {
      console.log(
        `[POST /api/games/:id/analysis] Ignored browser save for game ID: ${id} (server analysis v${ANALYSIS_VERSION}+ already stored)`,
      );
      return Response.json({ ok: true, shape: saved.shape, ignored: true });
    }
    console.log(
      `[POST /api/games/:id/analysis] Saved analysis for game ID: ${id}, shape: ${saved.shape}`,
    );
    return Response.json({ ok: true, shape: saved.shape });
  } catch (err: any) {
    console.error(`[POST /api/games/:id/analysis] Server Error:`, err);
    return Response.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}

export function getBlunders(limit: number = 20): Response {
  const games = db
    .query(
      `SELECT id, date, white_username, black_username, result, user_color, analysis_json, opening_class, game_shape
     FROM games WHERE analysis_json IS NOT NULL ORDER BY date DESC LIMIT 100`,
    )
    .all() as any[];

  const blunders: any[] = [];

  // Batch-load fen_before rows for every fetched game in a single query.
  const positionsByGame = batchLoadGamePositions(games.map((g) => g.id));

  for (const game of games) {
    const moves = parseAnalysisJson(game.analysis_json, game.id);
    if (!moves) continue;

    const positions = positionsByGame.get(game.id) ?? [];

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      // Only include mistakes made by the user's own pieces
      const isWhiteMove = i % 2 === 0;
      const isUserMove =
        game.user_color === "white" ? isWhiteMove : !isWhiteMove;
      if ((m.grade === "blunder" || m.grade === "mistake") && isUserMove) {
        // Show position before the blunder so the user can see what they should have played
        const fenBefore = positions[i]?.fen_before ?? m.fen;
        blunders.push({
          gameId: game.id,
          date: game.date ?? "",
          white: game.white_username ?? "",
          black: game.black_username ?? "",
          result: game.result ?? "",
          userColor: game.user_color ?? null,
          moveIndex: i,
          san: m.san,
          grade: m.grade,
          cpLoss: m.cpLoss ?? 0,
          fen: fenBefore,
          gameShape: game.game_shape ?? null,
          openingClass: game.opening_class ?? null,
          evals: moves.map((mv: any) => mv.eval ?? 0),
        });
      }
    }
  }

  blunders.sort((a, b) => b.cpLoss - a.cpLoss);
  return Response.json(blunders.slice(0, limit));
}

/**
 * POST /api/v2/backfill-deviations
 * Recomputes deviations for all previously analyzed games.
 * Safe to run multiple times — computeAndPersistDeviations deletes existing rows first.
 */
export async function backfillDeviations(): Promise<Response> {
  const games = db
    .query(
      "SELECT id, analysis_json FROM games WHERE analysis_json IS NOT NULL ORDER BY id",
    )
    .all() as { id: number; analysis_json: string }[];

  let processed = 0;
  let failed = 0;

  for (const game of games) {
    const analysis = parseAnalysisJson(game.analysis_json, game.id);
    if (!analysis) {
      failed++;
      continue;
    }
    try {
      computeAndPersistDeviations(game.id, analysis);
      processed++;
    } catch {
      failed++;
    }
  }

  return Response.json({ processed, failed, total: games.length });
}
