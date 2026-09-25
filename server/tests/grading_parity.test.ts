import { describe, expect, test } from "bun:test";
import { join } from "path";
import * as server from "../utils/grading";

/**
 * server/utils/grading.ts and src/utils/grading.ts are hand-maintained mirrors
 * (like normalizeFen). This test is the tripwire: same exports, same bands,
 * identical output over a table that straddles every band edge for both movers.
 *
 * The client file is loaded with a computed-path dynamic import: a static
 * `import "../../src/..."` trips server/tsconfig.json's `rootDir` (TS6059) and
 * would break `npm run typecheck:server`. It is typed as the server module —
 * the identical-exports test below is what makes that claim true.
 */
const client = (await import(
  join(import.meta.dir, "..", "..", "src", "utils", "grading.ts")
)) as typeof server;

const K = 0.00368208;
const cpForWin = (w: number) => Math.log(w / (100 - w)) / K;

type Case = {
  prevEvalWhite: number;
  newEvalWhite: number;
  mover: "w" | "b";
  playedIsBest: boolean;
};

function buildTable(): Case[] {
  const rows: Case[] = [];
  const edges = Object.values(server.GRADE_BANDS);
  const e = 1e-6;
  // Starting win% for the mover, from lost to crushing, so the edges are hit on
  // both the steep and the flat parts of the curve.
  const startCps = [-1500, -600, -150, 0, 40, 200, 700, 1800, server.MATE_CP];
  for (const startCp of startCps) {
    const startWin = server.winPercent(startCp);
    for (const edge of edges) {
      for (const delta of [-e, 0, e]) {
        const targetWin = startWin - (edge + delta);
        if (targetWin <= 0.01 || targetWin >= 99.99) continue;
        const endCp = cpForWin(targetWin);
        // White mover: evals as-is. Black mover: mirror (White's POV is negated).
        rows.push({ prevEvalWhite: startCp, newEvalWhite: endCp, mover: "w", playedIsBest: false });
        rows.push({ prevEvalWhite: -startCp, newEvalWhite: -endCp, mover: "b", playedIsBest: false });
        rows.push({ prevEvalWhite: startCp, newEvalWhite: endCp, mover: "w", playedIsBest: true });
        rows.push({ prevEvalWhite: -startCp, newEvalWhite: -endCp, mover: "b", playedIsBest: true });
      }
    }
  }
  // Integer cp pairs, improvements, ties, mate clamps in both directions.
  const M = server.MATE_CP;
  const ints = [-M, -900, -300, -60, -5, 0, 5, 60, 300, 900, M];
  for (const a of ints) {
    for (const b of ints) {
      for (const mover of ["w", "b"] as const) {
        rows.push({ prevEvalWhite: a, newEvalWhite: b, mover, playedIsBest: false });
      }
    }
  }
  return rows;
}

describe("grading parity (server vs src)", () => {
  test("both modules export the same names", () => {
    expect(Object.keys(client).sort()).toEqual(Object.keys(server).sort());
  });

  test("GRADE_BANDS and MATE_CP are identical", () => {
    expect(client.GRADE_BANDS).toEqual(server.GRADE_BANDS);
    expect(client.MATE_CP).toBe(server.MATE_CP);
  });

  test("winPercent agrees over a sweep including the clamp", () => {
    for (let cp = -12000; cp <= 12000; cp += 37) {
      expect(client.winPercent(cp)).toBe(server.winPercent(cp));
    }
  });

  test("winPercentFromScore agrees for cp, mate and null inputs", () => {
    const scores = [
      { cp: 0, mate: null },
      { cp: 137, mate: null },
      { cp: -412, mate: null },
      { cp: null, mate: 4 },
      { cp: null, mate: -1 },
      { cp: null, mate: 0 },
      { cp: null, mate: null },
    ];
    for (const s of scores) {
      expect(client.winPercentFromScore(s)).toBe(server.winPercentFromScore(s));
    }
  });

  test("computeCpLoss agrees", () => {
    const M = server.MATE_CP;
    for (const a of [-M, -300, 0, 300, M]) {
      for (const b of [-M, -300, 0, 300, M]) {
        for (const mover of ["w", "b"] as const) {
          expect(client.computeCpLoss(a, b, mover)).toBe(server.computeCpLoss(a, b, mover));
        }
      }
    }
  });

  test("gradeMove agrees on every row of the band-edge table", () => {
    const table = buildTable();
    expect(table.length).toBeGreaterThan(500);
    for (const row of table) {
      expect(client.gradeMove(row)).toEqual(server.gradeMove(row));
    }
  });

  test("the playedIsBest guard agrees: top move with loss 3 -> best, 6 -> inaccuracy, 25 -> blunder", () => {
    const expected: [number, server.Grade][] = [
      [3, "best"],
      [6, "inaccuracy"],
      [25, "blunder"],
    ];
    for (const [loss, grade] of expected) {
      for (const mover of ["w", "b"] as const) {
        const sign = mover === "w" ? 1 : -1;
        const row = {
          prevEvalWhite: 0,
          newEvalWhite: sign * cpForWin(50 - loss),
          mover,
          playedIsBest: true,
        };
        expect(server.gradeMove(row).grade).toBe(grade);
        expect(client.gradeMove(row)).toEqual(server.gradeMove(row));
      }
    }
  });

  test("the table really exercises every grade", () => {
    const seen = new Set<string>();
    for (const row of buildTable()) seen.add(server.gradeMove(row).grade);
    expect([...seen].sort()).toEqual(
      ["best", "blunder", "excellent", "good", "inaccuracy", "mistake"].sort(),
    );
  });
});
