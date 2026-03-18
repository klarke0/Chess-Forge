import db from "../db";

export function listRepertoires(): Response {
  const rows = db.query("SELECT id, name, description, side, created_at, updated_at FROM repertoires").all();
  return Response.json(rows);
}

export function getPositions(repertoireId: number): Response {
  const repertoire = db.query("SELECT id FROM repertoires WHERE id = ?").get(repertoireId);
  if (!repertoire) return Response.json({ error: "Repertoire not found" }, { status: 404 });

  const rows = db.query(
    "SELECT fen, san, next_fen, comment FROM positions WHERE repertoire_id = ?"
  ).all(repertoireId) as Array<{ fen: string; san: string; next_fen: string; comment: string | null }>;

  // Group by FEN to match the frontend's expected format
  const positions: Record<string, Array<{ san: string; nextFen: string; comment?: string }>> = {};
  for (const row of rows) {
    const normalizedFen = normalizeFenKey(row.fen);
    if (!positions[normalizedFen]) positions[normalizedFen] = [];
    positions[normalizedFen].push({
      san: row.san,
      nextFen: row.next_fen,
      ...(row.comment ? { comment: row.comment } : {}),
    });
  }

  return Response.json(positions);
}

export function getChapters(repertoireId: number): Response {
  const repertoire = db.query("SELECT id FROM repertoires WHERE id = ?").get(repertoireId);
  if (!repertoire) return Response.json({ error: "Repertoire not found" }, { status: 404 });

  const rows = db.query(
    "SELECT id, name, sort_order, start_moves, first_fen, learn_runs FROM chapters WHERE repertoire_id = ? ORDER BY sort_order"
  ).all(repertoireId) as Array<{ id: number; name: string; sort_order: number; start_moves: string; first_fen: string; learn_runs: number }>;

  const chapters = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sortOrder: r.sort_order,
    startMoves: JSON.parse(r.start_moves),
    firstFen: r.first_fen,
    learnRuns: r.learn_runs,
  }));

  return Response.json(chapters);
}

export async function updateChapterLearnRuns(req: Request, chapterId: number): Promise<Response> {
  const body = await req.json() as { learnRuns: number };
  if (typeof body.learnRuns !== 'number') {
    return Response.json({ error: "learnRuns must be a number" }, { status: 400 });
  }
  db.prepare("UPDATE chapters SET learn_runs = MAX(learn_runs, ?) WHERE id = ?").run(body.learnRuns, chapterId);
  return Response.json({ ok: true });
}

/** Normalize FEN to 4 fields for consistent DB storage. */
function normalizeFenKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export async function addPosition(req: Request, repertoireId: number): Promise<Response> {
  const repertoire = db.query("SELECT id FROM repertoires WHERE id = ?").get(repertoireId);
  if (!repertoire) return Response.json({ error: "Repertoire not found" }, { status: 404 });

  const body = await req.json() as { fen: string, san: string, nextFen: string, comment?: string };
  if (!body.fen || !body.san || !body.nextFen) {
    return Response.json({ error: "fen, san, and nextFen are required" }, { status: 400 });
  }

  const normalizedFen = normalizeFenKey(body.fen);
  const normalizedNextFen = normalizeFenKey(body.nextFen);

  try {
    const insertPosition = db.prepare(
      `INSERT INTO positions (repertoire_id, fen, san, next_fen, comment) 
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(repertoire_id, fen, san) DO UPDATE SET comment = excluded.comment`
    );
    insertPosition.run(repertoireId, normalizedFen, body.san, normalizedNextFen, body.comment || null);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function importPgn(req: Request): Promise<Response> {
  const body = await req.json() as {
    name: string;
    side?: 'white' | 'black';
    pgn?: string;
    chapters?: any[];
    positions?: Record<string, any[]>;
  };

  if (!body.name) {
    return Response.json({ error: "name is required" }, { status: 400 });
  }

  if (!body.positions) {
    return Response.json({ error: "positions object is required" }, { status: 400 });
  }

  const side = body.side ?? 'white';

  const insertRepertoire = db.prepare(
    "INSERT INTO repertoires (name, description, side) VALUES (?, ?, ?)"
  );
  const insertChapter = db.prepare(
    "INSERT INTO chapters (repertoire_id, name, sort_order, start_moves, first_fen) VALUES (?, ?, ?, ?, ?)"
  );
  const insertPosition = db.prepare(
    "INSERT OR IGNORE INTO positions (repertoire_id, fen, san, next_fen, comment) VALUES (?, ?, ?, ?, ?)"
  );

  const result = db.transaction(() => {
    const res = insertRepertoire.run(body.name, null, side);
    const repertoireId = Number(res.lastInsertRowid);

    if (body.chapters) {
      for (let i = 0; i < body.chapters.length; i++) {
        const ch = body.chapters[i];
        insertChapter.run(
          repertoireId,
          ch.name,
          i,
          JSON.stringify(ch.startMoves ?? []),
          ch.firstFen ?? ""
        );
      }
    }

    let posCount = 0;
    for (const [fen, moves] of Object.entries(body.positions)) {
      const normalizedFen = normalizeFenKey(fen);
      for (const move of moves as any[]) {
        insertPosition.run(repertoireId, normalizedFen, move.san, move.nextFen, move.comment ?? null);
        posCount++;
      }
    }

    return { repertoireId, positionCount: posCount };
  })();

  return Response.json(result, { status: 201 });
}
