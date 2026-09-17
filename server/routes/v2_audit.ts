import db from "../db";
import { ok, err } from "../utils/response";
import { startBookSweep, sweepStatus } from "../services/audit_sweep";
import { mastersVerdict } from "../utils/audit";

type MastersCounts = { moveGames: number; totalGames: number } | null;

/** 4-field FEN → the 6-field form lichess expects. */
function ensureFullFen(fen: string): string {
  return fen.split(" ").length >= 6 ? fen : `${fen} 0 1`;
}

async function fetchMastersDefault(
  fen: string,
  san: string,
): Promise<MastersCounts> {
  try {
    const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(ensureFullFen(fen))}&moves=12&topGames=0`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      white: number; draws: number; black: number;
      moves: { san: string; white: number; draws: number; black: number }[];
    };
    const totalGames = data.white + data.draws + data.black;
    const mv = data.moves.find((m) => m.san === san);
    const moveGames = mv ? mv.white + mv.draws + mv.black : 0;
    return { moveGames, totalGames };
  } catch {
    return null;
  }
}

export async function tiebreakGrayRows(
  repertoireId: number,
  fetchMasters?: (fen: string) => Promise<MastersCounts>,
): Promise<{ resolved: number; okMasters: number; flagged: number }> {
  const rows = db
    .query(
      "SELECT fen, san FROM book_audit WHERE repertoire_id = ? AND verdict = 'gray'",
    )
    .all(repertoireId) as { fen: string; san: string }[];

  const out = { resolved: 0, okMasters: 0, flagged: 0 };
  for (const r of rows) {
    const counts = fetchMasters
      ? await fetchMasters(r.fen)
      : await fetchMastersDefault(r.fen, r.san);
    if (!fetchMasters)
      await new Promise((res) => setTimeout(res, 1100)); // explorer rate courtesy
    if (!counts) continue; // unreachable — stay gray, retry later
    const v = mastersVerdict(counts.moveGames, counts.totalGames);
    db.query(
      `UPDATE book_audit SET verdict = ?, masters_move_games = ?, masters_total_games = ?
       WHERE repertoire_id = ? AND fen = ? AND san = ?`,
    ).run(v, counts.moveGames, counts.totalGames, repertoireId, r.fen, r.san);
    out.resolved++;
    if (v === "ok_masters") out.okMasters++;
    else out.flagged++;
  }
  return out;
}

export async function auditSweepRoute(req: Request): Promise<Response> {
  const body = (await req.json()) as { repertoireId?: number; depth?: number };
  if (!body.repertoireId) return err("repertoireId required", 400);
  const r = startBookSweep(body.repertoireId, body.depth ?? 14);
  return r.started ? ok(r) : err(r.reason ?? "could not start", 409);
}

export function auditStatusRoute(): Response {
  const counts = db
    .query(
      `SELECT verdict, COUNT(*) as c FROM book_audit GROUP BY verdict`,
    )
    .all() as { verdict: string; c: number }[];
  return ok({ sweep: sweepStatus(), verdicts: counts });
}

export async function auditTiebreakRoute(req: Request): Promise<Response> {
  const body = (await req.json()) as { repertoireId?: number };
  if (!body.repertoireId) return err("repertoireId required", 400);
  return ok(await tiebreakGrayRows(body.repertoireId));
}

export function auditReportRoute(url: URL): Response {
  const repertoireId = parseInt(url.searchParams.get("repertoireId") ?? "", 10);
  if (!repertoireId) return err("repertoireId required", 400);
  const pull = (verdict: string) =>
    db
      .query(
        `SELECT a.fen, a.san, a.loss_cp, a.best_uci, a.pv_uci, a.verdict,
                a.masters_move_games, p.comment
         FROM book_audit a
         LEFT JOIN positions p
           ON p.repertoire_id = a.repertoire_id AND p.fen = a.fen AND p.san = a.san
         WHERE a.repertoire_id = ? AND a.verdict = ?
         ORDER BY a.loss_cp DESC`,
      )
      .all(repertoireId, verdict);
  return ok({ flagged: pull("flagged"), gray: pull("gray") });
}
