import db from "../db";
import { Chess } from "chess.js";
import { batchLoadGamePositions } from "../utils/gamePositions";
import { normalizeFen } from "../utils/fen";
import { formatShortDate } from "../utils/dateFormat";
import { parseAnalysisJson } from "../utils/analysis";

function uciToSan(fen: string, uci: string): string {
  if (!uci || uci.length < 4) return "";
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] ?? "q",
    });
    return move?.san ?? "";
  } catch {
    return "";
  }
}

export type TacticalPattern =
  | "back-rank"
  | "pin"
  | "fork"
  | "discovered-attack"
  | "promotion"
  | "endgame"
  | "opening"
  | "middlegame"
  | "other";

interface TrainPosition {
  fen: string;
  san: string;
  correctSan: string;
  cpLoss: number;
  score: number;
  source: "blunder" | "deviation" | "review" | "repertoire";
  gameId?: number;
  moveNumber?: number;
  context?: string;
  phase?: "opening" | "middlegame" | "endgame";
  firstEncounter?: boolean;
  pattern?: TacticalPattern;
}

/**
 * Heuristic tactical pattern classifier.
 *
 * Runs at session-build time using chess.js board analysis only — no engine
 * calls, no Gemini. Returns a broad theme label that's good enough to cluster
 * similar positions adjacently in the session queue.
 *
 * Detection priority (first match wins):
 *   1. back-rank   — opponent king on back rank + R/Q move or check
 *   2. promotion   — correct move is a pawn push to rank 1/8
 *   3. fork        — knight move after which it attacks 2+ high-value opponent pieces
 *   4. pin         — correct move is a sliding piece targeting a piece that
 *                    cannot move without exposing the opponent king
 *   5. discovered  — pawn capture that gives check (reveals a sliding piece)
 *   6. endgame     — ≤ 8 pieces total on board
 *   7. opening     — move number ≤ 15
 *   8. middlegame  — fallback for middlegame positions
 */
