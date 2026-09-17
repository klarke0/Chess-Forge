import { beforeEach, describe, expect, test } from "bun:test";
import db from "../db";
import { tiebreakGrayRows } from "../routes/v2_audit";

const REP = 999; // scratch repertoire id — cleaned each run

beforeEach(() => {
  db.query("DELETE FROM book_audit WHERE repertoire_id = ?").run(REP);
  db.prepare(
    `INSERT INTO book_audit (repertoire_id, fen, san, depth, loss_cp, verdict)
     VALUES (?, ?, ?, 14, 100, 'gray')`,
  ).run(REP, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "e4");
});

describe("tiebreakGrayRows", () => {
  test("masters play it → ok_masters", async () => {
    const res = await tiebreakGrayRows(REP, async () => ({ moveGames: 4000, totalGames: 9000 }));
    expect(res).toEqual({ resolved: 1, okMasters: 1, flagged: 0 });
    const row = db
      .query("SELECT verdict, masters_move_games FROM book_audit WHERE repertoire_id = ?")
      .get(REP) as { verdict: string; masters_move_games: number };
    expect(row.verdict).toBe("ok_masters");
    expect(row.masters_move_games).toBe(4000);
  });

  test("masters never touch it → flagged", async () => {
    const res = await tiebreakGrayRows(REP, async () => ({ moveGames: 1, totalGames: 5000 }));
    expect(res).toEqual({ resolved: 1, okMasters: 0, flagged: 1 });
  });

  test("explorer unreachable → row left gray for a later pass", async () => {
    const res = await tiebreakGrayRows(REP, async () => null);
    expect(res).toEqual({ resolved: 0, okMasters: 0, flagged: 0 });
    const row = db
      .query("SELECT verdict FROM book_audit WHERE repertoire_id = ?")
      .get(REP) as { verdict: string };
    expect(row.verdict).toBe("gray");
  });
});
