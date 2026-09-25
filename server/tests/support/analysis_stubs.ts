import { Chess } from "chess.js";
import { Database } from "bun:sqlite";
import type { EngineEval } from "../../services/engine_native";
import { runMigrations } from "../../db";
import { normalizeFen } from "../../utils/fen";

/** FENs a game passes through: the start position, then the position after every ply. */
export function positionsOf(pgn: string): string[] {
  const c = new Chess();
  c.loadPgn(pgn);
  const h = c.history({ verbose: true });
  return h.length ? [h[0].before, ...h.map((m) => m.after)] : [new Chess().fen()];
}

/** Scripted result for one position. `white` is WHITE-POV centipawns; `mate` is side-to-move POV. */
export type Entry = { white: number; best: string } | { mate: number; best: string };

export interface StubEngine {
  evaluate(fen: string, depth: number, opts?: { movetimeMs?: number }): Promise<EngineEval>;
  dispose(): void;
  /** Every FEN evaluate() was called with, in order. */
  calls: string[];
  /** Depth / movetime of every call, in order. */
  requests: { depth: number; movetimeMs?: number }[];
  disposed: boolean;
}

export interface StubOptions {
  /** Position-keyed script (side-to-move POV is derived from the FEN). Unscripted FENs get cp 0. */
  script?: Map<string, Entry>;
  /** Runs at the START of every evaluate() with the 1-based call number (across the shared counter). */
  onCall?: (n: number) => void | Promise<void>;
  /** Throw an "engine process closed" error on exactly these call numbers. */
  failOnCalls?: number[];
  /** Shared call counter so a restarted engine keeps counting. */
  counter?: { n: number };
}

export function scriptFor(pgn: string, entries: Entry[]): Map<string, Entry> {
  const fens = positionsOf(pgn);
  if (entries.length !== fens.length) {
    throw new Error(`script has ${entries.length} entries for ${fens.length} positions`);
  }
  return new Map(fens.map((f, i) => [normalizeFen(f), entries[i]]));
}

export function makeStubEngine(opts: StubOptions = {}): StubEngine {
  const counter = opts.counter ?? { n: 0 };
  const engine: StubEngine = {
    calls: [],
    requests: [],
    disposed: false,
    dispose() {
      engine.disposed = true;
    },
    async evaluate(fen, depth, o) {
      counter.n++;
      engine.calls.push(fen);
      engine.requests.push({ depth, movetimeMs: o?.movetimeMs });
      await opts.onCall?.(counter.n);
      if (opts.failOnCalls?.includes(counter.n)) throw new Error("engine process closed");
      const entry = opts.script?.get(normalizeFen(fen));
      const sideToMove = fen.split(" ")[1];
      if (!entry) return { cp: 0, mate: null, bestMoveUci: "a2a3", pvUci: [] };
      if ("mate" in entry) return { cp: null, mate: entry.mate, bestMoveUci: entry.best, pvUci: [] };
      const cp = sideToMove === "w" ? entry.white : -entry.white;
      return { cp, mate: null, bestMoveUci: entry.best, pvUci: [] };
    },
  };
  return engine;
}

/** Fresh in-memory DB with the app's real schema + migrations. */
export function memoryDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

export interface GameRow {
  pgn: string;
  date?: string;
  white?: string;
  black?: string;
  userColor?: string;
  analysisJson?: string | null;
  analysisVersion?: number | null;
  analysisFailed?: string | null;
}

let uuidN = 0;
export function insertGame(db: Database, g: GameRow): number {
  const res = db
    .query(
      `INSERT INTO games (uuid, white_username, black_username, user_color, result, pgn, date,
                          analysis_json, analysis_version, analysis_failed)
       VALUES (?, ?, ?, ?, 'win', ?, ?, ?, ?, ?)`,
    )
    .run(
      `test-${++uuidN}`,
      g.white ?? "kevin",
      g.black ?? "opp",
      g.userColor ?? "white",
      g.pgn,
      g.date ?? "2026-01-01T00:00:00.000Z",
      g.analysisJson ?? null,
      g.analysisVersion ?? null,
      g.analysisFailed ?? null,
    );
  return Number(res.lastInsertRowid);
}

export const PGN_A = "1. e4 e5 2. Nf3 Nc6";
export const PGN_B = "1. d4 d5 2. c4 e6";
export const PGN_C = "1. e4 c5 2. Nf3 d6";
export const PGN_MATE = "1. f3 e5 2. g4 Qh4#";
