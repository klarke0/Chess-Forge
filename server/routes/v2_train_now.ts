import db from "../db";
import { Chess } from "chess.js";

function uciToSan(fen: string, uci: string): string {
  if (!uci || uci.length < 4) return '';
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });
    return move?.san ?? '';
  } catch { return ''; }
}

interface TrainPosition {
  fen: string;
  san: string;
  correctSan: string;
  cpLoss: number;
  score: number;
  source: "blunder" | "deviation" | "review";
  gameId?: number;
  moveNumber?: number;
  context?: string;
  phase?: "opening" | "middlegame" | "endgame";
}

function derivePhase(moveNumber: number | undefined): "opening" | "middlegame" | "endgame" {
  if (!moveNumber) return "middlegame";
  if (moveNumber <= 15) return "opening";
  if (moveNumber <= 35) return "middlegame";
  return "endgame";
}

/**
 * Score a position for the mistake pool.
 *
 * score = cpLossWeight * recencyWeight * repetitionWeight / familiarityDecay
 */
function scorePosition(
  cpLoss: number,
  dateStr: string | null,
  fenOccurrences: number,
  correctDrills: number,
  everDrilled: boolean,
  lastDrillCorrect: boolean,
): number {
  // cpLossWeight
  let cpLossWeight: number;
  if (cpLoss > 3.0) cpLossWeight = 5;
  else if (cpLoss >= 2.0) cpLossWeight = 4;
  else if (cpLoss >= 1.0) cpLossWeight = 3;
  else if (cpLoss >= 0.5) cpLossWeight = 2;
  else cpLossWeight = 1;

  // recencyWeight
  let recencyWeight = 1;
  if (dateStr) {
    const daysSince = (Date.now() - new Date(dateStr).getTime()) / 86400000;
    if (daysSince <= 7) recencyWeight = 3;
    else if (daysSince <= 30) recencyWeight = 2;
    else if (daysSince <= 90) recencyWeight = 1.5;
    else recencyWeight = 1;
  }

  // repetitionWeight
  let repetitionWeight: number;
  if (fenOccurrences >= 3) repetitionWeight = 4;
  else if (fenOccurrences >= 2) repetitionWeight = 2.5;
  else repetitionWeight = 1;

  // familiarityDecay
  let familiarityDecay: number;
  if (!everDrilled) familiarityDecay = 1;
  else if (!lastDrillCorrect) familiarityDecay = 0.8;
  else if (correctDrills >= 3) familiarityDecay = 5;
  else if (correctDrills >= 2) familiarityDecay = 3;
  else familiarityDecay = 1.5;

  return (cpLossWeight * recencyWeight * repetitionWeight) / familiarityDecay;
}

