import db from "../db";
import { computeSM2 } from "../utils/sm2";
import { normalizeFen } from "../utils/fen";

export function getProgress(repertoireId: number): Response {
  const rows = db
    .query(
      `SELECT fen, total_attempts, correct_attempts, streak,
            ease_factor, interval_days, next_review, last_reviewed
     FROM progress WHERE repertoire_id = ?`,
    )
    .all(repertoireId);

  return Response.json(rows);
}

function initialEaseFactor(source?: string, cpLoss?: number): number {
  if (source === "blunder") {
    if (cpLoss !== undefined && cpLoss > 2) return 1.3;
    if (cpLoss !== undefined && cpLoss >= 1) return 1.8;
    return 1.8;
  }
  if (source === "deviation") return 2.0;
  if (source === "punish") return 2.0;
  return 2.5; // review or unknown
}

type AttemptBody = {
  repertoireId: number;
  fen: string;
  correct: boolean;
  grade?: number;
  easeFactor?: number;
  intervalDays?: number;
  nextReview?: string;
  source?: string;
  cpLoss?: number;
  /** Client-generated id; a repeat within RECENT_ATTEMPT_TTL_MS is ignored. */
  attemptId?: string;
};

// Replay guard: a retried or duplicated POST must not count twice (it would
// inflate total_attempts and push SM-2 further). In-memory is enough — the
// window only has to cover client retries, and a restart just forgets it.
const RECENT_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const recentAttemptIds = new Map<string, number>();

function seenRecently(attemptId: string): boolean {
  const nowMs = Date.now();
  for (const [id, at] of recentAttemptIds) {
    if (nowMs - at > RECENT_ATTEMPT_TTL_MS) recentAttemptIds.delete(id);
    else break; // Map iterates in insertion order, so the rest are newer
  }
  if (recentAttemptIds.has(attemptId)) return true;
  recentAttemptIds.set(attemptId, nowMs);
  return false;
}

