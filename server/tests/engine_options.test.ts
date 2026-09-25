import { describe, expect, test } from "bun:test";
import {
  NativeEngine,
  buildGoCommand,
  buildSetupCommands,
  buildSpawnArgs,
  findStockfishBinary,
  resolveEngineOptions,
} from "../services/engine_native";

describe("resolveEngineOptions", () => {
  test("no argument keeps today's defaults (Threads 4, Hash 128, no nice)", () => {
    expect(resolveEngineOptions()).toEqual({
      binaryPath: undefined,
      threads: 4,
      hashMb: 128,
      nice: null,
    });
  });

  test("a bare string is still the binary path (existing call sites)", () => {
    expect(resolveEngineOptions("/opt/sf")).toEqual({
      binaryPath: "/opt/sf",
      threads: 4,
      hashMb: 128,
      nice: null,
    });
  });

  test("an options object overrides only what it names", () => {
    expect(resolveEngineOptions({ threads: 2, nice: 10 })).toEqual({
      binaryPath: undefined,
      threads: 2,
      hashMb: 128,
      nice: 10,
    });
    expect(resolveEngineOptions({ binaryPath: "/x", hashMb: 64 })).toMatchObject({
      binaryPath: "/x",
      threads: 4,
      hashMb: 64,
    });
  });

  test("threads and hash are floored to integers >= 1; nice is clamped to 0..19", () => {
    expect(resolveEngineOptions({ threads: 0 }).threads).toBe(1);
    expect(resolveEngineOptions({ threads: 2.9 }).threads).toBe(2);
    expect(resolveEngineOptions({ hashMb: -5 }).hashMb).toBe(1);
    expect(resolveEngineOptions({ nice: 99 }).nice).toBe(19);
    expect(resolveEngineOptions({ nice: -3 }).nice).toBe(0);
    expect(resolveEngineOptions({ nice: 0 }).nice).toBe(0);
  });
});

describe("command builders", () => {
  test("no nice: the binary is spawned directly", () => {
    expect(buildSpawnArgs("/usr/local/bin/stockfish", null)).toEqual(["/usr/local/bin/stockfish"]);
  });

  test("nice wraps the binary as `nice -n <n> <stockfish>`", () => {
    expect(buildSpawnArgs("/usr/local/bin/stockfish", 10)).toEqual([
      "nice",
      "-n",
      "10",
      "/usr/local/bin/stockfish",
    ]);
  });

  test("setup commands carry the thread and hash options", () => {
    expect(buildSetupCommands({ threads: 4, hashMb: 128 })).toEqual([
      "uci",
      "setoption name Threads value 4",
      "setoption name Hash value 128",
    ]);
    expect(buildSetupCommands({ threads: 2, hashMb: 64 })).toEqual([
      "uci",
      "setoption name Threads value 2",
      "setoption name Hash value 64",
    ]);
  });

  test("go command: depth only by default, depth + movetime when capped", () => {
    expect(buildGoCommand(14)).toBe("go depth 14");
    expect(buildGoCommand(14, undefined)).toBe("go depth 14");
    expect(buildGoCommand(14, 3000)).toBe("go depth 14 movetime 3000");
  });

  test("a non-positive movetime is ignored rather than sent to the engine", () => {
    expect(buildGoCommand(12, 0)).toBe("go depth 12");
    expect(buildGoCommand(12, -1)).toBe("go depth 12");
  });
});

const binary = findStockfishBinary();
const maybe = binary ? describe : describe.skip;

maybe("NativeEngine options (real engine)", () => {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  test("`new NativeEngine(path)` and `new NativeEngine()` still work", async () => {
    const a = new NativeEngine(binary!);
    const b = new NativeEngine();
    const [ra, rb] = await Promise.all([a.evaluate(START, 6), b.evaluate(START, 6)]);
    a.dispose();
    b.dispose();
    expect(ra.bestMoveUci).toMatch(/^[a-h][1-8][a-h][1-8]/);
    expect(rb.bestMoveUci).toMatch(/^[a-h][1-8][a-h][1-8]/);
  }, 30000);

  test("movetimeMs ends a deep search early", async () => {
    const engine = new NativeEngine({ threads: 1, hashMb: 16 });
    const t0 = Date.now();
    // Depth 30 from the start position would take minutes; the cap must win.
    const res = await engine.evaluate(START, 30, { movetimeMs: 150 });
    const elapsed = Date.now() - t0;
    engine.dispose();
    expect(elapsed).toBeLessThan(5000);
    expect(res.bestMoveUci).toMatch(/^[a-h][1-8][a-h][1-8]/);
  }, 30000);

  test("nice option lowers the process priority", async () => {
    const engine = new NativeEngine({ threads: 1, hashMb: 16, nice: 10 });
    await engine.evaluate(START, 4);
    const ps = Bun.spawnSync(["ps", "-o", "nice=", "-p", String(engine.pid)]);
    engine.dispose();
    expect(parseInt(ps.stdout.toString().trim(), 10)).toBeGreaterThanOrEqual(10);
  }, 30000);
});
