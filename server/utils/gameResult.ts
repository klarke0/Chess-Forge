import type { Database } from "bun:sqlite";

/**
 * `games.result`: how the game went for the USER (Kevin), never for white/black.
 * GamesTab filters, insights and the review header all read exactly these three.
 *
 * Pure module — no import of ../db — so the backfill script can use it without
 * opening (or migrating) the live database as a side effect.
 */
export type UserResult = "win" | "loss" | "draw";

/**
 * chess.com's per-player result codes (public games API). The code describes
 * what happened to THAT player: "win", one of the loser codes, or a draw code.
 */
const LOSS_CODES = new Set([
  "checkmated",
  "timeout",
  "resigned",
  "lose",
  "abandoned",
  "kingofthehill", // the opponent's king reached the hill
  "threecheck", // the opponent delivered the third check
  "bughousepartnerlose",
]);
const DRAW_CODES = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

const norm = (code: string | null | undefined): string => (code ?? "").trim().toLowerCase();

/** The user's result implied by ONE player's code, or null when the code is unknown/missing. */
function classifyCode(code: string | null | undefined): UserResult | null {
  const c = norm(code);
  if (c === "win") return "win";
  if (LOSS_CODES.has(c)) return "loss";
  if (DRAW_CODES.has(c)) return "draw";
  return null;
}

/** The user's result implied by the OPPONENT's code (their win is our loss, and so on). */
function fromOpponentCode(code: string | null | undefined): UserResult | null {
  const r = classifyCode(code);
  return r === "win" ? "loss" : r === "loss" ? "win" : r;
}

/**
 * The user's result from chess.com's codes for the user (`myResult`) and the
 * opponent. The user's own code decides; an unknown or missing one falls back to
 * the opponent's (a decisive game has exactly one "win"); with nothing usable
 * it is a draw.
 */
export function mapChessComResult(
  myResult: string | null | undefined,
  opponentResult?: string | null,
): UserResult {
  return classifyCode(myResult) ?? fromOpponentCode(opponentResult) ?? "draw";
}

function pgnTag(pgn: string, tag: string): string | null {
  const m = pgn.match(new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`));
  return m ? m[1] : null;
}

/**
 * The user's result from the PGN's `[Result]` header and the colour they
 * played. null (undetermined) for a missing/unfinished/unknown result — which is
 * NOT the same as a draw.
 */
export function resultFromPgn(pgn: string | null | undefined, userColor: string | null | undefined): UserResult | null {
  if (!pgn || (userColor !== "white" && userColor !== "black")) return null;
  const header = pgnTag(pgn, "Result")?.trim();
  if (header === "1/2-1/2") return "draw";
  if (header === "1-0") return userColor === "white" ? "win" : "loss";
  if (header === "0-1") return userColor === "black" ? "win" : "loss";
  return null;
}

/**
 * Fallback for a PGN whose Result header is unusable: chess.com's Termination
 * text ("kevin won by resignation", "Game drawn by repetition", ...).
 */
export function resultFromTermination(
  termination: string | null | undefined,
  userName: string | null | undefined,
  opponentName: string | null | undefined,
): UserResult | null {
  if (!termination) return null;
  if (/\bdrawn\b/i.test(termination)) return "draw";
  const m = termination.match(/^(\S+)\s+won\b/i);
  if (!m) return null;
  const winner = m[1].toLowerCase();
  if (userName && winner === userName.toLowerCase()) return "win";
  if (opponentName && winner === opponentName.toLowerCase()) return "loss";
  return null;
}

export interface ResultSourceRow {
  user_color: string | null;
  pgn: string | null;
  white_username: string | null;
  black_username: string | null;
  white_result: string | null;
  black_result: string | null;
}

/** chess.com's stored codes for this row, as the user's result — null when neither code is known. */
function resultFromStoredCodes(row: ResultSourceRow): UserResult | null {
  if (row.user_color !== "white" && row.user_color !== "black") return null;
  const mine = row.user_color === "white" ? row.white_result : row.black_result;
  const theirs = row.user_color === "white" ? row.black_result : row.white_result;
  return classifyCode(mine) ?? fromOpponentCode(theirs);
}

/**
 * Recompute a stored game's result without chess.com: the PGN Result header
 * first, then the Termination text, then the stored chess.com codes.
 */
export function recomputeResult(row: ResultSourceRow): {
  result: UserResult | null;
  source: "pgn" | "termination" | "chesscom" | null;
} {
  const fromPgn = resultFromPgn(row.pgn, row.user_color);
  if (fromPgn) return { result: fromPgn, source: "pgn" };

  if (row.pgn && (row.user_color === "white" || row.user_color === "black")) {
    const user = row.user_color === "white" ? row.white_username : row.black_username;
    const opp = row.user_color === "white" ? row.black_username : row.white_username;
    const fromTerm = resultFromTermination(pgnTag(row.pgn, "Termination"), user, opp);
    if (fromTerm) return { result: fromTerm, source: "termination" };
  }

  const fromCodes = resultFromStoredCodes(row);
  if (fromCodes) return { result: fromCodes, source: "chesscom" };
  return { result: null, source: null };
}

// ---------------------------------------------------------------------------
// Backfill: find and fix games whose stored result disagrees with the recomputed one
// ---------------------------------------------------------------------------

export interface ResultChange {
  id: number;
  from: string | null;
  to: UserResult;
  source: "pgn" | "termination" | "chesscom";
}

export interface ResultBackfillPlan {
  total: number;
  /** Stored result already equals the recomputed one. */
  unchanged: number;
  /** Nothing usable to recompute from; left as is. */
  undetermined: number;
  changes: ResultChange[];
  /** "draw->loss": count. */
  transitions: Record<string, number>;
  /** Rows where the PGN and chess.com's stored codes could both be read: how many, and how many disagreed. */
  crossCheck: { compared: number; mismatches: number };
}

/** Read-only: what a backfill would change. */
export function planResultBackfill(db: Database): ResultBackfillPlan {
  const rows = db
    .query(
      `SELECT id, result, user_color, pgn, white_username, black_username, white_result, black_result
       FROM games ORDER BY id`,
    )
    .all() as (ResultSourceRow & { id: number; result: string | null })[];

  const plan: ResultBackfillPlan = {
    total: rows.length,
    unchanged: 0,
    undetermined: 0,
    changes: [],
    transitions: {},
    crossCheck: { compared: 0, mismatches: 0 },
  };

  for (const row of rows) {
    const pgnResult = resultFromPgn(row.pgn, row.user_color);
    const codeResult = resultFromStoredCodes(row);
    if (pgnResult && codeResult) {
      plan.crossCheck.compared++;
      if (pgnResult !== codeResult) plan.crossCheck.mismatches++;
    }

    const { result, source } = recomputeResult(row);
    if (!result || !source) {
      plan.undetermined++;
    } else if (result === row.result) {
      plan.unchanged++;
    } else {
      plan.changes.push({ id: row.id, from: row.result, to: result, source });
      const key = `${row.result ?? "null"}->${result}`;
      plan.transitions[key] = (plan.transitions[key] ?? 0) + 1;
    }
  }
  return plan;
}

/**
 * Write the planned changes in ONE transaction (all or nothing). A row whose
 * stored result changed since the plan was made is left alone. Returns the
 * number of rows actually updated.
 */
export function applyResultBackfill(db: Database, changes: ResultChange[]): number {
  const update = db.prepare(`UPDATE games SET result = ? WHERE id = ? AND result IS ?`);
  let updated = 0;
  db.transaction(() => {
    for (const c of changes) updated += Number(update.run(c.to, c.id, c.from).changes);
  })();
  return updated;
}