export async function recordAttempt(req: Request): Promise<Response> {
  let body: AttemptBody;
  try {
    body = (await req.json()) as AttemptBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    !Number.isInteger(body.repertoireId) ||
    body.repertoireId <= 0 ||
    typeof body.fen !== "string" ||
    body.fen.length === 0 ||
    body.fen.length > 200 ||
    typeof body.correct !== "boolean"
  ) {
    return Response.json(
      {
        error:
          "repertoireId (positive integer), fen (string), and correct (boolean) are required",
      },
      { status: 400 },
    );
  }
  if (
    body.grade !== undefined &&
    (!Number.isInteger(body.grade) || body.grade < 0 || body.grade > 5)
  ) {
    return Response.json(
      { error: "grade must be an integer 0-5" },
      { status: 400 },
    );
  }
  if (
    body.attemptId !== undefined &&
    (typeof body.attemptId !== "string" || body.attemptId.length > 64)
  ) {
    return Response.json({ error: "Invalid attemptId" }, { status: 400 });
  }

  const repertoire = db
    .query("SELECT 1 FROM repertoires WHERE id = ?")
    .get(body.repertoireId);
  if (!repertoire) {
    return Response.json({ error: "Repertoire not found" }, { status: 404 });
  }

  if (body.attemptId && seenRecently(body.attemptId)) {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    applyAttempt(body);
  } catch (e) {
    console.error("[recordAttempt] failed:", e);
    return Response.json({ error: "Failed to record attempt" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

function applyAttempt(body: AttemptBody): void {
  const fen = normalizeFen(body.fen);
  const now = new Date().toISOString();

  // Upsert progress row
  const existing = db
    .query("SELECT * FROM progress WHERE repertoire_id = ? AND fen = ?")
    .get(body.repertoireId, fen) as any;

  if (!existing) {
    // v2: if grade is provided, compute SM-2 for the initial row
    if (body.grade !== undefined) {
      const initEF = initialEaseFactor(body.source, body.cpLoss);
      const sm2 = computeSM2(
        { easeFactor: initEF, intervalDays: 0, repetitions: 0 },
        body.grade,
      );
      db.prepare(
        `INSERT INTO progress (repertoire_id, fen, total_attempts, correct_attempts, streak,
          ease_factor, interval_days, next_review, last_reviewed)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      ).run(
        body.repertoireId,
        fen,
        body.correct ? 1 : 0,
        body.correct ? 1 : 0,
        sm2.nextEaseFactor,
        sm2.nextIntervalDays,
        sm2.nextReviewDate,
        now,
      );
    } else {
      db.prepare(
        `INSERT INTO progress (repertoire_id, fen, total_attempts, correct_attempts, streak, last_reviewed)
         VALUES (?, ?, 1, ?, ?, ?)`,
      ).run(
        body.repertoireId,
        fen,
        body.correct ? 1 : 0,
        body.correct ? 1 : 0,
        now,
      );
    }
  } else {
    const newStreak = body.correct ? existing.streak + 1 : 0;
    const newCorrect = existing.correct_attempts + (body.correct ? 1 : 0);

    // Server always computes scheduling from the grade. Client-sent
    // easeFactor/intervalDays/nextReview are deliberately ignored: trusting
    // them bypasses the 30-day interval cap (the client sm2 mirror drifted
    // uncapped) and reopens the drill-pool starvation documented in
    // CLAUDE.md "Drill pool freshness".
    if (body.grade !== undefined) {
      const sm2 = computeSM2(
        {
          easeFactor: existing.ease_factor,
          intervalDays: existing.interval_days,
          repetitions: existing.streak,
        },
        body.grade,
      );
      db.prepare(
        `UPDATE progress SET total_attempts=total_attempts+1, correct_attempts=?,
          streak=?, ease_factor=?, interval_days=?, next_review=?, last_reviewed=?
          WHERE repertoire_id=? AND fen=?`,
      ).run(
        newCorrect,
        newStreak,
        sm2.nextEaseFactor,
        sm2.nextIntervalDays,
        sm2.nextReviewDate,
        now,
        body.repertoireId,
        fen,
      );
    } else {
      // Bool-only callers (legacy V1 path): derive a grade from `correct` and
      // route through the canonical SM-2 implementation so scheduling stays
      // consistent with the grade-aware paths above. Correct → grade 5
      // (perfect recall), incorrect → grade 1 (forgot, but did attempt).
      const derivedGrade = body.correct ? 5 : 1;
      const sm2 = computeSM2(
        {
          easeFactor: existing.ease_factor,
          intervalDays: existing.interval_days,
          repetitions: existing.streak,
        },
        derivedGrade,
      );
      db.prepare(
        `UPDATE progress SET
          total_attempts = total_attempts + 1,
          correct_attempts = ?,
          streak = ?,
          ease_factor = ?,
          interval_days = ?,
          next_review = ?,
          last_reviewed = ?
         WHERE repertoire_id = ? AND fen = ?`,
      ).run(
        newCorrect,
        newStreak,
        sm2.nextEaseFactor,
        sm2.nextIntervalDays,
        sm2.nextReviewDate,
        now,
        body.repertoireId,
        fen,
      );
    }
  }

}

export function getWeakPositions(repertoireId: number): Response {
  const rows = db
    .query(
      `SELECT fen, total_attempts, correct_attempts, streak,
            CASE WHEN total_attempts > 0
              THEN CAST(correct_attempts AS REAL) / total_attempts
              ELSE 0 END as accuracy
     FROM progress
     WHERE repertoire_id = ? AND total_attempts >= 2
     ORDER BY accuracy ASC, total_attempts DESC
     LIMIT 50`,
    )
    .all(repertoireId);

  return Response.json(rows);
}

export function getDuePositions(repertoireId: number | "all"): Response {
  const now = new Date().toISOString();

  if (repertoireId === "all") {
    const rawRows = db
      .query(
        `SELECT p.fen, p.total_attempts, p.correct_attempts, p.streak,
              p.ease_factor, p.interval_days, p.next_review,
              r.side, r.name as repertoire_name, p.repertoire_id,
              json_group_array(pos.san) as expected_moves
       FROM progress p
       JOIN repertoires r ON p.repertoire_id = r.id
       LEFT JOIN positions pos ON p.fen = pos.fen AND p.repertoire_id = pos.repertoire_id
       WHERE (p.next_review IS NULL OR p.next_review <= ?)
       GROUP BY p.id
       ORDER BY p.next_review ASC
       LIMIT 200`,
      )
      .all(now) as any[];

    const rows = rawRows.map((row) => ({
      ...row,
      expected_moves: JSON.parse(row.expected_moves || "[]").filter(Boolean),
    }));

    return Response.json(rows);
  }

  const rows = db
    .query(
      `SELECT fen, total_attempts, correct_attempts, streak,
            ease_factor, interval_days, next_review
     FROM progress
     WHERE repertoire_id = ? AND (next_review IS NULL OR next_review <= ?)
     ORDER BY next_review ASC
     LIMIT 100`,
    )
    .all(repertoireId, now);

  return Response.json(rows);
}

export function getProgressStats(repertoireId: number): Response {
  const now = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const totalTracked = (
    db
      .query("SELECT COUNT(*) as c FROM progress WHERE repertoire_id = ?")
      .get(repertoireId) as any
  ).c as number;

  const mastered = (
    db
      .query(
        "SELECT COUNT(*) as c FROM progress WHERE repertoire_id = ? AND streak >= 3",
      )
      .get(repertoireId) as any
  ).c as number;

  const dueToday = (
    db
      .query(
        "SELECT COUNT(*) as c FROM progress WHERE repertoire_id = ? AND (next_review IS NULL OR next_review <= ?)",
      )
      .get(repertoireId, now) as any
  ).c as number;

  const weeklyRow = db
    .query(
      "SELECT AVG(CAST(correct_attempts AS REAL) / NULLIF(total_attempts, 0)) as acc FROM progress WHERE repertoire_id = ? AND last_reviewed >= ?",
    )
    .get(repertoireId, sevenDaysAgo) as any;
  const weeklyAccuracy: number = weeklyRow?.acc ?? 0;

  const lastReviewedRow = db
    .query(
      "SELECT MAX(last_reviewed) as lr FROM progress WHERE repertoire_id = ?",
    )
    .get(repertoireId) as any;
  const lastReviewed: string | null = lastReviewedRow?.lr ?? null;

  // Compute consecutive daily streak: count backward from today (or yesterday
  // if the user hasn't trained yet today) checking each calendar date.
  const distinctDays = (
    db
      .query(
        `SELECT DISTINCT date(last_reviewed) as d
         FROM progress
         WHERE repertoire_id = ?
         ORDER BY d DESC
         LIMIT 365`,
      )
      .all(repertoireId) as { d: string }[]
  ).map((r) => r.d);

  // Walk back from today; a gap breaks the streak.
  const todayStr = new Date().toISOString().slice(0, 10);
  let streak = 0;
  let cursor = todayStr;
  for (const day of distinctDays) {
    if (day === cursor) {
      streak++;
      // Advance cursor to yesterday
      const prev = new Date(cursor + "T12:00:00Z");
      prev.setUTCDate(prev.getUTCDate() - 1);
      cursor = prev.toISOString().slice(0, 10);
    } else if (day < cursor) {
      // Gap — streak is broken
      break;
    }
    // day > cursor means we haven't reached today's date yet (shouldn't happen
    // with ORDER BY d DESC, but skip gracefully)
  }

  // Daily goal: has the user reviewed at least 1 position today?
  const todayStart = todayStr + "T00:00:00.000Z";
  const dailyGoalDone = (
    db
      .query(
        `SELECT COUNT(*) as c FROM progress
         WHERE repertoire_id = ? AND last_reviewed >= ?`,
      )
      .get(repertoireId, todayStart) as any
  ).c as number > 0;

  return Response.json({
    totalTracked,
    mastered,
    dueToday,
    weeklyAccuracy,
    streak,
    lastReviewed,
    dailyGoalDone,
  });
}

export function getWeakestPosition(repertoireId: number): Response {
  const row = db
    .query(
      `SELECT p.fen, pos.san as correctSan,
              CAST(p.correct_attempts AS REAL) / NULLIF(p.total_attempts, 0) as accuracy
       FROM progress p
       LEFT JOIN positions pos ON pos.fen = p.fen
       WHERE p.repertoire_id = ?
         AND p.total_attempts >= 2
         AND pos.san IS NOT NULL
       ORDER BY accuracy ASC
       LIMIT 1`,
    )
    .get(repertoireId) as any;

  if (!row) return Response.json(null);
  return Response.json({
    fen: row.fen,
    correctSan: row.correctSan,
    accuracy: Math.round((row.accuracy ?? 0) * 100),
  });
}
