import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import db from "../db";
import { pickNextLesson, completeLesson } from "../routes/v2_learn";
import { enumerateLines } from "../utils/lines";
import { normalizeFen } from "../utils/fen";

const REP = 997; // scratch repertoire (Task 1's lines.test.ts uses 998)

beforeAll(() => {
  db.query("DELETE FROM positions WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM book_audit WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM chapters WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM learn_state WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM progress WHERE repertoire_id = ?").run(REP);
  db.query(
    "INSERT OR IGNORE INTO repertoires (id, name, side) VALUES (?, 'ScratchLearn', 'white')",
  ).run(REP);
  // Same tiny tree as lines.test.ts: 1.e4 (Kevin) -> 1...e5 -> 2.Nf3 (leaf, Kevin)
  // and 1...c5 -> 2.Nc3 (leaf, Kevin). Two lines, two Kevin moves each.
  const rows = [
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "e4",
     "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", null],
    ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3", "e5",
     "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2", null],
    ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3", "c5",
     "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2", null],
    ["rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6", "Nf3",
     "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2", null],
    ["rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6", "Nc3",
     "rnbqkbnr/pp1ppppp/8/2p5/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 2", null],
  ];
  const ins = db.prepare(
    "INSERT INTO positions (repertoire_id, fen, san, next_fen, comment) VALUES (?, ?, ?, ?, ?)",
  );
  for (const [fen, san, next, comment] of rows) ins.run(REP, fen, san, next, comment);
});

afterAll(() => {
  db.query("DELETE FROM learn_state WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM progress WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM positions WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM chapters WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM book_audit WHERE repertoire_id = ?").run(REP);
});

describe("pickNextLesson / completeLesson", () => {
  test("pickNextLesson returns an unlearned line with stage 0", () => {
    const r = pickNextLesson(REP);
    expect(r.lesson).not.toBeNull();
    expect(r.lesson!.stage).toBe(0);
    expect(r.totals.lines).toBe(2);
  });

  test("completeLesson advances stages monotonically and only on pass", () => {
    const key = pickNextLesson(REP).lesson!.lineKey;
    expect(completeLesson(REP, key, 1, true).newStage).toBe(1);
    expect(completeLesson(REP, key, 1, true).newStage).toBe(1); // repeat no-op
    expect(completeLesson(REP, key, 3, false).newStage).toBe(1); // fail: no advance
    expect(completeLesson(REP, key, 2, true).newStage).toBe(2);
  });

  test("blind pass (stage 3) promotes Kevin-decision FENs into progress", () => {
    const key = pickNextLesson(REP).lesson!.lineKey;
    const res = completeLesson(REP, key, 3, true);
    expect(res.newStage).toBe(3);
    expect(res.promoted).toBe(2); // two Kevin moves in the scratch line
    const rows = db
      .query("SELECT COUNT(*) c FROM progress WHERE repertoire_id = ?")
      .get(REP) as { c: number };
    expect(rows.c).toBe(2);
    // idempotent: re-pass doesn't duplicate
    expect(completeLesson(REP, key, 3, true).promoted).toBe(0);
  });

  test("learned lines drop out of pickNextLesson; quarantined never appear", () => {
    // Exactly one line is stage 3 (learned) from the previous test; the
    // other is still stage 0. Promote it to stage 3 as well, so BOTH lines
    // are learned and pickNextLesson must fall back to a refresh pick
    // (least-recently completed stage-3 line) rather than returning null.
    const remainingKey = pickNextLesson(REP).lesson!.lineKey; // the only unlearned line left
    completeLesson(REP, remainingKey, 1, true);
    completeLesson(REP, remainingKey, 2, true);
    completeLesson(REP, remainingKey, 3, true);

    const bothLearned = pickNextLesson(REP);
    expect(bothLearned.lesson).not.toBeNull();
    expect(bothLearned.totals.learned).toBe(2);

    // Flag the refresh-picked line's own Kevin move -> quarantined. Even
    // though it's a valid stage-3 line, it must never be surfaced again;
    // the OTHER stage-3 line should be picked instead.
    const flaggedKey = bothLearned.lesson!.lineKey;
    const flaggedLine = enumerateLines(REP, 2000).find((l) => l.lineKey === flaggedKey)!;
    const flaggedMove = [...flaggedLine.moves].reverse().find((m) => m.isKevinMove)!;
    db.prepare(
      `INSERT INTO book_audit (repertoire_id, fen, san, depth, loss_cp, verdict)
       VALUES (?, ?, ?, 14, 300, 'flagged')`,
    ).run(REP, normalizeFen(flaggedMove.fen), flaggedMove.san);
    // book_audit writes don't bust the 60s enumerateLines cache on their own
    // (only completeLesson does, per spec) — force a refresh the same way a
    // real client's next completeLesson call would.
    completeLesson(REP, flaggedKey, 3, true);

    const r = pickNextLesson(REP);
    expect(r.lesson === null || r.lesson.lineKey !== flaggedKey).toBe(true);
  });
});
