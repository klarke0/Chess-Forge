import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import db from "../db";
import { runMigrations } from "../db";
import { saveAnalysis, saveGameAnalysis } from "../routes/games";
import { insertGame, memoryDb, PGN_A, PGN_MATE } from "./support/analysis_stubs";

const moves = [
  { san: "e4", fen: "f1", eval: 20, cpLoss: 0, grade: "best", bestMove: "e2e4" },
  { san: "e5", fen: "f2", eval: 25, cpLoss: 0, grade: "best", bestMove: "e7e5" },
  { san: "Nf3", fen: "f3", eval: 30, cpLoss: 0, grade: "best", bestMove: "g1f3" },
  { san: "Nc6", fen: "f4", eval: 28, cpLoss: 2, grade: "good", bestMove: "b8c6" },
];

function row(d: Database, id: number) {
  return d.query("SELECT * FROM games WHERE id = ?").get(id) as Record<string, unknown>;
}

describe("runMigrations", () => {
  const NEW_COLS = ["analysis_version", "analysis_depth", "analysis_failed", "analysis_updated_at"];
  const cols = (d: Database) =>
    (d.query("PRAGMA table_info(games)").all() as { name: string }[]).map((c) => c.name);

  test("a fresh DB gets the analysis columns", () => {
    const d = new Database(":memory:");
    runMigrations(d);
    for (const c of NEW_COLS) expect(cols(d)).toContain(c);
  });

  test("running the migrations twice is a no-op (idempotent)", () => {
    const d = new Database(":memory:");
    runMigrations(d);
    const before = cols(d);
    expect(() => runMigrations(d)).not.toThrow();
    expect(cols(d)).toEqual(before);
    // No duplicates either.
    for (const c of NEW_COLS) expect(cols(d).filter((x) => x === c).length).toBe(1);
  });

  test("an existing games table without the columns is upgraded in place, data kept", () => {
    const d = new Database(":memory:");
    d.query(
      `CREATE TABLE games (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE, pgn TEXT,
         analysis_json TEXT, date TEXT)`,
    ).run();
    d.query("INSERT INTO games (uuid, pgn, analysis_json) VALUES ('old', '1. e4', '[]')").run();
    runMigrations(d);
    for (const c of NEW_COLS) expect(cols(d)).toContain(c);
    const r = d.query("SELECT analysis_json, analysis_version FROM games WHERE uuid = 'old'").get() as {
      analysis_json: string;
      analysis_version: number | null;
    };
    expect(r.analysis_json).toBe("[]");
    expect(r.analysis_version).toBeNull(); // legacy rows read as "browser depth-12"
  });
});

