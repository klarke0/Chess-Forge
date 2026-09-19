import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import db from "../db";
import { enumerateLines, frequencyScore } from "../utils/lines";
import type { BookLine } from "../utils/lines";

const REP = 998; // scratch repertoire

beforeAll(() => {
  db.query("DELETE FROM positions WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM book_audit WHERE repertoire_id = ?").run(REP);
  db.query(
    "INSERT OR IGNORE INTO repertoires (id, name, side) VALUES (?, 'ScratchLines', 'white')",
  ).run(REP);
  // Tiny tree: 1.e4 (Kevin) -> 1...e5 -> 2.Nf3 (leaf)  and  1...c5 -> 2.Nc3 (leaf)
  // fen column: 4-field. next_fen column: SIX-field (mirrors production data).
  const rows = [
    // start -> e4
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "e4",
     "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", "the king's pawn"],
    // after e4: e5
    ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3", "e5",
     "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2", null],
    // after e4: c5
    ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3", "c5",
     "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2", null],
    // after e5: Nf3 (Kevin, leaf)
    ["rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6", "Nf3",
     "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2", null],
    // after c5: Nc3 (Kevin, leaf)
    ["rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6", "Nc3",
     "rnbqkbnr/pp1ppppp/8/2p5/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 2", null],
  ];
  const ins = db.prepare(
    "INSERT INTO positions (repertoire_id, fen, san, next_fen, comment) VALUES (?, ?, ?, ?, ?)",
  );
  for (const [fen, san, next, comment] of rows) ins.run(REP, fen, san, next, comment);
});

afterAll(() => {
  db.query("DELETE FROM positions WHERE repertoire_id = ?").run(REP);
  db.query("DELETE FROM book_audit WHERE repertoire_id = ?").run(REP);
});

describe("enumerateLines", () => {
  test("walks 4-field fen -> 6-field next_fen links and finds both root-to-leaf lines", () => {
    const lines = enumerateLines(REP);
    expect(lines.length).toBe(2);
    const sanPaths = lines.map((l) => l.moves.map((m) => m.san).join(" ")).sort();
    expect(sanPaths).toEqual(["e4 c5 Nc3", "e4 e5 Nf3"]);
  });

  test("marks Kevin's moves (white) and counts them", () => {
    const lines = enumerateLines(REP);
    for (const l of lines) {
      expect(l.moves[0].isKevinMove).toBe(true);   // e4
      expect(l.moves[1].isKevinMove).toBe(false);  // reply
      expect(l.kevinMoveCount).toBe(2);
      expect(l.moves[0].comment).toBe("the king's pawn");
      expect(l.moves[0].fen.split(" ").length).toBe(6); // client-facing 6-field
    }
  });

  test("stable lineKey: 16 hex chars, differs between lines", () => {
    const [a, b] = enumerateLines(REP);
    expect(a.lineKey).toMatch(/^[0-9a-f]{16}$/);
    expect(a.lineKey).not.toBe(b.lineKey);
    expect(enumerateLines(REP).find((l) => l.lineKey === a.lineKey)).toBeTruthy();
  });

  test("quarantines a line containing a flagged Kevin-side move", () => {
    db.prepare(
      `INSERT INTO book_audit (repertoire_id, fen, san, depth, loss_cp, verdict)
       VALUES (?, ?, ?, 14, 300, 'flagged')`,
    ).run(REP, "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6", "Nf3");
    const lines = enumerateLines(REP);
    const bad = lines.find((l) => l.moves.some((m) => m.san === "Nf3"));
    const good = lines.find((l) => l.moves.some((m) => m.san === "Nc3"));
    expect(bad!.quarantined).toBe(true);
    expect(good!.quarantined).toBe(false);
  });
});

describe("frequencyScore", () => {
  test("sums placement hits over the line's first positions", () => {
    const lines = enumerateLines(REP);
    const line = lines.find((l) => l.moves.some((m) => m.san === "Nf3"))!;
    const counts = new Map<string, number>();
    // placement key of the position before e5 (after 1.e4)
    counts.set("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR", 5);
    expect(frequencyScore(line, counts)).toBeGreaterThanOrEqual(5);
    expect(frequencyScore(line, new Map())).toBe(0);
  });
});
