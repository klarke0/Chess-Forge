/**
 * Proof that a position with several stored book replies accepts all of them.
 *
 * A FEN can be reached by several move orders and legitimately have more than
 * one correct reply in the repertoire. The drill builder still displays ONE
 * canonical answer (`ORDER BY is_main_line DESC, depth ASC, san ASC`), and the
 * old grader compared the user's move against that single SAN — so every other
 * book reply was marked wrong, and when is_main_line/depth tied the displayed
 * answer fell through to `san ASC`, i.e. alphabetical.
 *
 * This script enumerates every multi-answer FEN and, for each one, replays the
 * client's grading rule (from/to square comparison) for every stored reply
 * under both the old and the new rule.
 *
 * Usage: bun run scripts/verify_multi_answer.ts
 */
import { Chess } from "chess.js";
import db from "../server/db";
import { acceptableSansFor } from "../server/utils/repertoireMoves";

const REPERTOIRES = (
  db.query("SELECT id, name FROM repertoires ORDER BY id").all() as {
    id: number;
    name: string;
  }[]
);

/** The client's check: does `played` land on the same from/to as `expected`? */
function gradesCorrect(fen: string, expected: string[], played: string): boolean {
  const full = fen.split(" ").length >= 6 ? fen : `${fen} 0 1`;
  const board = new Chess(full);
  const playedMove = board.move(played);
  if (!playedMove) return false;
  return expected.some((san) => {
    try {
      const ref = new Chess(full);
      const refMove = ref.move(san);
      return !!refMove && refMove.from === playedMove.from && refMove.to === playedMove.to;
    } catch {
      return false;
    }
  });
}

let grandMulti = 0;
let grandOldWrong = 0;
let grandNewWrong = 0;

for (const rep of REPERTOIRES) {
  const multi = db
    .query(
      `SELECT fen, COUNT(DISTINCT san) AS n
       FROM positions WHERE repertoire_id = ?
       GROUP BY fen HAVING n > 1 ORDER BY fen`,
    )
    .all(rep.id) as { fen: string; n: number }[];

  // FENs where is_main_line and depth both tie at the top, so the displayed
  // answer is decided by `san ASC` — alphabetically.
  let alphabetical = 0;
  let oldWrong = 0; // (fen, san) pairs the old single-answer rule rejected
  let newWrong = 0; // ... that the new rule still rejects
  const samples: string[] = [];

  for (const row of multi) {
    const rows = db
      .query(
        `SELECT san, is_main_line, depth FROM positions
         WHERE repertoire_id = ? AND fen = ?
         ORDER BY is_main_line DESC, depth ASC, san ASC`,
      )
      .all(rep.id, row.fen) as { san: string; is_main_line: number; depth: number }[];

    const top = rows[0];
    const tied = rows.filter(
      (r) => r.is_main_line === top.is_main_line && r.depth === top.depth,
    );
    if (tied.length > 1) alphabetical++;

    const canonical = top.san;
    const accepted = acceptableSansFor(rep.id, row.fen, canonical);

    for (const r of rows) {
      let legal = true;
      try {
        const b = new Chess(`${row.fen} 0 1`);
        legal = !!b.move(r.san);
      } catch {
        legal = false;
      }
      if (!legal) continue; // stale row, not a playable book reply
      if (!gradesCorrect(row.fen, [canonical], r.san)) oldWrong++;
      if (!gradesCorrect(row.fen, accepted, r.san)) newWrong++;
    }

    if (samples.length < 5 && tied.length > 1) {
      samples.push(
        `    ${row.fen}\n      stored: [${rows.map((r) => r.san).join(", ")}]  displayed: ${canonical}  accepted now: [${accepted.join(", ")}]`,
      );
    }
  }

  console.log(`\n=== ${rep.name} (repertoire ${rep.id}) ===`);
  console.log(`  FENs with more than one stored book reply : ${multi.length}`);
  console.log(`  ... of which the displayed answer is picked alphabetically : ${alphabetical}`);
  console.log(`  book replies rejected by the OLD single-answer rule : ${oldWrong}`);
  console.log(`  book replies rejected by the NEW rule               : ${newWrong}`);
  if (samples.length) {
    console.log(`  samples (alphabetically-resolved positions):`);
    for (const s of samples) console.log(s);
  }

  grandMulti += multi.length;
  grandOldWrong += oldWrong;
  grandNewWrong += newWrong;
}

console.log(
  `\nTOTAL: ${grandMulti} multi-answer FENs; ${grandOldWrong} correct book replies were graded wrong before, ${grandNewWrong} now.`,
);
process.exit(grandNewWrong === 0 ? 0 : 1);
