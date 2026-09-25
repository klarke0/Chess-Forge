import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import db from "../db";
import { syncGames, uploadGames } from "../routes/games";

// Uses the global DB, which bun test points at CHESS_DB_PATH (a scratch file).
const USER = "hookuser";
const UUID_PREFIX = "import-hook-test-";

function pgnFor(n: number): string {
  return [
    '[Event "Live Chess"]',
    `[White "${USER}"]`,
    `[Black "opp${n}"]`,
    '[Result "1-0"]',
    '[Date "2026.09.01"]',
    "",
    "1. e4 e5 2. Nf3 Nc6 1-0",
  ].join("\n");
}

function cleanup() {
  db.query("DELETE FROM games WHERE uuid LIKE ? OR white_username = ?").run(`${UUID_PREFIX}%`, USER);
}
beforeAll(cleanup);
afterAll(cleanup);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubChessCom(games: unknown[]) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/games/archives")) return Response.json({ archives: ["https://archive/2026/09"] });
    return Response.json({ games });
  }) as unknown as typeof fetch;
}

const chessComGame = (n: number) => ({
  uuid: `${UUID_PREFIX}${n}`,
  pgn: pgnFor(n),
  time_control: "600",
  time_class: "rapid",
  end_time: 1_790_000_000 + n,
  white: { username: USER, result: "win" },
  black: { username: `opp${n}`, result: "checkmated" },
});

const syncReq = () =>
  new Request("http://x/api/games/sync", { method: "POST", body: JSON.stringify({ username: USER }) });

describe("syncGames onImported hook", () => {
  test("fires once with the number of NEW games, and the response is unchanged", async () => {
    stubChessCom([chessComGame(1), chessComGame(2)]);
    const seen: number[] = [];
    const res = await syncGames(syncReq(), (n) => seen.push(n));
    expect(await res.json()).toEqual({ imported: 2 });
    expect(seen).toEqual([2]);
  });

  test("does not fire when nothing new was imported (already-synced games)", async () => {
    stubChessCom([chessComGame(1), chessComGame(2)]); // inserted by the previous test
    const seen: number[] = [];
    const res = await syncGames(syncReq(), (n) => seen.push(n));
    expect(await res.json()).toEqual({ imported: 0 });
    expect(seen).toEqual([]);
  });

  test("a throwing hook never reaches the sync response", async () => {
    stubChessCom([chessComGame(3)]);
    const res = await syncGames(syncReq(), () => {
      throw new Error("analysis exploded");
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 1 });
  });

  test("works with no hook at all (existing call sites)", async () => {
    stubChessCom([chessComGame(4)]);
    const res = await syncGames(syncReq());
    expect(await res.json()).toEqual({ imported: 1 });
  });
});

describe("uploadGames onImported hook", () => {
  test("fires with the imported count; zero imports do not fire", async () => {
    const seen: number[] = [];
    const ok = await uploadGames(
      new Request("http://x/api/games/upload", {
        method: "POST",
        body: JSON.stringify({ pgn: pgnFor(9), username: USER }),
      }),
      (n) => seen.push(n),
    );
    expect(await ok.json()).toEqual({ imported: 1 });
    expect(seen).toEqual([1]);

    const bad = await uploadGames(
      new Request("http://x/api/games/upload", {
        method: "POST",
        body: JSON.stringify({ pgn: "[Event \"x\"]\n\n1. e4 e5 2. Qxx9", username: USER }),
      }),
      (n) => seen.push(n),
    );
    expect(await bad.json()).toEqual({ imported: 0 });
    expect(seen).toEqual([1]);
  });
});
