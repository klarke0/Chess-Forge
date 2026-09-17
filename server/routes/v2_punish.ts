import db from "../db";
import { ok, err } from "../utils/response";
import { startHarvest, harvestStatus } from "../services/punish_harvest";

export function punishHarvestRoute(): Response {
  const r = startHarvest();
  return r.started ? ok(r) : err(r.reason ?? "could not start", 409);
}

export function punishStatusRoute(): Response {
  return ok(harvestStatus());
}

export function punishListRoute(url: URL): Response {
  const minLoss = parseInt(url.searchParams.get("minLoss") ?? "150", 10);
  const rows = db
    .query(
      `SELECT d.id, d.repertoire_id, d.fen, d.expected_san, d.played_san,
              d.move_number, d.loss_cp, d.refutation_pv, g.date
       FROM deviations d
       JOIN games g ON g.id = d.game_id
       WHERE d.notes = 'opponent' AND d.loss_cp >= ?
       ORDER BY d.loss_cp DESC
       LIMIT 100`,
    )
    .all(minLoss);
  return ok({ count: rows.length, rows });
}
