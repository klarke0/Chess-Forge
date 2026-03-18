import db from "../db";

export async function createSession(req: Request): Promise<Response> {
  const body = await req.json() as { repertoireId: number };

  if (!body.repertoireId) {
    return Response.json({ error: "repertoireId is required" }, { status: 400 });
  }

  const result = db.prepare(
    "INSERT INTO sessions (repertoire_id) VALUES (?)"
  ).run(body.repertoireId);

  return Response.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
}

export async function endSession(req: Request, sessionId: number): Promise<Response> {
  const body = await req.json() as {
    positionsDrilled?: number;
    correctCount?: number;
    mistakeCount?: number;
  };

  const session = db.query("SELECT id FROM sessions WHERE id = ?").get(sessionId);
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });

  db.prepare(
    `UPDATE sessions SET
      ended_at = datetime('now'),
      positions_drilled = COALESCE(?, positions_drilled),
      correct_count = COALESCE(?, correct_count),
      mistake_count = COALESCE(?, mistake_count)
     WHERE id = ?`
  ).run(body.positionsDrilled ?? null, body.correctCount ?? null, body.mistakeCount ?? null, sessionId);

  return Response.json({ ok: true });
}

export function listSessions(repertoireId?: number): Response {
  let rows;
  if (repertoireId) {
    rows = db.query(
      `SELECT id, repertoire_id, started_at, ended_at,
              positions_drilled, correct_count, mistake_count
       FROM sessions WHERE repertoire_id = ? ORDER BY started_at DESC LIMIT 50`
    ).all(repertoireId);
  } else {
    rows = db.query(
      `SELECT id, repertoire_id, started_at, ended_at,
              positions_drilled, correct_count, mistake_count
       FROM sessions ORDER BY started_at DESC LIMIT 50`
    ).all();
  }

  return Response.json(rows);
}
