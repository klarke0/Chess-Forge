/**
 * Backfill `games.result` (win / loss / draw, from the USER's perspective).
 *
 * Why: `syncGames` used to match chess.com's loser codes against "resign"
 * instead of "resigned" (and knew nothing of "lose", "kingofthehill", ...), so
 * every game the user resigned was stored as a draw. This recomputes each
 * game's result from data already in the DB — the PGN `[Result]` header + the
 * colour the user played, then the Termination text, then the stored chess.com
 * codes — so it needs no network.
 *
 *   bun scripts/backfill_game_results.ts                  dry run (default): prints counts, writes nothing
 *   bun scripts/backfill_game_results.ts --apply          backs up the DB, then fixes the rows in ONE transaction
 *   bun scripts/backfill_game_results.ts --db <path>      target another DB (default: $CHESS_DB_PATH or server/chess_trainer.db)
 *   bun scripts/backfill_game_results.ts --json           machine-readable output
 *
 * --apply first writes `<db>.bak-YYYYMMDD-HHMMSS` with `VACUUM INTO` (a
 * consistent snapshot even while the server has the DB open in WAL mode),
 * verifies it, and only then updates. With nothing to change it does neither.
 * Safe to re-run: a second run finds nothing to change.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join, resolve } from "path";
import {
  applyResultBackfill,
  planResultBackfill,
  type ResultBackfillPlan,
} from "../server/utils/gameResult";

const USAGE = `usage: bun scripts/backfill_game_results.ts [--db <path>] [--apply] [--json]

  (default)   dry run: print what would change, write nothing
  --apply     back up the DB (<db>.bak-YYYYMMDD-HHMMSS), then write the changes in one transaction
  --db <path> database to use (default: $CHESS_DB_PATH, else server/chess_trainer.db)
  --json      print a machine-readable summary`;

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

// ---- args
let dbArg: string | null = null;
let apply = false;
let json = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--apply") apply = true;
  else if (a === "--json") json = true;
  else if (a === "--db") {
    const v = argv[++i];
    if (!v || v.startsWith("--")) fail(`--db needs a path\n\n${USAGE}`, 2);
    dbArg = v;
  } else if (a === "--help" || a === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else fail(`unknown argument: ${a}\n\n${USAGE}`, 2);
}

const dbPath = resolve(
  dbArg ?? process.env.CHESS_DB_PATH ?? join(import.meta.dir, "..", "server", "chess_trainer.db"),
);
if (!existsSync(dbPath)) fail(`database not found: ${dbPath}`);

function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Consistent snapshot of `db` at `backupPath` (VACUUM INTO refuses to overwrite), verified by row count. */
function backup(db: Database, backupPath: string, expectedGames: number): void {
  if (existsSync(backupPath)) fail(`backup path already exists, refusing to overwrite: ${backupPath}`);
  db.query("VACUUM INTO ?").run(backupPath);
  const check = new Database(backupPath, { readonly: true });
  try {
    const n = (check.query("SELECT COUNT(*) AS c FROM games").get() as { c: number }).c;
    if (n !== expectedGames) fail(`backup verification failed: ${n} games in the backup, expected ${expectedGames}`);
  } finally {
    check.close();
  }
}

function summarize(plan: ResultBackfillPlan) {
  const samples: Record<string, number[]> = {};
  for (const c of plan.changes) {
    const key = `${c.from ?? "null"}->${c.to}`;
    const ids = (samples[key] ??= []);
    if (ids.length < 5) ids.push(c.id);
  }
  return {
    db: dbPath,
    total: plan.total,
    unchanged: plan.unchanged,
    undetermined: plan.undetermined,
    toChange: plan.changes.length,
    transitions: plan.transitions,
    sampleIds: samples,
    crossCheck: plan.crossCheck,
  };
}

/**
 * Dry runs prefer a read-only connection. A WAL-mode DB with no -wal/-shm files
 * (a `.backup` copy, or the server is stopped) cannot be opened read-only on some
 * SQLite builds — SQLITE_CANTOPEN on the first query — so fall back to a normal
 * connection, which a dry run still only ever SELECTs through.
 */
function openDb(readonly: boolean): Database {
  if (!readonly) return new Database(dbPath);
  try {
    const ro = new Database(dbPath, { readonly: true });
    ro.query("SELECT 1 FROM sqlite_master LIMIT 1").get(); // fail here, not mid-plan
    return ro;
  } catch {
    return new Database(dbPath);
  }
}

// ---- run
const db = openDb(!apply);
try {
  if (apply) db.query("PRAGMA busy_timeout = 5000").run();
  const plan = planResultBackfill(db);
  const summary = summarize(plan);

  let backupPath: string | null = null;
  let applied: number | null = null;
  if (apply && plan.changes.length > 0) {
    backupPath = `${dbPath}.bak-${timestamp()}`;
    backup(db, backupPath, plan.total);
    applied = applyResultBackfill(db, plan.changes);
  } else if (apply) {
    applied = 0;
  }

  if (json) {
    console.log(
      JSON.stringify({
        mode: apply ? "apply" : "dry-run",
        ...summary,
        ...(apply ? { applied, backup: backupPath } : {}),
      }),
    );
  } else {
    console.log(
      apply
        ? "Game result backfill - APPLY"
        : "Game result backfill - DRY RUN (nothing is written; re-run with --apply to write)",
    );
    console.log(`DB: ${dbPath}`);
    console.log(
      `games: ${plan.total} | already correct: ${plan.unchanged} | to change: ${plan.changes.length} | undetermined (left as is): ${plan.undetermined}`,
    );
    console.log(
      `cross-check (PGN vs chess.com codes): compared ${plan.crossCheck.compared}, mismatches ${plan.crossCheck.mismatches}`,
    );
    const keys = Object.keys(plan.transitions).sort((a, b) => plan.transitions[b] - plan.transitions[a]);
    if (keys.length === 0) console.log("changes: none");
    else {
      console.log("changes (stored -> recomputed):");
      for (const k of keys) {
        const [from, to] = k.split("->");
        console.log(
          `  ${from.padEnd(5)} -> ${to.padEnd(5)} ${String(plan.transitions[k]).padStart(5)}   e.g. ids ${summary.sampleIds[k].join(", ")}`,
        );
      }
    }
    if (apply) {
      if (backupPath) console.log(`backup: ${backupPath}`);
      console.log(`applied: ${applied} rows updated${applied ? " in one transaction" : ""}`);
    }
  }
} finally {
  db.close();
}
