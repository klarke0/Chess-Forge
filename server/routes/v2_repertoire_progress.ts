import db from "../db";
import { ok, err } from "../utils/response";

/**
 * DELETE /api/v2/repertoire/:id/progress
 *
 * Clears all SM-2 progress rows for the given repertoire so positions start
 * fresh. This is an intentional user-requested reset — SM-2 state is not
 * sacred when the user explicitly asks to wipe it.
 */
export function deleteRepertoireProgress(repertoireId: number): Response {
  const repertoire = db
    .query("SELECT id, name FROM repertoires WHERE id = ?")
    .get(repertoireId) as { id: number; name: string } | null;

  if (!repertoire) {
    return err("Repertoire not found", 404);
  }

  const before = (
    db
      .query("SELECT COUNT(*) as c FROM progress WHERE repertoire_id = ?")
      .get(repertoireId) as { c: number }
  ).c;

  db.prepare("DELETE FROM progress WHERE repertoire_id = ?").run(repertoireId);

  return ok({ cleared: before, repertoireId, name: repertoire.name });
}
