import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import db from "../db";
import { syncGames } from "../routes/games";
import {
  applyResultBackfill,
  mapChessComResult,
  planResultBackfill,
  recomputeResult,
  resultFromPgn,
  resultFromTermination,
} from "../utils/gameResult";
import { insertGame, memoryDb, PGN_A } from "./support/analysis_stubs";

// Every result code chess.com documents for a player in the public games API.
// Loser codes: the player LOST. Draw codes: the game was drawn. "win": the player won.
const CODE_TABLE: [string, "win" | "loss" | "draw"][] = [
  ["win", "win"],
  ["checkmated", "loss"],
  ["timeout", "loss"],
  ["resigned", "loss"], // the bug: was treated as a draw ("resign" never matched)
  ["lose", "loss"], // ditto
  ["abandoned", "loss"],
  ["kingofthehill", "loss"], // the OPPONENT's king reached the hill
  ["threecheck", "loss"],
  ["bughousepartnerlose", "loss"],
  ["agreed", "draw"],
  ["repetition", "draw"],
  ["stalemate", "draw"],
  ["insufficient", "draw"],
  ["50move", "draw"],
  ["timevsinsufficient", "draw"],
];

describe("mapChessComResult - the full code table, from the USER's perspective", () => {
  for (const [code, expected] of CODE_TABLE) {
    test(`${code} -> ${expected}`, () => {
      // With no opponent code, and with a plausible opponent code, the answer is the same.
      expect(mapChessComResult(code)).toBe(expected);
      const opp = expected === "win" ? "resigned" : expected === "loss" ? "win" : code;
      expect(mapChessComResult(code, opp)).toBe(expected);
    });
  }

  test("the user's resignation is a loss and the opponent's resignation is a win (regression)", () => {
    expect(mapChessComResult("resigned", "win")).toBe("loss");
    expect(mapChessComResult("win", "resigned")).toBe("win");
  });

  test("an unknown code falls back to the opponent's code: opponent won -> loss", () => {
    expect(mapChessComResult("somenewcode", "win")).toBe("loss");
  });

  test("an unknown code with a non-winning opponent is a draw, and nothing at all is a draw", () => {
    expect(mapChessComResult("somenewcode", "somethingelse")).toBe("draw");
    expect(mapChessComResult("somenewcode")).toBe("draw");
    expect(mapChessComResult(undefined)).toBe("draw");
    expect(mapChessComResult(undefined, "win")).toBe("loss");
  });

  test("case and whitespace do not matter", () => {
    expect(mapChessComResult(" Resigned ")).toBe("loss");
    expect(mapChessComResult("WIN")).toBe("win");
  });
});

const pgn = (result: string, extra = "") =>
  `[Event "Live Chess"]\n[White "kevin"]\n[Black "opp"]\n[Result "${result}"]\n${extra}\n1. e4 e5 ${result}`;

describe("resultFromPgn", () => {
  test("1-0 / 0-1 / 1/2-1/2 from the user's colour", () => {
    expect(resultFromPgn(pgn("1-0"), "white")).toBe("win");
    expect(resultFromPgn(pgn("1-0"), "black")).toBe("loss");
    expect(resultFromPgn(pgn("0-1"), "white")).toBe("loss");
    expect(resultFromPgn(pgn("0-1"), "black")).toBe("win");
    expect(resultFromPgn(pgn("1/2-1/2"), "white")).toBe("draw");
    expect(resultFromPgn(pgn("1/2-1/2"), "black")).toBe("draw");
  });

  test("an unfinished / missing / unknown result is undetermined (null), not a draw", () => {
    expect(resultFromPgn(pgn("*"), "white")).toBeNull();
    expect(resultFromPgn('[Event "x"]\n\n1. e4 e5', "white")).toBeNull();
    expect(resultFromPgn(pgn("weird"), "white")).toBeNull();
  });

  test("no PGN or no user colour is undetermined", () => {
    expect(resultFromPgn(null, "white")).toBeNull();
    expect(resultFromPgn(pgn("1-0"), null)).toBeNull();
    expect(resultFromPgn(pgn("1-0"), "green")).toBeNull();
  });
});

describe("resultFromTermination (fallback when the Result header is unusable)", () => {
  test("names the winner: the user's name -> win, the opponent's -> loss", () => {
    expect(resultFromTermination("kevin won by resignation", "kevin", "opp")).toBe("win");
    expect(resultFromTermination("opp won on time", "kevin", "opp")).toBe("loss");
    expect(resultFromTermination("Kevin won by checkmate", "kevin", "opp")).toBe("win"); // case-insensitive
    expect(resultFromTermination("opp won - game abandoned", "kevin", "opp")).toBe("loss");
  });

  test("drawn games", () => {
    for (const t of [
      "Game drawn by agreement",
      "Game drawn by repetition",
      "Game drawn by stalemate",
      "Game drawn by timeout vs insufficient material",
      "Game drawn by insufficient material",
      "Game drawn by 50-move rule",
    ]) {
      expect(resultFromTermination(t, "kevin", "opp")).toBe("draw");
    }
  });

  test("anything it cannot attribute is undetermined", () => {
    expect(resultFromTermination(null, "kevin", "opp")).toBeNull();
    expect(resultFromTermination("someone else won", "kevin", "opp")).toBeNull();
    expect(resultFromTermination("Normal", "kevin", "opp")).toBeNull();
  });
});