describe("saveGameAnalysis", () => {
  test("stores the analysis plus version / depth / updated_at and clears analysis_failed", () => {
    const d = memoryDb();
    const id = insertGame(d, { pgn: PGN_A, analysisFailed: "engine error: boom" });
    const res = saveGameAnalysis(id, moves, { version: 2, depth: 14 }, d);
    expect(res.found).toBe(true);
    const r = row(d, id);
    expect(JSON.parse(r.analysis_json as string)).toEqual(moves);
    expect(r.analysis_version).toBe(2);
    expect(r.analysis_depth).toBe(14);
    expect(r.analysis_failed).toBeNull();
    expect(r.analysis_updated_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(typeof r.game_shape).toBe("string");
  });

  test("returns the game shape the route reports", () => {
    const d = memoryDb();
    const id = insertGame(d, { pgn: PGN_A });
    const res = saveGameAnalysis(id, moves, undefined, d);
    expect(res).toEqual({ found: true, shape: row(d, id).game_shape as string });
  });

  test("without meta the analysis is legacy: version/depth are NULL, analysis_failed is left alone", () => {
    const d = memoryDb();
    const id = insertGame(d, { pgn: PGN_A, analysisVersion: 2, analysisFailed: "x" });
    d.query("UPDATE games SET analysis_depth = 14 WHERE id = ?").run(id);
    saveGameAnalysis(id, moves, undefined, d);
    const r = row(d, id);
    expect(r.analysis_version).toBeNull();
    expect(r.analysis_depth).toBeNull();
    expect(r.analysis_failed).toBe("x");
    expect(JSON.parse(r.analysis_json as string)).toEqual(moves);
  });

  test("termination is extracted from the PGN header", () => {
    const d = memoryDb();
    const id = insertGame(d, { pgn: `[Termination "kevin won by checkmate"]\n\n${PGN_MATE}` });
    saveGameAnalysis(id, moves, undefined, d);
    expect(row(d, id).termination).toBe("kevin won by checkmate");
  });

  test("deviations are recomputed against the repertoires (idempotent)", () => {
    const d = memoryDb();
    d.query("INSERT INTO repertoires (id, name, side) VALUES (1, 'R', 'white')").run();
    // Book says 1.d4 from the start position; the game plays 1.e4.
    d.query(
      `INSERT INTO positions (repertoire_id, fen, san, next_fen, is_main_line, depth)
       VALUES (1, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', 'd4', 'x', 1, 0)`,
    ).run();
    const id = insertGame(d, { pgn: PGN_A, userColor: "white" });
    saveGameAnalysis(id, moves, { version: 2, depth: 14 }, d);
    saveGameAnalysis(id, moves, { version: 2, depth: 14 }, d);
    const devs = d.query("SELECT expected_san, played_san, notes FROM deviations WHERE game_id = ?").all(id);
    expect(devs).toEqual([{ expected_san: "d4", played_san: "e4", notes: "player" }]);
  });

  test("an unknown game id reports found:false and writes nothing", () => {
    const d = memoryDb();
    expect(saveGameAnalysis(9999, moves, { version: 2, depth: 14 }, d)).toEqual({ found: false });
  });
});

describe("saveGameAnalysis - downgrade guard (browser saves must not clobber a v2 analysis)", () => {
  const V2_JSON = JSON.stringify(moves);
  const legacy = [{ san: "e4", fen: "f1", eval: 999, cpLoss: 0, grade: "best" }];

  function v2Game(d: Database, extra: { version?: number } = {}) {
    const id = insertGame(d, { pgn: PGN_A, analysisJson: V2_JSON, analysisVersion: extra.version ?? 2 });
    d.query(
      `UPDATE games SET analysis_depth = 14, game_shape = 'Smooth',
         analysis_updated_at = '2026-01-01 00:00:00' WHERE id = ?`,
    ).run(id);
    return id;
  }

  test("a browser save over a v2 analysis is ignored and changes nothing", () => {
    const d = memoryDb();
    const id = v2Game(d);
    const before = row(d, id);
    const res = saveGameAnalysis(id, legacy, undefined, d);
    expect(res).toEqual({ found: true, ignored: true, shape: "Smooth" });
    expect(row(d, id)).toEqual(before);
  });

  test("an ignored save does not touch the deviations either", () => {
    const d = memoryDb();
    d.query("INSERT INTO repertoires (id, name, side) VALUES (1, 'R', 'white')").run();
    const id = v2Game(d);
    d.query(
      `INSERT INTO deviations (game_id, repertoire_id, fen, expected_san, played_san, move_number, notes)
       VALUES (?, 1, 'x', 'd4', 'e4', 1, 'player')`,
    ).run(id);
    saveGameAnalysis(id, legacy, undefined, d);
    expect((d.query("SELECT COUNT(*) AS c FROM deviations WHERE game_id = ?").get(id) as { c: number }).c).toBe(1);
  });

  test("a newer-than-current version is protected too (>=, not ==)", () => {
    const d = memoryDb();
    const id = v2Game(d, { version: 3 });
    expect(saveGameAnalysis(id, legacy, undefined, d)).toMatchObject({ found: true, ignored: true });
    expect(row(d, id).analysis_json).toBe(V2_JSON);
  });

  test("a legacy (version 1) analysis is overwritten by a browser save", () => {
    const d = memoryDb();
    const id = insertGame(d, { pgn: PGN_A, analysisJson: V2_JSON, analysisVersion: 1 });
    const res = saveGameAnalysis(id, legacy, undefined, d);
    expect(res.found && !("ignored" in res)).toBe(true);
    expect(JSON.parse(row(d, id).analysis_json as string)).toEqual(legacy);
    expect(row(d, id).analysis_version).toBeNull();
  });

  test("a NULL-version (browser depth-12) analysis is overwritten by a browser save", () => {
    const d = memoryDb();
    const id = insertGame(d, { pgn: PGN_A, analysisJson: V2_JSON, analysisVersion: null });
    saveGameAnalysis(id, legacy, undefined, d);
    expect(JSON.parse(row(d, id).analysis_json as string)).toEqual(legacy);
  });

  test("a game with no analysis at all can be saved by the browser fallback", () => {
    const d = memoryDb();
    const id = insertGame(d, { pgn: PGN_A });
    expect(saveGameAnalysis(id, legacy, undefined, d)).toMatchObject({ found: true });
    expect(JSON.parse(row(d, id).analysis_json as string)).toEqual(legacy);
  });

  test("a stale version stamp with the JSON cleared (clear-analysis) counts as no analysis", () => {
    const d = memoryDb();
    const id = insertGame(d, { pgn: PGN_A, analysisVersion: 2 }); // analysis_json NULL
    saveGameAnalysis(id, legacy, undefined, d);
    expect(JSON.parse(row(d, id).analysis_json as string)).toEqual(legacy);
  });

  test("the job itself (with meta) still overwrites a v2 analysis, e.g. a re-run", () => {
    const d = memoryDb();
    const id = v2Game(d);
    const res = saveGameAnalysis(id, legacy, { version: 2, depth: 14 }, d);
    expect(res.found && !("ignored" in res)).toBe(true);
    expect(JSON.parse(row(d, id).analysis_json as string)).toEqual(legacy);
  });

  test("an unknown game is still found:false", () => {
    expect(saveGameAnalysis(424242, legacy, undefined, memoryDb())).toEqual({ found: false });
  });
});

// The route still speaks its original protocol. It uses the global DB, which
// bun test points at CHESS_DB_PATH (a scratch file), never the live database.
describe("POST /api/games/:id/analysis (saveAnalysis route)", () => {
  let gameId = 0;
  beforeAll(() => {
    const res = db
      .query(
        `INSERT INTO games (uuid, white_username, black_username, user_color, result, pgn, date)
         VALUES ('analysis-save-route-test', 'a', 'b', 'white', 'win', ?, '2026-01-01')`,
      )
      .run(PGN_A);
    gameId = Number(res.lastInsertRowid);
  });
  afterAll(() => {
    db.query("DELETE FROM deviations WHERE game_id = ?").run(gameId);
    db.query("DELETE FROM games WHERE id = ?").run(gameId);
  });

  const post = (id: string, body: unknown) =>
    saveAnalysis(
      new Request(`http://x/api/games/${id}/analysis`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );

  test("200 { ok: true, shape } and the analysis is stored", async () => {
    const res = await post(String(gameId), { analysis: moves });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; shape: string };
    expect(body.ok).toBe(true);
    expect(typeof body.shape).toBe("string");
    expect("ignored" in body).toBe(false);
    const r = db.query("SELECT analysis_json, analysis_version FROM games WHERE id = ?").get(gameId) as {
      analysis_json: string;
      analysis_version: number | null;
    };
    expect(JSON.parse(r.analysis_json)).toEqual(moves);
    expect(r.analysis_version).toBeNull();
  });

  test("404 { error } for an unknown game", async () => {
    const res = await post("987654321", { analysis: moves });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Game not found" });
  });

  test("a v2 analysis is not overwritten: 200 { ok, shape, ignored: true } and the row is untouched", async () => {
    const v2 = JSON.stringify(moves);
    db.query(
      `UPDATE games SET analysis_json = ?, analysis_version = 2, analysis_depth = 14, game_shape = 'Smooth',
         analysis_updated_at = '2026-01-01 00:00:00' WHERE id = ?`,
    ).run(v2, gameId);
    const res = await post(String(gameId), { analysis: [{ san: "e4", fen: "f", eval: 1, cpLoss: 0, grade: "best" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, shape: "Smooth", ignored: true });
    const r = db.query("SELECT * FROM games WHERE id = ?").get(gameId) as Record<string, unknown>;
    expect(r.analysis_json).toBe(v2);
    expect(r.analysis_version).toBe(2);
    expect(r.analysis_updated_at).toBe("2026-01-01 00:00:00");
  });

  test("400 { error } for a non-numeric id", async () => {
    const res = await post("abc", { analysis: moves });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid ID" });
  });
});
