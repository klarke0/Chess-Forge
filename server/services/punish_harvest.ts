import { Chess } from "chess.js";
import db from "../db";
import { NativeEngine, findStockfishBinary } from "./engine_native";
import type { EngineEval } from "./engine_native";
import { lossCp } from "../utils/audit";

interface EvalSource {
  evaluate(fen: string, depth?: number): Promise<EngineEval>;
}

export async function harvestOne(
  engine: EvalSource,
  fullFenBefore: string,
  playedSan: string,
  depth: number,
): Promise<{
  loss_cp: number;
  eval_best_cp: number | null;
  eval_played_cp: number | null;
  refutation_pv: string;
}> {
  const chess = new Chess(fullFenBefore);
  let move;
  try {
    move = chess.move(playedSan);
  } catch {
    move = null;
  }
  if (!move) throw new Error(`illegal SAN ${playedSan} at ${fullFenBefore}`);
  const best = await engine.evaluate(fullFenBefore, depth);
  // Eval AFTER the mistake: side to move is now Kevin. Its PV IS the punish line.
  const after = await engine.evaluate(chess.fen(), depth);
  return {
    loss_cp: lossCp(best, after),
    eval_best_cp: best.cp,
    eval_played_cp: after.cp,
    refutation_pv: after.pvUci.join(" "),
  };
}

const state = { running: false, done: 0, total: 0, errors: 0 };
export function harvestStatus() {
  return { ...state };
}

function ensureFullFen(fen: string): string {
  return fen.split(" ").length >= 6 ? fen : `${fen} 0 1`;
}

export function startHarvest(depth = 14): { started: boolean; reason?: string } {
  if (state.running) return { started: false, reason: "harvest already running" };
  if (!findStockfishBinary())
    return { started: false, reason: "stockfish binary not found" };

  const rows = db
    .query(
      `SELECT id, fen, played_san FROM deviations
       WHERE notes = 'opponent' AND loss_cp IS NULL`,
    )
    .all() as { id: number; fen: string; played_san: string }[];

  state.running = true;
  state.done = 0;
  state.total = rows.length;
  state.errors = 0;

  // Fire-and-forget; status is polled.
  (async () => {
    const engine = new NativeEngine();
    const update = db.prepare(
      `UPDATE deviations SET eval_best_cp = ?, eval_played_cp = ?, loss_cp = ?, refutation_pv = ?
       WHERE id = ?`,
    );
    try {
      for (const r of rows) {
        try {
          const h = await harvestOne(engine, ensureFullFen(r.fen), r.played_san, depth);
          update.run(h.eval_best_cp, h.eval_played_cp, h.loss_cp, h.refutation_pv, r.id);
        } catch (e) {
          state.errors++;
          // Mark judged-but-unusable so the resumable query skips it next run.
          update.run(null, null, -1, null, r.id);
          console.error("[punish] harvest error id", r.id, e);
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