function classifyPattern(
  fen: string,
  correctSan: string,
  moveNumber?: number,
): TacticalPattern {
  try {
    const chess = new Chess(ensureFullFen(fen));
    const board = chess.board();
    const turn = chess.turn(); // 'w' or 'b'
    const opp: "w" | "b" = turn === "w" ? "b" : "w";

    // Count total pieces for endgame detection
    let totalPieces = 0;
    for (const row of board) {
      for (const sq of row) {
        if (sq) totalPieces++;
      }
    }

    // Helper: get piece on algebraic square from board array
    function pieceAt(sq: string): { type: string; color: string } | null {
      const file = sq.charCodeAt(0) - 97; // 'a'=0
      const rank = parseInt(sq[1], 10) - 1; // '1'=0
      const boardRank = 7 - rank; // board[0] = rank 8
      return board[boardRank]?.[file] ?? null;
    }

    // Knight attack offsets
    const KNIGHT_OFFSETS = [
      [2, 1], [2, -1], [-2, 1], [-2, -1],
      [1, 2], [1, -2], [-1, 2], [-1, -2],
    ];

    function knightAttacksSquare(from: string, to: string): boolean {
      const fc = from.charCodeAt(0) - 97;
      const fr = parseInt(from[1], 10) - 1;
      const tc = to.charCodeAt(0) - 97;
      const tr = parseInt(to[1], 10) - 1;
      return KNIGHT_OFFSETS.some(([dc, dr]) => fc + dc === tc && fr + dr === tr);
    }
    void knightAttacksSquare;

    // ---- 1. Back-rank mate threat ----
    {
      const oppKingBoardRank = opp === "w" ? 7 : 0; // board[0]=rank8, board[7]=rank1
      let kingOnBackRank = false;
      for (const sq of board[oppKingBoardRank]) {
        if (sq?.type === "k" && sq.color === opp) {
          kingOnBackRank = true;
          break;
        }
      }
      if (kingOnBackRank) {
        const san = correctSan;
        if (/^[RQ]/.test(san) || san.includes("+") || san.includes("#")) {
          return "back-rank";
        }
      }
    }

    // ---- 2. Promotion ----
    if (correctSan.includes("=") || /[a-h][18]/.test(correctSan)) {
      try {
        const temp = new Chess(ensureFullFen(fen));
        const mv = temp.move(correctSan);
        if (mv && mv.piece === "p") return "promotion";
      } catch { /* fall through */ }
    }

    // ---- 3. Fork (knight move attacking 2+ high-value opponent pieces) ----
    if (/^N/.test(correctSan)) {
      try {
        const temp = new Chess(ensureFullFen(fen));
        const mv = temp.move(correctSan);
        if (mv && mv.piece === "n") {
          const toFile = mv.to.charCodeAt(0) - 97;
          const toRank = parseInt(mv.to[1], 10) - 1;
          let attacked = 0;
          for (const [dc, dr] of KNIGHT_OFFSETS) {
            const f = toFile + dc;
            const r = toRank + dr;
            if (f < 0 || f > 7 || r < 0 || r > 7) continue;
            const targetSq = String.fromCharCode(97 + f) + (r + 1);
            const p = pieceAt(targetSq);
            // Count opponent king, queen, rook, bishop, knight (not pawns)
            if (p && p.color === opp && p.type !== "p") attacked++;
          }
          if (attacked >= 2) return "fork";
        }
      } catch { /* fall through */ }
    }

    // ---- 4. Pin (sliding piece move targeting a piece that can't escape) ----
    if (/^[BRQ]/.test(correctSan) && totalPieces > 8 && (moveNumber ?? 0) > 8) {
      try {
        const temp = new Chess(ensureFullFen(fen));
        const mv = temp.move(correctSan);
        if (mv && !mv.captured) {
          // After the move, check if opponent is in check — that's a discovery
          // For a pin: look for an opponent piece that now has 0 legal escape moves
          // Simplified: if after our move the opponent has fewer legal moves per piece
          // We approximate: if the move puts a piece on a rank/file/diagonal toward king
          // and there's an opponent piece in between, it's likely a pin.
          // chess.js exposes moves() per square — use it.
          const oppKingSquare = (() => {
            for (let r = 7; r >= 0; r--) {
              for (let f = 0; f < 8; f++) {
                const sq = board[r]?.[f];
                if (sq?.type === "k" && sq.color === opp) {
                  return String.fromCharCode(97 + f) + (8 - r);
                }
              }
            }
            return null;
          })();
          if (oppKingSquare) {
            // Check a random opponent piece between mover and king to confirm pin
            // This is expensive to do precisely, so we just mark any sliding-piece
            // move that doesn't capture as a potential pin if it's on the same
            // rank/file/diagonal as the opponent king.
            const toFile = mv.to.charCodeAt(0) - 97;
            const toRank = parseInt(mv.to[1], 10) - 1;
            const kFile = oppKingSquare.charCodeAt(0) - 97;
            const kRank = parseInt(oppKingSquare[1], 10) - 1;
            const df = kFile - toFile;
            const dr = kRank - toRank;
            const onSameRank = df === 0;
            const onSameFile = dr === 0;
            const onSameDiag = Math.abs(df) === Math.abs(dr);
            if (onSameRank || onSameFile || onSameDiag) {
              return "pin";
            }
          }
        }
      } catch { /* fall through */ }
    }

    // ---- 5. Discovered attack ----
    {
      if (/^[a-h]x/.test(correctSan) || /^[BNRQ]/.test(correctSan)) {
        try {
          const temp = new Chess(ensureFullFen(fen));
          const mv = temp.move(correctSan);
          if (mv) {
            const inCheck = temp.inCheck();
            // Only classify as discovery if the move itself isn't a check piece
            // (i.e., the piece we moved isn't on the checking line)
            if (inCheck && mv.piece !== "q" && mv.piece !== "r" && mv.piece !== "b") {
              return "discovered-attack";
            }
            // Pawn capture that gives check — classic discovery
            if (inCheck && mv.piece === "p" && mv.captured) {
              return "discovered-attack";
            }
          }
        } catch { /* fall through */ }
      }
    }

    // ---- 6. Endgame ----
    if (totalPieces <= 8) return "endgame";

    // ---- 7. Opening / middlegame ----
    if (moveNumber && moveNumber <= 15) return "opening";
    if (moveNumber && moveNumber <= 35) return "middlegame";

    return "other";
  } catch {
    return "other";
  }
}

