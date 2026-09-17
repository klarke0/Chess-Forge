import { Chess } from "chess.js";
import db from "../db";
import { NativeEngine, findStockfishBinary } from "./engine_native";
import type { EngineEval } from "./engine_native";
import { lossCp, engineVerdict } from "../utils/audit";
import { normalizeFen } from "../utils/fen";

export interface AuditRow {
  loss_cp: number;
  verdict: string;
  best_cp: number | null;
  played_cp: number | null;
  best_uci: string;
  pv_uci: string;
}

interface EvalSource {
  evaluate(fen: string, depth?: number): Promise<EngineEval>;
}

/** Audit a single (fen, san) book move. Exported for tests; engine injected. */
export async function sweepOne(
  engine: EvalSource,
  fullFen: string,
  san: string,
  depth: number,
): Promise<AuditRow> {
  const chess = new Chess(fullFen);
  let move;
  try {
    move = chess.move(san);
  } catch {
    move = null;
  }
  if (!move) throw new Error(`illegal SAN ${san} at ${fullFen}`);
  const best = await engine.evaluate(fullFen, depth);
  const after = await engine.evaluate(chess.fen(), depth);
  const loss = lossCp(best, after);
  return {
    loss_cp: loss,
    verdict: engineVerdict(loss),
    best_cp: best.cp,
    played_cp: after.cp,
    best_uci: best.bestMoveUci,
    pv_uci: best.pvUci.join(" "),
  };
}

// ---------- background sweep over the positions table ----------

const state = {
  running: false,
  repertoireId: null as number | null,
  done: 0,
  total: 0,
  flagged: 0,
  gray: 0,
  errors: 0,
};

export function sweepStatus() {
  return { ...state };
}

/**
 * The positions table stores 4-field FENs; chess.js needs 6. Book positions
 * are early-game so halfmove/fullmove counters barely affect eval at these
 * depths — appending "0 1" is fine.
 */
function ensureFullFen(fen: string): string {
  return fen.split(" ").length >= 6 ? fen : `${fen} 0 1`;
}

export function startBookSweep(
  repertoireId: number,
  depth = 14,
): { started: boolean; reason?: string } {
  if (state.running) return { started: false, reason: "sweep already running" };
  if (!findStockfishBinary())
    return { started: false, reason: "stockfish binary not found" };

  // Resumable: only rows not yet audited at ≥ this depth.
  const rows = db
    .query(
      `SELECT p.fen, p.san FROM positions p
       LEFT JOIN book_audit a
         ON a.repertoire_id = p.repertoire_id AND a.fen = p.fen AND a.san = p.san
        AND a.depth >= ?
       WHERE p.repertoire_id = ? AND a.fen IS NULL`,
    )
    .all(depth, repertoireId) as { fen: string; san: string }[];

  state.running = true;
  state.repertoireId = repertoireId;
  state.done = 0;
  state.total = rows.length;
  state.flagged = 0;
  state.gray = 0;
  state.errors = 0;

  // Fire-and-forget; status is polled.
  (async () => {
    const engine = new NativeEngine();
    const upsert = db.prepare(
      `INSERT INTO book_audit
         (repertoire_id, fen, san, depth, best_cp, played_cp, loss_cp, best_uci, pv_uci, verdict, swept_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(repertoire_id, fen, san) DO UPDATE SET
         depth = excluded.depth, best_cp = excluded.best_cp,
         played_cp = excluded.played_cp, loss_cp = excluded.loss_cp,
         best_uci = excluded.best_uci, pv_uci = excluded.pv_uci,
         verdict = excluded.verdict, swept_at = excluded.swept_at`,
    );
    try {
      for (const r of rows) {
        try {
          const row = await sweepOne(engine, ensureFullFen(r.fen), r.san, depth);
          upsert.run(
            repertoireId, normalizeFen(r.fen), r.san, depth,
            row.best_cp, row.played_cp, row.loss_cp,
            row.best_uci, row.pv_uci, row.verdict,
          );
          if (row.verdict === "flagged") state.flagged++;
          if (row.verdict === "gray") state.gray++;
        } catch (e) {
          state.errors++;
          console.error("[audit] sweep error at", r.fen, r.san, e);
        }
        state.done++;
      }
    } finally {
      engine.dispose();
      state.running = false;
    }
  })();

  return { started: true };
}
