import db from "../db";
import { normalizeFen } from "../utils/fen";

export async function dismissPosition(req: Request): Promise<Response> {
  let body: { fen: string; repertoireId: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body.fen || !body.repertoireId) {
    return Response.json(
      { error: "fen and repertoireId required" },
      { status: 400 },
    );
  }

  const nFen = normalizeFen(body.fen);

  db.query(
    `INSERT OR REPLACE INTO dismissed_positions (fen, repertoire_id, reason)
     VALUES (?, ?, ?)`,
  ).run(nFen, body.repertoireId, body.reason ?? "challenged");

  return Response.json({ ok: true });
}