function normalizeFen(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

const STARTING_FEN = normalizeFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");

/** Ensure FEN is valid for chess.js (needs 6 fields). Pads with dummy clock/move counters if needed. */
function ensureFullFen(fen: string): string {
  const parts = fen.split(" ");
  if (parts.length >= 6) return fen;
  if (parts.length === 4) return fen + " 0 1";
  return fen;
}

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function buildContext(gameId: number, moveNumber?: number): string {
  const game = db.query(
    "SELECT white_username, black_username, user_color, date FROM games WHERE id = ?"
  ).get(gameId) as { white_username: string | null; black_username: string | null; user_color: string | null; date: string | null } | null;
  if (!game) return "";
  const opponent = game.user_color === "black" ? game.white_username : game.black_username;
  const shortDate = formatShortDate(game.date);
  const parts: string[] = [];
  if (opponent) parts.push(`vs. ${opponent}`);
  if (shortDate) parts.push(shortDate);
  if (moveNumber) parts.push(`Move ${moveNumber}`);
  return parts.join(" \u00b7 ");
}

export function trainNow(req: Request): Response {
  const url = new URL(req.url);
  const repertoireIdParam = url.searchParams.get("repertoireId");

  if (!repertoireIdParam) {
    return Response.json({ error: "repertoireId query param required" }, { status: 400 });
  }
  const repertoireId = parseInt(repertoireIdParam, 10);
  if (isNaN(repertoireId)) {
    return Response.json({ error: "Invalid repertoireId" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

  // Collect all candidate positions into a map keyed by normalized FEN
  const countOnly = url.searchParams.get("countOnly") === "true";

  const candidates = new Map<
    string,
    {
      san: string;
      correctSan: string;
      cpLoss: number;
      source: "blunder" | "deviation" | "review";
      gameId?: number;
      moveNumber?: number;
      date: string | null;
      context?: string;
      fullFen?: string; // original 6-part FEN for chess.js compatibility
    }
  >();

  // ---------- Source 1: Progress table (accuracy < 0.7 OR due for review) ----------
  const progressRows = db
    .query(
      `SELECT p.fen, p.total_attempts, p.correct_attempts, p.next_review,
              p.last_reviewed
       FROM progress p
       WHERE p.repertoire_id = ?
         AND (
           (p.total_attempts > 0 AND CAST(p.correct_attempts AS REAL) / p.total_attempts < 0.7)
           OR (p.next_review IS NOT NULL AND p.next_review <= ?)
         )`,
    )
    .all(repertoireId, now) as any[];

  // For progress-based positions, look up the correct move from the repertoire
  for (const row of progressRows) {
    const nFen = normalizeFen(row.fen);
    if (nFen === STARTING_FEN) continue; // never drill the starting position
    const repMoves = db
      .query("SELECT san FROM positions WHERE repertoire_id = ? AND fen = ? LIMIT 1")
      .get(repertoireId, row.fen) as { san: string } | null;
    // Also try normalized
    const repMoves2 = repMoves ?? (db
      .query("SELECT san FROM positions WHERE repertoire_id = ? AND fen = ? LIMIT 1")
      .get(repertoireId, nFen) as { san: string } | null);

    if (!repMoves2) continue;

    if (!candidates.has(nFen)) {
      candidates.set(nFen, {
        san: "",
        correctSan: repMoves2.san,
        cpLoss: 0,
        source: "review",
        date: row.last_reviewed,
      });
    }
  }

  // ---------- Source 2: Recent blunders from analysis_json (last 90 days) ----------
  const analyzedGames = db
    .query(
      `SELECT g.id, g.analysis_json, g.date, g.user_color, g.pgn
       FROM games g
       WHERE g.analysis_json IS NOT NULL AND g.date >= ?
       ORDER BY g.date DESC
       LIMIT 200`,
    )
    .all(ninetyDaysAgo) as any[];

  for (const game of analyzedGames) {
    let moves: any[];
    try {
      moves = JSON.parse(game.analysis_json);
    } catch {
      continue;
    }

    // Get fen_before for each position
    const positions = db
      .query("SELECT fen_before, san FROM game_positions WHERE game_id = ? ORDER BY id")
      .all(game.id) as { fen_before: string; san: string }[];

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const isWhiteMove = i % 2 === 0;
      const isUserMove = game.user_color === "white" ? isWhiteMove : !isWhiteMove;

      if (!isUserMove) continue;
      if (m.grade !== "blunder" && m.grade !== "mistake") continue;
      // cpLoss from analysis_json is in centipawns; convert to pawns for scoring
      const cpLossPawns = (m.cpLoss ?? 0) / 100;
      if (cpLossPawns < 0.5) continue;

      const fenBefore = positions[i]?.fen_before;
      if (!fenBefore) continue;

      // Skip move 1 — starting position is never a useful drill
      const moveNum = Math.floor(i / 2) + 1;
      if (moveNum <= 1) continue;

      const nFen = normalizeFen(fenBefore);

      // Only include positions that are in the user's repertoire.
      // Do NOT fall back to engine bestMove — that would drill positions
      // from openings the user isn't studying.
      const repMove = db
        .query("SELECT san FROM positions WHERE repertoire_id = ? AND fen = ? LIMIT 1")
        .get(repertoireId, nFen) as { san: string } | null;

      if (!repMove) continue;

      let correctSan = repMove.san;

      // Sanity check: verify the correct move is actually legal from fenBefore
      if (correctSan) {
        try {
          const verify = new Chess(fenBefore);
          if (!verify.move(correctSan)) correctSan = "";
        } catch { correctSan = ""; }
      }

      const existing = candidates.get(nFen);
      const cpLoss = cpLossPawns;
      // Keep the higher cpLoss entry
      if (!existing || cpLoss > existing.cpLoss) {
        candidates.set(nFen, {
          san: m.san ?? positions[i]?.san ?? "",
          correctSan,
          cpLoss,
          source: "blunder",
          gameId: game.id,
          moveNumber: moveNum,
          date: game.date,
          context: buildContext(game.id, moveNum),
          fullFen: fenBefore, // preserve original 6-part FEN
        });
      }
    }
  }

  // ---------- Source 3: Recent deviations (last 90 days) ----------
  const deviationRows = db
    .query(
      `SELECT d.fen, d.expected_san, d.played_san, d.move_number, d.eval_diff, d.game_id, g.date
       FROM deviations d
       JOIN games g ON d.game_id = g.id
       WHERE d.repertoire_id = ? AND g.date >= ?
         AND (d.notes = 'player' OR d.notes IS NULL)
         AND d.move_number > 1
       ORDER BY g.date DESC`,
    )
    .all(repertoireId, ninetyDaysAgo) as any[];

  for (const dev of deviationRows) {
    const nFen = normalizeFen(dev.fen);
    const existing = candidates.get(nFen);
    const cpLoss = dev.eval_diff ?? 0;

    // Sanity check: verify expected_san is legal from the deviation FEN
    let devCorrectSan: string = dev.expected_san ?? "";
    if (devCorrectSan) {
      try {
        const verify = new Chess(ensureFullFen(dev.fen));
        if (!verify.move(devCorrectSan)) devCorrectSan = "";
      } catch { devCorrectSan = ""; }
    }

    if (!existing || (existing.source !== "blunder" && cpLoss >= (existing.cpLoss ?? 0))) {
      candidates.set(nFen, {
        san: dev.played_san,
        correctSan: devCorrectSan,
        cpLoss,
        source: "deviation",
        gameId: dev.game_id,
        moveNumber: dev.move_number,
        date: dev.date,
        context: buildContext(dev.game_id, dev.move_number),
      });
    }
  }

  // ---------- countOnly: return counts without scoring ----------
  if (countOnly) {
    let blunders = 0, deviations = 0, review = 0;
    for (const cand of candidates.values()) {
      if (!cand.correctSan || !cand.correctSan.trim()) continue;
      if (cand.source === "blunder") blunders++;
      else if (cand.source === "deviation") deviations++;
      else review++;
    }
    return Response.json({ blunders, deviations, review, total: blunders + deviations + review });
  }

  // ---------- Score all candidates ----------

  // Pre-load progress data for familiarity
  const allProgress = db
    .query(
      "SELECT fen, correct_attempts, streak, total_attempts FROM progress WHERE repertoire_id = ?",
    )
    .all(repertoireId) as any[];
  const progressMap = new Map<string, { correct: number; streak: number; total: number }>();
  for (const p of allProgress) {
    progressMap.set(normalizeFen(p.fen), {
      correct: p.correct_attempts,
      streak: p.streak,
      total: p.total_attempts,
    });
  }

  // Count FEN occurrences across blunders + deviations for repetitionWeight
  const fenCounts = new Map<string, number>();
  for (const game of analyzedGames) {
    let moves: any[];
    try {
      moves = JSON.parse(game.analysis_json);
    } catch {
      continue;
    }
    const positions = db
      .query("SELECT fen_before FROM game_positions WHERE game_id = ? ORDER BY id")
      .all(game.id) as { fen_before: string }[];

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m.grade === "blunder" || m.grade === "mistake") {
        const fb = positions[i]?.fen_before;
        if (fb) {
          const nf = normalizeFen(fb);
          fenCounts.set(nf, (fenCounts.get(nf) ?? 0) + 1);
        }
      }
    }
  }
  for (const dev of deviationRows) {
    const nf = normalizeFen(dev.fen);
    fenCounts.set(nf, (fenCounts.get(nf) ?? 0) + 1);
  }

  // Score and sort
  const scored: TrainPosition[] = [];

  for (const [fen, cand] of candidates) {
    const prog = progressMap.get(fen);
    const correctDrills = prog?.correct ?? 0;
    const everDrilled = (prog?.total ?? 0) > 0;
    const lastDrillCorrect = (prog?.streak ?? 0) > 0;
    const fenOccurrences = fenCounts.get(fen) ?? 1;

    const score = scorePosition(
      cand.cpLoss,
      cand.date,
      fenOccurrences,
      correctDrills,
      everDrilled,
      lastDrillCorrect,
    );

    scored.push({
      fen: ensureFullFen(cand.fullFen ?? fen),
      san: cand.san,
      correctSan: cand.correctSan,
      cpLoss: cand.cpLoss,
      score,
      source: cand.source,
      gameId: cand.gameId,
      moveNumber: cand.moveNumber,
      context: cand.context,
      phase: derivePhase(cand.moveNumber),
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // Only return positions where we know the correct answer
  const valid = scored.filter(p => p.correctSan && p.correctSan.trim().length > 0);

  // ---------- Enforce session composition (blunders first, then deviation, then review) ----------
  const SESSION_SIZE = 8;
  const blunders = valid.filter(p => p.source === "blunder");
  const deviationsList = valid.filter(p => p.source === "deviation");
  const reviewList = valid.filter(p => p.source === "review");

  const session: TrainPosition[] = [];

  // Reserve 1 slot for top deviation
  const topDeviation = deviationsList.shift();
  // Reserve 1 slot for top review
  const topReview = reviewList.shift();

  // Fill up to 6 slots with blunders
  const blunderSlots = Math.min(blunders.length, SESSION_SIZE - (topDeviation ? 1 : 0) - (topReview ? 1 : 0));
  session.push(...blunders.slice(0, blunderSlots));

  // Add the reserved deviation and review
  if (topDeviation) session.push(topDeviation);
  if (topReview) session.push(topReview);

  // If we still have room (some source didn't have enough), fill from remaining highest-scored
  if (session.length < SESSION_SIZE) {
    const usedFens = new Set(session.map(p => p.fen));
    const remaining = valid.filter(p => !usedFens.has(p.fen));
    session.push(...remaining.slice(0, SESSION_SIZE - session.length));
  }

  // Order: blunders first, then deviations, then review
  const sourceOrder = { blunder: 0, deviation: 1, review: 2 };
  session.sort((a, b) => sourceOrder[a.source] - sourceOrder[b.source]);

  return Response.json({ positions: session });
}
