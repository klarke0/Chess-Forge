import { NativeEngine, findStockfishBinary, type EngineEval } from "./engine_native";

/** The slice of NativeEngine the coach needs. Tests pass stubs. */
export interface EvalEngine {
  evaluate(fen: string, depth?: number): Promise<EngineEval>;
}

let shared: NativeEngine | null = null;

function ensure(): NativeEngine {
  if (!shared) {
    if (!findStockfishBinary()) throw new Error("stockfish binary not found");
    shared = new NativeEngine();
  }
  return shared;
}

/**
 * One long-lived Stockfish shared by all coach requests (NativeEngine
 * serializes internally). If the process dies, the next call respawns it.
 */
export function getCoachEngine(): EvalEngine {
  return {
    async evaluate(fen, depth) {
      const engine = ensure();
      try {
        return await engine.evaluate(fen, depth);
      } catch (err) {
        if (shared === engine) shared = null;
        try {
          engine.dispose();
        } catch {
          /* already dead */
        }
        throw err;
      }
    },
  };
}

/** Fire-and-forget at server start so the first coach call skips engine start-up. */
export function warmCoachEngine(): void {
  try {
    void getCoachEngine()
      .evaluate("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 1)
      .catch(() => {});
  } catch {
    /* no Stockfish installed — coach requests answer 503 */
  }
}