describe("recomputeResult - source priority", () => {
  const base = {
    user_color: "white",
    pgn: pgn("1-0"),
    white_username: "kevin",
    black_username: "opp",
    white_result: "win",
    black_result: "resigned",
  };

  test("the PGN Result header wins", () => {
    expect(recomputeResult(base)).toEqual({ result: "win", source: "pgn" });
  });

  test("falls back to the Termination text when the header is '*'", () => {
    const row = { ...base, pgn: pgn("*", '[Termination "opp won by resignation"]\n') };
    expect(recomputeResult(row)).toEqual({ result: "loss", source: "termination" });
  });

  test("falls back to chess.com's stored codes last", () => {
    const row = { ...base, pgn: pgn("*"), user_color: "black", white_result: "win", black_result: "resigned" };
    expect(recomputeResult(row)).toEqual({ result: "loss", source: "chesscom" });
  });

  test("nothing usable -> undetermined", () => {
    const row = { ...base, pgn: pgn("*"), white_result: null, black_result: null };
    expect(recomputeResult(row)).toEqual({ result: null, source: null });
  });
});

// ---------------------------------------------------------------------------
// syncGames integration: the fix lands in what is actually stored.
// ---------------------------------------------------------------------------

const USER = "resulttestuser";
const UUID_PREFIX = "game-result-test-";
const realFetch = globalThis.fetch;

function cleanup() {
  db.query("DELETE FROM games WHERE uuid LIKE ?").run(`${UUID_PREFIX}%`);
}
beforeAll(cleanup);
afterAll(cleanup);
afterEach(() => {
  globalThis.fetch = realFetch;
});

let uuidN = 0;
function chessComGame(userColor: "white" | "black", mine: string, theirs: string) {
  const n = ++uuidN;
  const me = { username: USER, result: mine };
  const opp = { username: `opp${n}`, result: theirs };
  return {
    uuid: `${UUID_PREFIX}${n}`,
    pgn: `[Event "Live Chess"]\n[White "${userColor === "white" ? USER : opp.username}"]\n[Black "${userColor === "black" ? USER : opp.username}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0`,
    time_control: "600",
    time_class: "rapid",
    end_time: 1_790_100_000 + n,
    white: userColor === "white" ? me : opp,
    black: userColor === "black" ? me : opp,
  };
}

describe("syncGames stores the corrected result", () => {
  test("every code pair, both colours", async () => {
    const cases: [string, string, "white" | "black", "win" | "loss" | "draw"][] = [
      ["win", "resigned", "white", "win"],
      ["resigned", "win", "white", "loss"], // the reported bug
      ["resigned", "win", "black", "loss"],
      ["win", "timeout", "black", "win"],
      ["timeout", "win", "white", "loss"],
      ["checkmated", "win", "black", "loss"],
      ["win", "checkmated", "white", "win"],
      ["abandoned", "win", "white", "loss"],
      ["agreed", "agreed", "white", "draw"],
      ["repetition", "repetition", "black", "draw"],
      ["stalemate", "stalemate", "white", "draw"],
      ["insufficient", "insufficient", "white", "draw"],
      ["50move", "50move", "black", "draw"],
      ["timevsinsufficient", "insufficient", "white", "draw"],
      ["lose", "win", "white", "loss"],
    ];
    const games = cases.map(([mine, theirs, color]) => chessComGame(color, mine, theirs));
    globalThis.fetch = (async (url: string | URL | Request) =>
      String(url).endsWith("/games/archives")
        ? Response.json({ archives: ["https://archive/2026/09"] })
        : Response.json({ games })) as unknown as typeof fetch;

    const res = await syncGames(
      new Request("http://x/api/games/sync", { method: "POST", body: JSON.stringify({ username: USER }) }),
    );
    expect(await res.json()).toEqual({ imported: cases.length });

    cases.forEach(([mine, theirs, , expected], i) => {
      const r = db.query("SELECT result FROM games WHERE uuid = ?").get(games[i].uuid) as { result: string };
      expect({ mine, theirs, result: r.result }).toEqual({ mine, theirs, result: expected });
    });
  });
});

// ---------------------------------------------------------------------------
// The backfill plan / apply (pure, on an injected DB)
// ---------------------------------------------------------------------------

function seed(d: Database, o: { result: string | null; pgnResult: string; color?: string; wr?: string; br?: string }) {
  const id = insertGame(d, { pgn: pgn(o.pgnResult), userColor: o.color ?? "white" });
  d.query("UPDATE games SET result = ?, white_result = ?, black_result = ? WHERE id = ?").run(
    o.result,
    o.wr ?? null,
    o.br ?? null,
    id,
  );
  return id;
}

