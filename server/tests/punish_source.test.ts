import { describe, expect, test } from "bun:test";
import { punishCandidateFromRow } from "../routes/v2_train_now";

// Real harvested row shape: Jobava Nb5 position, opponent ignored the Nxc7+ threat.
const FORK_ROW = {
  fen: "r1bqkb1r/ppp1pppp/2n2n2/1N1p4/3P1B2/8/PPP1PPPP/R2QKBNR b KQkq -",
  played_san: "Qd7",
  refutation_pv: "b5c7 e8d8 c7a8 e7e5 d4e5 f6e4",
  loss_cp: 745,
  game_id: 1,
  move_number: 4,
  date: "2025-12-18T17:08:24.000Z",
};

describe("punishCandidateFromRow", () => {
  test("builds the drill at the post-mistake position with the refutation as answer", () => {
    const c = punishCandidateFromRow(FORK_ROW);
    expect(c).not.toBeNull();
    // Drill FEN: after ...Qd7 it is White to move
    expect(c!.drillFen.split(" ")[1]).toBe("w");
    expect(c!.opponentMove).toBe("Qd7");
    // b5c7 from the drill FEN is the knight fork Nxc7+
    expect(c!.correctSan).toBe("Nxc7+");
    expect(c!.refutationSans[0]).toBe("Nxc7+");
    expect(c!.refutationSans.length).toBeLessThanOrEqual(5);
    expect(c!.cpLossPawns).toBeCloseTo(7.45, 2);
  });

  test("returns null when the recorded mistake move is illegal at the stored FEN", () => {
    expect(punishCandidateFromRow({ ...FORK_ROW, played_san: "Qxa1" })).toBeNull();
  });

  test("returns null when the refutation PV's first move is illegal after the mistake", () => {
    expect(
      punishCandidateFromRow({ ...FORK_ROW, refutation_pv: "a8a1 e8d8" }),
    ).toBeNull();
  });
});