function derivePhase(
  moveNumber: number | undefined,
): "opening" | "middlegame" | "endgame" {
  if (!moveNumber) return "middlegame";
  if (moveNumber <= 15) return "opening";
  if (moveNumber <= 35) return "middlegame";
  return "endgame";
}

/**
 * Score a position for the mistake pool.
 *
 * score = cpLossWeight * recencyWeight * repetitionWeight / familiarityDecay * phaseMultiplier
 */
function scorePosition(
  cpLoss: number,
  dateStr: string | null,
  fenOccurrences: number,
  correctDrills: number,
  everDrilled: boolean,
  lastDrillCorrect: boolean,
  phase?: "opening" | "middlegame" | "endgame",
): number {
  // cpLossWeight
  let cpLossWeight: number;
  if (cpLoss > 3.0) cpLossWeight = 5;
  else if (cpLoss >= 2.0) cpLossWeight = 4;
  else if (cpLoss >= 1.0) cpLossWeight = 3;
  else if (cpLoss >= 0.5) cpLossWeight = 2;
  else cpLossWeight = 1;

  // recencyWeight — exponential decay: ~3x for today, smooth decay to ~1x over 90 days
  let recencyWeight = 1;
  if (dateStr) {
    const daysSince = (Date.now() - new Date(dateStr).getTime()) / 86400000;
    recencyWeight = 1 + 2 * Math.exp(-daysSince / 30);
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

  // phaseMultiplier: opening blunders score highest
  const phaseMultiplier =
    phase === "opening" ? 1.5 : phase === "middlegame" ? 1.2 : 1.0;

  return (
    (cpLossWeight * recencyWeight * repetitionWeight * phaseMultiplier) /
    familiarityDecay
  );
}

const STARTING_FEN = normalizeFen(
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
);

/** Ensure FEN is valid for chess.js (needs 6 fields). Pads with dummy clock/move counters if needed. */
function ensureFullFen(fen: string): string {
  const parts = fen.split(" ");
  if (parts.length >= 6) return fen;
  if (parts.length === 4) return fen + " 0 1";
  return fen;
}

function buildContext(gameId: number, moveNumber?: number): string {
  const game = db
    .query(
      "SELECT white_username, black_username, user_color, date FROM games WHERE id = ?",
    )
    .get(gameId) as {
    white_username: string | null;
    black_username: string | null;
    user_color: string | null;
    date: string | null;
  } | null;
  if (!game) return "";
  const opponent =
    game.user_color === "black" ? game.white_username : game.black_username;
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
  console.log(
    `[trainNow] url.search=${url.search} repertoireId=${repertoireIdParam}`,
  );

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

  const phaseParam = url.searchParams.get("phase") ?? "all";
  const modeParam = url.searchParams.get("mode") ?? "blunder";

  const now = new Date().toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 365 * 86400000).toISOString();

  // Pre-load dismissed positions so they're never served again
  const dismissedSet = new Set<string>(
    (
      db
        .query("SELECT fen FROM dismissed_positions WHERE repertoire_id = ?")
        .all(repertoireId) as { fen: string }[]
    ).map((r) => normalizeFen(r.fen)),
  );

  // Collect all candidate positions into a map keyed by normalized FEN
  const countOnly = url.searchParams.get("countOnly") === "true";

  // ---------- Repertoire drill mode ----------
  if (modeParam === "repertoire") {
    // Pick ONE canonical (san) per FEN: prefer main-line, then lowest depth.
    // Avoids drilling the same position with conflicting "correct" answers.
    const repDrillRows = db
      .query(
        `SELECT p.fen, p.san,
                COALESCE(prog.correct_attempts, 0) AS correct_attempts,
                COALESCE(prog.total_attempts, 0) AS total_attempts
         FROM positions p
         JOIN repertoires r ON r.id = p.repertoire_id
         LEFT JOIN progress prog ON prog.fen = p.fen AND prog.repertoire_id = p.repertoire_id
         WHERE p.repertoire_id = ?
           AND p.fen != ?
           AND p.id = (
             SELECT id FROM positions p2
             WHERE p2.repertoire_id = p.repertoire_id AND p2.fen = p.fen
             ORDER BY p2.is_main_line DESC, p2.depth ASC, p2.san ASC LIMIT 1
           )
           AND (
             (r.side = 'white' AND SUBSTR(p.fen, INSTR(p.fen, ' ') + 1, 1) = 'w')
             OR
             (r.side = 'black' AND SUBSTR(p.fen, INSTR(p.fen, ' ') + 1, 1) = 'b')
           )
         ORDER BY COALESCE(prog.correct_attempts, 0) ASC,
                  RANDOM()`,
      )
      .all(repertoireId, STARTING_FEN) as {
      fen: string;
      san: string;
      correct_attempts: number;
      total_attempts: number;
    }[];

    if (countOnly) {
      const total = repDrillRows.filter((r) => {
        if (dismissedSet.has(normalizeFen(r.fen)) || !r.san) return false;
        if (phaseParam !== "all") {
          const moveNum = parseInt(r.fen.split(" ")[5] ?? "1", 10) || 1;
          if (phaseParam === "opening" && moveNum > 35) return false;
          if (phaseParam === "endgame" && moveNum <= 35) return false;
        }
        return true;
      }).length;
      return Response.json({ blunders: 0, deviations: 0, review: 0, total });
    }

    const SESSION_SIZE_REP = 12;
    const repSession: TrainPosition[] = [];
    for (const row of repDrillRows) {
      const nFen = normalizeFen(row.fen);
      if (nFen === STARTING_FEN) continue;
      if (dismissedSet.has(nFen)) continue;
      if (!row.san) continue;
      if (repSession.length >= SESSION_SIZE_REP) break;

      const moveNum = parseInt(row.fen.split(" ")[5] ?? "1", 10) || 1;

      if (phaseParam === "opening" && moveNum > 35) continue;
      if (phaseParam === "endgame" && moveNum <= 35) continue;

      repSession.push({
        fen: ensureFullFen(row.fen),
        san: "",
        correctSan: row.san,
        cpLoss: 0,
        score: 1.0,
        source: "repertoire",
        moveNumber: moveNum,
        phase: derivePhase(moveNum),
        firstEncounter: row.total_attempts === 0,
      });
    }

    return Response.json({ positions: repSession });
  }

  const candidates = new Map<
    string,
    {
      san: string;
      correctSan: string;
      totalCpLoss: number;
      occurrences: number;
      source: "blunder" | "deviation" | "review" | "repertoire";
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
         )
       ORDER BY p.next_review ASC`,
    )
    .all(repertoireId, now) as any[];

  // For progress-based positions, look up the correct move from the repertoire
  for (const row of progressRows) {
    const nFen = normalizeFen(row.fen);
    if (nFen === STARTING_FEN) continue; // never drill the starting position
    const repMoves = db
      .query(
        "SELECT san FROM positions WHERE repertoire_id = ? AND fen = ? ORDER BY is_main_line DESC, depth ASC, san ASC LIMIT 1",
      )
      .get(repertoireId, row.fen) as { san: string } | null;
    // Also try normalized
    const repMoves2 =
      repMoves ??
      (db
        .query(
          "SELECT san FROM positions WHERE repertoire_id = ? AND fen = ? ORDER BY is_main_line DESC, depth ASC, san ASC LIMIT 1",
        )
        .get(repertoireId, nFen) as { san: string } | null);

    if (!repMoves2) continue;

    if (!candidates.has(nFen)) {
      // Use accuracy as a proxy for cpLoss: chronic misses score higher
      const accuracy =
        row.total_attempts > 0
          ? row.correct_attempts / row.total_attempts
          : 0.5;
      const proxyCpLoss = (1 - accuracy) * 3;
      candidates.set(nFen, {
        san: "",
        correctSan: repMoves2.san,
        totalCpLoss: proxyCpLoss,
        occurrences: 1,
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
       LIMIT 500`,
    )
    .all(ninetyDaysAgo) as any[];

  // Pre-load all game_positions for analyzed games in a single batch query
  const gamePositionsMap = batchLoadGamePositions(
    analyzedGames.map((g: any) => g.id as number),
  );

  for (const game of analyzedGames) {
    const moves = parseAnalysisJson(game.analysis_json, game.id);
    if (!moves) continue;

    const positions = gamePositionsMap.get(game.id) ?? [];

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const isWhiteMove = i % 2 === 0;
      const isUserMove =
        game.user_color === "white" ? isWhiteMove : !isWhiteMove;

      if (!isUserMove) continue;
      if (m.grade !== "blunder" && m.grade !== "mistake") continue;
      // cpLoss from analysis_json is in centipawns; convert to pawns for scoring
      const cpLossPawns = (m.cpLoss ?? 0) / 100;
      if (cpLossPawns < 1.3) continue;

      const fenBefore = positions[i]?.fen_before;
      if (!fenBefore) continue;

      // Skip first 4 moves — early opening theory, not useful to drill
      const moveNum = Math.floor(i / 2) + 1;
      if (moveNum <= 4) continue;

      const nFen = normalizeFen(fenBefore);
      if (dismissedSet.has(nFen)) continue;

      // Prefer the repertoire move so opening prep is never overwritten by engine suggestions.
      // Fall back to engine bestMove for positions outside the repertoire (middlegame/endgame blunders).
      const repMoves = db
        .query(
          "SELECT san FROM positions WHERE repertoire_id = ? AND fen = ? ORDER BY is_main_line DESC, depth ASC, san ASC",
        )
        .all(repertoireId, nFen) as { san: string }[];

      // If the user's move is itself a valid repertoire move (just a different line),
      // don't drill this as a mistake — there's no single "correct" answer.
      const userSan = m.san ?? positions[i]?.san ?? "";
      if (repMoves.length > 0 && repMoves.some((r) => r.san === userSan))
        continue;

      const repMove = repMoves[0] ?? null;
      // For positions outside the repertoire the correct move comes from depth-12
      // engine analysis (bestMove), which is noisy. Require a larger loss to be sure.
      if (!repMove && cpLossPawns < 2.5) continue;

      let correctSan =
        repMove?.san ?? uciToSan(ensureFullFen(fenBefore), m.bestMove ?? "");
      if (!correctSan) continue;

      // Sanity check: verify the correct move is actually legal from fenBefore
      try {
        const verify = new Chess(ensureFullFen(fenBefore));
        if (!verify.move(correctSan)) correctSan = "";
      } catch {
        correctSan = "";
      }
      if (!correctSan) continue;

      // Skip positions where the player already played the correct move —
      // no drill value if Kevin already found the right answer in this game.
      if (correctSan === userSan) continue;

      const existing = candidates.get(nFen);
      const cpLoss = cpLossPawns;
      if (existing && existing.source === "blunder") {
        // Accumulate: track total cp loss and occurrence count
        existing.totalCpLoss += cpLoss;
        existing.occurrences += 1;
        // Keep the most recent game's context for display
        if (game.date && (!existing.date || game.date > existing.date)) {
          existing.san = m.san ?? positions[i]?.san ?? "";
          existing.gameId = game.id;
          existing.moveNumber = moveNum;
          existing.date = game.date;
          existing.context = buildContext(game.id, moveNum);
          existing.fullFen = fenBefore;
        }
      } else if (!existing) {
        candidates.set(nFen, {
          san: m.san ?? positions[i]?.san ?? "",
          correctSan,
          totalCpLoss: cpLoss,
          occurrences: 1,
          source: "blunder",
          gameId: game.id,
          moveNumber: moveNum,
          date: game.date,
          context: buildContext(game.id, moveNum),
          fullFen: fenBefore,
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
         AND d.move_number > 4
       ORDER BY g.date DESC`,
    )
    .all(repertoireId, ninetyDaysAgo) as any[];

  for (const dev of deviationRows) {
    const nFen = normalizeFen(dev.fen);
    if (dismissedSet.has(nFen)) continue;
    const existing = candidates.get(nFen);
    const cpLoss = dev.eval_diff ?? 0;

    // Sanity check: verify expected_san is legal from the deviation FEN
    let devCorrectSan: string = dev.expected_san ?? "";
    if (devCorrectSan) {
      try {
        const verify = new Chess(ensureFullFen(dev.fen));
        if (!verify.move(devCorrectSan)) devCorrectSan = "";
      } catch {
        devCorrectSan = "";
      }
    }

    if (existing && existing.source === "deviation") {
      // Accumulate deviation occurrences
      existing.totalCpLoss += cpLoss;
      existing.occurrences += 1;
      if (dev.date && (!existing.date || dev.date > existing.date)) {
        existing.san = dev.played_san;
        existing.gameId = dev.game_id;
        existing.moveNumber = dev.move_number;
        existing.date = dev.date;
        existing.context = buildContext(dev.game_id, dev.move_number);
      }
    } else if (!existing) {
      candidates.set(nFen, {
        san: dev.played_san,
        correctSan: devCorrectSan,
        totalCpLoss: cpLoss,
        occurrences: 1,
        source: "deviation",
        gameId: dev.game_id,
        moveNumber: dev.move_number,
        date: dev.date,
        context: buildContext(dev.game_id, dev.move_number),
      });
    }
  }

  // ---------- Source 4: Repertoire positions not yet mastered (fill pool) ----------
  // Only fills candidates not already covered by Sources 1–3.
  const repertoireFillRows = db
    .query(
      `SELECT p.fen, p.san
       FROM positions p
       LEFT JOIN progress prog ON prog.fen = p.fen AND prog.repertoire_id = p.repertoire_id
       WHERE p.repertoire_id = ?
         AND p.fen != ?
         AND p.id = (
           SELECT id FROM positions p2
           WHERE p2.repertoire_id = p.repertoire_id AND p2.fen = p.fen
           ORDER BY p2.is_main_line DESC, p2.depth ASC, p2.san ASC LIMIT 1
         )
         AND (prog.correct_attempts IS NULL OR prog.correct_attempts < 3)
       ORDER BY COALESCE(prog.correct_attempts, 0) ASC
       LIMIT 150`,
    )
    .all(repertoireId, STARTING_FEN) as { fen: string; san: string }[];

  for (const row of repertoireFillRows) {
    const nFen = normalizeFen(row.fen);
    if (nFen === STARTING_FEN) continue;
    if (dismissedSet.has(nFen)) continue;
    if (candidates.has(nFen)) continue;
    if (!row.san) continue;

    const fenParts = row.fen.split(" ");
    const moveNumber =
      fenParts.length >= 6 ? parseInt(fenParts[5], 10) || undefined : undefined;

    candidates.set(nFen, {
      san: "",
      correctSan: row.san,
      totalCpLoss: 0,
      occurrences: 1,
      source: "repertoire",
      date: null,
      moveNumber,
    });
  }

  // ---------- Phase filter ----------
  if (phaseParam !== "all") {
    for (const [fen, cand] of [...candidates.entries()]) {
      const moveNum =
        cand.moveNumber ??
        (parseInt(fen.split(" ")[5] ?? "1", 10) || 1);
      if (phaseParam === "opening" && moveNum > 35) candidates.delete(fen);
      if (phaseParam === "endgame" && moveNum <= 35) candidates.delete(fen);
    }
  }

  // ---------- countOnly: return counts without scoring ----------
  if (countOnly) {
    let blunders = 0,
      deviations = 0,
      review = 0;
    for (const cand of candidates.values()) {
      if (!cand.correctSan || !cand.correctSan.trim()) continue;
      if (cand.source === "blunder") blunders++;
      else if (cand.source === "deviation") deviations++;
      else if (cand.source === "review") review++;
      // "repertoire" positions are fill — not counted in actionable backlog
    }
    return Response.json({
      blunders,
      deviations,
      review,
      total: blunders + deviations + review,
    });
  }

  // ---------- Score all candidates ----------

  // Pre-load progress data for familiarity
  const allProgress = db
    .query(
      "SELECT fen, correct_attempts, streak, total_attempts FROM progress WHERE repertoire_id = ?",
    )
    .all(repertoireId) as any[];
  const progressMap = new Map<
    string,
    { correct: number; streak: number; total: number }
  >();
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
    const moves = parseAnalysisJson(game.analysis_json, game.id);
    if (!moves) continue;
    const positions = gamePositionsMap.get(game.id) ?? [];

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

    const phase = derivePhase(cand.moveNumber);
    // Effective cpLoss: average severity scaled by frequency
    // A position blundered 3x at 0.6 (effectiveCpLoss=0.83) outscores 1x at 1.0 (effectiveCpLoss=0.69)
    const avgCpLoss =
      cand.occurrences > 0
        ? cand.totalCpLoss / cand.occurrences
        : cand.totalCpLoss;
    const effectiveCpLoss = avgCpLoss * Math.log(1 + cand.occurrences);
    const score = scorePosition(
      effectiveCpLoss,
      cand.date,
      fenOccurrences,
      correctDrills,
      everDrilled,
      lastDrillCorrect,
      phase,
    );

    const positionFen = ensureFullFen(cand.fullFen ?? fen);
    const pattern = classifyPattern(positionFen, cand.correctSan, cand.moveNumber);

    scored.push({
      fen: positionFen,
      san: cand.san,
      correctSan: cand.correctSan,
      cpLoss: avgCpLoss,
      score,
      source: cand.source,
      gameId: cand.gameId,
      moveNumber: cand.moveNumber,
      context: cand.context,
      phase,
      firstEncounter: !everDrilled,
      pattern,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // Only return positions where we know the correct answer
  const valid = scored.filter(
    (p) => p.correctSan && p.correctSan.trim().length > 0,
  );

  // Add small random jitter to top candidates so each session has some variety.
  // Only jitter among candidates within the top score tier (score > 50% of top score).
  const topScore = valid[0]?.score ?? 1;
  const tierCutoff = topScore * 0.5;
  const tierPositions = valid.filter((p) => p.score >= tierCutoff);
  const belowTier = valid.filter((p) => p.score < tierCutoff);
  // Fisher-Yates shuffle within tier for variety
  for (let i = tierPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tierPositions[i], tierPositions[j]] = [tierPositions[j], tierPositions[i]];
  }
  // Re-sort tier by score (stable within random order), keep high scores first overall
  tierPositions.sort((a, b) => b.score - a.score);
  const shuffledValid = [...tierPositions, ...belowTier];

  // ---------- Enforce session composition (blunders first, then deviation, then review) ----------
  const SESSION_SIZE = 12;
  const blunders = shuffledValid.filter((p) => p.source === "blunder");
  const deviationsList = shuffledValid.filter((p) => p.source === "deviation");
  const reviewList = shuffledValid.filter((p) => p.source === "review");

  const session: TrainPosition[] = [];

  // Reserve 2 slots for deviations, 2 for review
  const topDeviations = deviationsList.splice(0, 2);
  const topReviews = reviewList.splice(0, 2);

  // Fill blunder slots
  const blunderSlots = Math.min(
    blunders.length,
    SESSION_SIZE - topDeviations.length - topReviews.length,
  );
  session.push(...blunders.slice(0, blunderSlots));

  // Add the reserved deviations and reviews
  session.push(...topDeviations);
  session.push(...topReviews);

  // If we still have room (some source didn't have enough), fill from remaining highest-scored
  if (session.length < SESSION_SIZE) {
    const usedFens = new Set(session.map((p) => p.fen));
    const remaining = shuffledValid.filter((p) => !usedFens.has(p.fen));
    session.push(...remaining.slice(0, SESSION_SIZE - session.length));
  }

  // Order: blunders first, then deviations, then review.
  // Within each source group, cluster by pattern so similar themes are adjacent
  // (Woodpecker Method: repeated exposure to the same motif in one session aids recognition).
  const sourceOrder = { blunder: 0, deviation: 1, review: 2, repertoire: 3 };
  const patternOrder: Record<TacticalPattern, number> = {
    "back-rank": 0,
    "fork": 1,
    "pin": 2,
    "discovered-attack": 3,
    "promotion": 4,
    "endgame": 5,
    "opening": 6,
    "middlegame": 7,
    "other": 8,
  };
  session.sort((a, b) => {
    const srcDiff = sourceOrder[a.source] - sourceOrder[b.source];
    if (srcDiff !== 0) return srcDiff;
    const pA = a.pattern ?? "other";
    const pB = b.pattern ?? "other";
    return (patternOrder[pA] ?? 8) - (patternOrder[pB] ?? 8);
  });

  console.log(
    `[trainNow] returning ${session.length} positions for rep ${repertoireId}`,
  );
  return Response.json({ positions: session });
}
