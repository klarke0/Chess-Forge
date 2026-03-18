import db from "../db";

/** Strip halfmove clock + fullmove number so transpositions map to the same key. */
function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function getProgress(repertoireId: number): Response {
  const rows = db.query(
    `SELECT fen, total_attempts, correct_attempts, streak,
            ease_factor, interval_days, next_review, last_reviewed
     FROM progress WHERE repertoire_id = ?`
  ).all(repertoireId);

  return Response.json(rows);
}

export async function recordAttempt(req: Request): Promise<Response> {
  const body = await req.json() as {
    repertoireId: number;
    fen: string;
    correct: boolean;
    grade?: number;
    easeFactor?: number;
    intervalDays?: number;
    nextReview?: string;
  };

  if (!body.repertoireId || !body.fen || body.correct === undefined) {
    return Response.json({ error: "repertoireId, fen, and correct are required" }, { status: 400 });
  }

  const fen = normalizeFen(body.fen);
  const now = new Date().toISOString();

  // Upsert progress row
  const existing = db.query(
    "SELECT * FROM progress WHERE repertoire_id = ? AND fen = ?"
  ).get(body.repertoireId, fen) as any;

  if (!existing) {
    db.prepare(
      `INSERT INTO progress (repertoire_id, fen, total_attempts, correct_attempts, streak, last_reviewed)
       VALUES (?, ?, 1, ?, ?, ?)`
    ).run(body.repertoireId, fen, body.correct ? 1 : 0, body.correct ? 1 : 0, now);
  } else {
    const newStreak = body.correct ? existing.streak + 1 : 0;
    const newCorrect = existing.correct_attempts + (body.correct ? 1 : 0);

    // If frontend sends pre-computed SM-2, trust it; skip server scheduling
    if (body.grade !== undefined && body.easeFactor !== undefined && body.nextReview !== undefined) {
      db.prepare(
        `UPDATE progress SET total_attempts=total_attempts+1, correct_attempts=?,
          streak=?, ease_factor=?, interval_days=?, next_review=?, last_reviewed=?
          WHERE repertoire_id=? AND fen=?`
      ).run(newCorrect, newStreak, body.easeFactor, body.intervalDays ?? 0, body.nextReview, now, body.repertoireId, fen);
    } else {
      // Legacy server-side scheduling
      let easeFactor = existing.ease_factor;
      let interval = existing.interval_days;

      if (body.correct) {
        if (newStreak === 1) interval = 1;
        else if (newStreak === 2) interval = 6;
        else interval = Math.round(interval * easeFactor);
        easeFactor = Math.max(1.3, easeFactor + 0.1); // grade-5 equivalent: reward correct answers
      } else {
        interval = 0;
        easeFactor = Math.max(1.3, easeFactor - 0.2);
      }

      const nextReview = new Date(Date.now() + interval * 86400000).toISOString();

      db.prepare(
        `UPDATE progress SET
          total_attempts = total_attempts + 1,
          correct_attempts = ?,
          streak = ?,
          ease_factor = ?,
          interval_days = ?,
          next_review = ?,
          last_reviewed = ?
         WHERE repertoire_id = ? AND fen = ?`
      ).run(newCorrect, newStreak, easeFactor, interval, nextReview, now, body.repertoireId, fen);
    }
  }

  return Response.json({ ok: true });
}

export function getWeakPositions(repertoireId: number): Response {
  const rows = db.query(
    `SELECT fen, total_attempts, correct_attempts, streak,
            CASE WHEN total_attempts > 0
              THEN CAST(correct_attempts AS REAL) / total_attempts
              ELSE 0 END as accuracy
     FROM progress
     WHERE repertoire_id = ? AND total_attempts >= 2
     ORDER BY accuracy ASC, total_attempts DESC
     LIMIT 50`
  ).all(repertoireId);

  return Response.json(rows);
}

export function getDuePositions(repertoireId: number | 'all'): Response {
  const now = new Date().toISOString();

  if (repertoireId === 'all') {
    const rawRows = db.query(
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
       LIMIT 200`
    ).all(now) as any[];

    const rows = rawRows.map(row => ({
      ...row,
      expected_moves: JSON.parse(row.expected_moves || '[]').filter(Boolean)
    }));

    return Response.json(rows);
  }

  const rows = db.query(
    `SELECT fen, total_attempts, correct_attempts, streak,
            ease_factor, interval_days, next_review
     FROM progress
     WHERE repertoire_id = ? AND (next_review IS NULL OR next_review <= ?)
     ORDER BY next_review ASC
     LIMIT 100`
  ).all(repertoireId, now);

  return Response.json(rows);
}

export function getProgressStats(repertoireId: number): Response {
  const now = new Date().toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const totalTracked = (db.query(
    'SELECT COUNT(*) as c FROM progress WHERE repertoire_id = ?'
  ).get(repertoireId) as any).c as number;

  const mastered = (db.query(
    'SELECT COUNT(*) as c FROM progress WHERE repertoire_id = ? AND streak >= 3'
  ).get(repertoireId) as any).c as number;

  const dueToday = (db.query(
    'SELECT COUNT(*) as c FROM progress WHERE repertoire_id = ? AND (next_review IS NULL OR next_review <= ?)'
  ).get(repertoireId, now) as any).c as number;

  const weeklyRow = db.query(
    'SELECT AVG(CAST(correct_attempts AS REAL) / NULLIF(total_attempts, 0)) as acc FROM progress WHERE repertoire_id = ? AND last_reviewed >= ?'
  ).get(repertoireId, sevenDaysAgo) as any;
  const weeklyAccuracy: number = weeklyRow?.acc ?? 0;

  const streak = (db.query(
    'SELECT COUNT(DISTINCT date(last_reviewed)) as c FROM progress WHERE repertoire_id = ? AND last_reviewed >= ?'
  ).get(repertoireId, sevenDaysAgo) as any).c as number;

  return Response.json({ totalTracked, mastered, dueToday, weeklyAccuracy, streak });
}