describe("planResultBackfill / applyResultBackfill", () => {
  test("reports only rows whose stored result differs, grouped by from->to", () => {
    const d = memoryDb();
    const resignedLoss = seed(d, { result: "draw", pgnResult: "0-1", color: "white" }); // draw -> loss
    const resignedLoss2 = seed(d, { result: "draw", pgnResult: "1-0", color: "black" }); // draw -> loss
    const wrongWin = seed(d, { result: "draw", pgnResult: "1-0", color: "white" }); // draw -> win
    const fine = seed(d, { result: "loss", pgnResult: "0-1", color: "white" });
    seed(d, { result: "draw", pgnResult: "1/2-1/2", color: "white" }); // already right
    const unfinished = seed(d, { result: "draw", pgnResult: "*", color: "white" }); // undetermined -> untouched
    const nullResult = seed(d, { result: null, pgnResult: "1-0", color: "white" }); // null -> win

    const plan = planResultBackfill(d);
    expect(plan.total).toBe(7);
    expect(plan.changes.map((c) => c.id).sort((a, b) => a - b)).toEqual(
      [resignedLoss, resignedLoss2, wrongWin, nullResult].sort((a, b) => a - b),
    );
    expect(plan.transitions).toEqual({ "draw->loss": 2, "draw->win": 1, "null->win": 1 });
    expect(plan.unchanged).toBe(2); // fine + fineDraw
    expect(plan.undetermined).toBe(1); // unfinished
    expect(plan.changes.find((c) => c.id === fine)).toBeUndefined();
    expect(plan.changes.find((c) => c.id === unfinished)).toBeUndefined();
  });

  test("plan is read-only", () => {
    const d = memoryDb();
    const id = seed(d, { result: "draw", pgnResult: "0-1" });
    planResultBackfill(d);
    expect((d.query("SELECT result FROM games WHERE id = ?").get(id) as { result: string }).result).toBe("draw");
  });

  test("apply writes every planned change, and a second plan is empty (idempotent)", () => {
    const d = memoryDb();
    const a = seed(d, { result: "draw", pgnResult: "0-1" });
    const b = seed(d, { result: "draw", pgnResult: "1-0", color: "black" });
    seed(d, { result: "win", pgnResult: "1-0" });
    const plan = planResultBackfill(d);
    expect(applyResultBackfill(d, plan.changes)).toBe(2);
    const get = (id: number) => (d.query("SELECT result FROM games WHERE id = ?").get(id) as { result: string }).result;
    expect(get(a)).toBe("loss");
    expect(get(b)).toBe("loss");
    expect(planResultBackfill(d).changes).toEqual([]);
  });

  test("apply is one transaction: a failure part-way through leaves nothing changed", () => {
    const d = memoryDb();
    const a = seed(d, { result: "draw", pgnResult: "0-1" });
    const b = seed(d, { result: "draw", pgnResult: "0-1" });
    // A trigger that rejects the second update.
    d.query(
      `CREATE TRIGGER boom BEFORE UPDATE OF result ON games WHEN NEW.id = ${b}
       BEGIN SELECT RAISE(ABORT, 'nope'); END`,
    ).run();
    const plan = planResultBackfill(d);
    expect(() => applyResultBackfill(d, plan.changes)).toThrow();
    const get = (id: number) => (d.query("SELECT result FROM games WHERE id = ?").get(id) as { result: string }).result;
    expect(get(a)).toBe("draw");
    expect(get(b)).toBe("draw");
  });

  test("apply does not clobber a row that changed since the plan was made", () => {
    const d = memoryDb();
    const a = seed(d, { result: "draw", pgnResult: "0-1" });
    const plan = planResultBackfill(d);
    d.query("UPDATE games SET result = 'win' WHERE id = ?").run(a); // someone else touched it
    expect(applyResultBackfill(d, plan.changes)).toBe(0);
    expect((d.query("SELECT result FROM games WHERE id = ?").get(a) as { result: string }).result).toBe("win");
  });

  test("cross-check reports rows where the PGN disagrees with chess.com's stored codes", () => {
    const d = memoryDb();
    seed(d, { result: "loss", pgnResult: "0-1", color: "white", wr: "resigned", br: "win" }); // agree
    seed(d, { result: "loss", pgnResult: "0-1", color: "white", wr: "win", br: "resigned" }); // disagree
    seed(d, { result: "loss", pgnResult: "0-1", color: "white" }); // no codes -> not compared
    const plan = planResultBackfill(d);
    expect(plan.crossCheck).toEqual({ compared: 2, mismatches: 1 });
  });

  test("games with a legacy PGN in the fixtures still work end to end", () => {
    const d = memoryDb();
    const id = insertGame(d, { pgn: `[Result "1-0"]\n\n${PGN_A} 1-0`, userColor: "black" });
    d.query("UPDATE games SET result = 'draw' WHERE id = ?").run(id);
    expect(planResultBackfill(d).transitions).toEqual({ "draw->loss": 1 });
  });
});
