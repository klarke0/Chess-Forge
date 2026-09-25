import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runMigrations } from "../db";

const SCRIPT = join(import.meta.dir, "..", "..", "scripts", "backfill_game_results.ts");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const pgn = (r: string) => `[Event "x"]\n[White "kevin"]\n[Black "opp"]\n[Result "${r}"]\n\n1. e4 e5 ${r}`;

/** A throwaway on-disk DB with 3 wrong results and 1 right one. */
function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), "gr-backfill-"));
  dirs.push(dir);
  const file = join(dir, "chess_trainer.db");
  const d = new Database(file);
  d.query("PRAGMA journal_mode = WAL").run();
  runMigrations(d);
  const ins = d.prepare(
    `INSERT INTO games (uuid, white_username, black_username, user_color, result, pgn, white_result, black_result)
     VALUES (?, 'kevin', 'opp', ?, ?, ?, ?, ?)`,
  );
  ins.run("a", "white", "draw", pgn("0-1"), "resigned", "win"); // draw -> loss
  ins.run("b", "black", "draw", pgn("1-0"), "win", "resigned"); // draw -> loss
  ins.run("c", "white", "draw", pgn("1-0"), "win", "resigned"); // draw -> win
  ins.run("d", "white", "loss", pgn("0-1"), "resigned", "win"); // already right
  d.close();
  return { dir, file };
}

function run(args: string[]) {
  const p = Bun.spawnSync([process.execPath, SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

const results = (file: string) => {
  const d = new Database(file, { readonly: true });
  const rows = d.query("SELECT uuid, result FROM games ORDER BY uuid").all() as { uuid: string; result: string }[];
  d.close();
  return Object.fromEntries(rows.map((r) => [r.uuid, r.result]));
};

describe("scripts/backfill_game_results.ts", () => {
  test("is a DRY RUN by default: prints the counts, writes nothing, makes no backup", () => {
    const { dir, file } = makeDb();
    const r = run(["--db", file, "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.mode).toBe("dry-run");
    expect(out.total).toBe(4);
    expect(out.toChange).toBe(3);
    expect(out.unchanged).toBe(1);
    expect(out.transitions).toEqual({ "draw->loss": 2, "draw->win": 1 });
    expect(out.applied).toBeUndefined();
    expect(results(file)).toEqual({ a: "draw", b: "draw", c: "draw", d: "loss" });
    expect(readdirSync(dir).filter((f) => f.includes(".bak-"))).toEqual([]);
  });

  test("the human-readable dry run says it is a dry run and how to apply", () => {
    const { file } = makeDb();
    const r = run(["--db", file]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN/);
    expect(r.out).toMatch(/draw\s*->\s*loss\s+2/);
    expect(r.out).toMatch(/--apply/);
    expect(results(file)).toEqual({ a: "draw", b: "draw", c: "draw", d: "loss" });
  });

  test("--apply takes a timestamped backup FIRST, then writes the changes", () => {
    const { dir, file } = makeDb();
    const r = run(["--db", file, "--apply", "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.mode).toBe("apply");
    expect(out.applied).toBe(3);
    expect(out.backup).toMatch(/chess_trainer\.db\.bak-\d{8}-\d{6}$/);
    expect(existsSync(out.backup)).toBe(true);
    expect(readdirSync(dir).filter((f) => /\.bak-\d{8}-\d{6}$/.test(f)).length).toBe(1);

    // The live DB has the fixes; the backup still has the pre-change data.
    expect(results(file)).toEqual({ a: "loss", b: "loss", c: "win", d: "loss" });
    expect(results(out.backup)).toEqual({ a: "draw", b: "draw", c: "draw", d: "loss" });
  });

  test("a dry run also works on a WAL-mode DB with no -wal/-shm files (a .backup copy, or a stopped server)", () => {
    const { dir, file } = makeDb();
    // Fold the WAL into the main file, then drop the side files: a read-only open
    // of this DB fails with SQLITE_CANTOPEN on some SQLite builds.
    const d = new Database(file);
    d.query("PRAGMA wal_checkpoint(TRUNCATE)").run();
    d.close();
    rmSync(`${file}-wal`, { force: true });
    rmSync(`${file}-shm`, { force: true });
    expect(existsSync(`${file}-wal`) || existsSync(`${file}-shm`)).toBe(false);

    const r = run(["--db", file, "--json"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out);
    expect(out.mode).toBe("dry-run");
    expect(out.toChange).toBe(3);
    expect(readdirSync(dir).filter((f) => f.includes(".bak-"))).toEqual([]);
  });

  test("after --apply a second run finds nothing to change", () => {
    const { file } = makeDb();
    run(["--db", file, "--apply"]);
    const again = JSON.parse(run(["--db", file, "--json"]).out);
    expect(again.toChange).toBe(0);
    expect(again.transitions).toEqual({});
  });

  test("--apply with nothing to change takes no backup and writes nothing", () => {
    const { dir, file } = makeDb();
    run(["--db", file, "--apply"]);
    const before = readdirSync(dir).filter((f) => f.includes(".bak-")).length;
    const r = JSON.parse(run(["--db", file, "--apply", "--json"]).out);
    expect(r.applied).toBe(0);
    expect(readdirSync(dir).filter((f) => f.includes(".bak-")).length).toBe(before);
  });

  test("a missing DB is an error and is NOT created", () => {
    const dir = mkdtempSync(join(tmpdir(), "gr-backfill-"));
    dirs.push(dir);
    const file = join(dir, "nope.db");
    const r = run(["--db", file]);
    expect(r.code).not.toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  test("an unknown flag is refused", () => {
    const { file } = makeDb();
    const r = run(["--db", file, "--applly"]);
    expect(r.code).not.toBe(0);
    expect(r.err + r.out).toMatch(/usage/i);
    expect(results(file)).toEqual({ a: "draw", b: "draw", c: "draw", d: "loss" });
  });
});
