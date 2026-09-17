import { useState, useEffect } from "react";

export interface EngineLine {
  pv: string;
  cp: number | null;
  mate: number | null;
  multipv: number;
}

export class StockfishEngine {
  worker: Worker | null = null;
  onMessage: ((msg: any) => void) | null = null;
  private _ready = false;
  private _readyCallbacks: Array<() => void> = [];
  private _errorCallbacks: Array<(e: Error) => void> = [];

  constructor() {
    this.init();
  }

  init() {
    try {
      this.worker = new Worker("/stockfish.js");

      this.worker.onmessage = (e) => {
        const data = e.data as string;
        if (typeof data === "string" && data.includes("uciok")) {
          this._ready = true;
          this._readyCallbacks.forEach((cb) => cb());
          this._readyCallbacks = [];
          this._errorCallbacks = [];
        }
        if (this.onMessage) this.onMessage(data);
      };

      this.worker.onerror = (e) => {
        console.error("Stockfish worker error:", e);
        const err = new Error("Stockfish worker failed to load");
        this._errorCallbacks.forEach((cb) => cb(err));
        this._readyCallbacks = [];
        this._errorCallbacks = [];
      };

      this.worker.postMessage("uci");
      this.worker.postMessage("setoption name MultiPV value 3");
    } catch (e) {
      console.error("Stockfish failed:", e);
    }
  }

  waitUntilReady(): Promise<void> {
    if (this._ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this._readyCallbacks.push(resolve);
      this._errorCallbacks.push(reject);
    });
  }

  evaluate(fen: string, depth: number = 15) {
    if (this.worker) {
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    }
  }

  /**
   * Single-shot requests (evaluateOnce / evaluateMultiPV) temporarily swap the
   * worker's onmessage handler, so two in flight consume each other's output —
   * including cross-clobber between screens sharing the engineStore engine.
   * Serialize them through this promise chain.
   */
  private _queue: Promise<unknown> = Promise.resolve();

  private _enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this._queue.then(job, job);
    this._queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  evaluateOnce(
    fen: string,
    depth: number = 16,
  ): Promise<{
    cp: number | null;
    mate: number | null;
    pv: string;
    bestMove: string;
  }> {
    return this._enqueue(() => this._evaluateOnce(fen, depth));
  }

  private _evaluateOnce(
    fen: string,
    depth: number,
  ): Promise<{
    cp: number | null;
    mate: number | null;
    pv: string;
    bestMove: string;
  }> {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve({ cp: null, mate: null, pv: "", bestMove: "" });
        return;
      }
      let lastCp: number | null = null;
      let lastMate: number | null = null;
      let lastPv: string = "";

      // On overrun, tell the engine to stop — it then emits its final
      // `bestmove`, which the handler below resolves normally. Detaching
      // without the stop leaked the abandoned search's output into the next
      // request (off-by-one evals persisted into analysis_json). The fallback
      // timer only fires if the worker is wedged.
      let fallback: ReturnType<typeof setTimeout> | null = null;
      const timeout = setTimeout(() => {
        this.worker?.postMessage("stop");
        fallback = setTimeout(() => {
          if (this.worker) {
            this.worker.onmessage = prevOnMessage;
            this.worker.postMessage("setoption name MultiPV value 3");
          }
          resolve({
            cp: lastCp,
            mate: lastMate,
            pv: lastPv,
            bestMove: lastPv.split(" ")[0] ?? "",
          });
        }, 2000);
      }, 5000);

      const prevOnMessage = this.worker.onmessage;
      this.worker.onmessage = (e: MessageEvent) => {
        const data = e.data as string;
        if (typeof data !== "string") return;

        // Only parse info depth lines to save CPU
        if (data.startsWith("info depth")) {
          const cpMatch = data.match(/score cp (-?\d+)/);
          const mateMatch = data.match(/score mate (-?\d+)/);
          const pvMatch = data.match(/ pv (.*)/);

          if (cpMatch) lastCp = parseInt(cpMatch[1], 10);
          if (mateMatch) lastMate = parseInt(mateMatch[1], 10);
          if (pvMatch) lastPv = pvMatch[1];
        }

        if (data.startsWith("bestmove")) {
          clearTimeout(timeout);
          if (fallback) clearTimeout(fallback);
          const bestMove = data.split(" ")[1];
          this.worker!.onmessage = prevOnMessage;
          // Restore MultiPV 3 for live analysis after single-shot eval
          this.worker!.postMessage("setoption name MultiPV value 3");
          resolve({ cp: lastCp, mate: lastMate, pv: lastPv, bestMove });
        }
      };

      // Force single-PV mode for accurate evaluation (init sets MultiPV 3 for live analysis)
      this.worker.postMessage("setoption name MultiPV value 1");
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  evaluateMultiPV(
    fen: string,
    depth: number = 20,
    numLines: number = 3,
  ): Promise<
    Array<{ rank: number; cp: number | null; mate: number | null; pv: string }>
  > {
    return this._enqueue(() => this._evaluateMultiPV(fen, depth, numLines));
  }

  private _evaluateMultiPV(
    fen: string,
    depth: number,
    numLines: number,
  ): Promise<
    Array<{ rank: number; cp: number | null; mate: number | null; pv: string }>
  > {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve([]);
        return;
      }

      const lines = new Map<
        number,
        { depth: number; cp: number | null; mate: number | null; pv: string }
      >();

      function buildResult() {
        return Array.from(lines.entries())
          .map(([rank, line]) => ({
            rank,
            cp: line.cp,
            mate: line.mate,
            pv: line.pv,
          }))
          .sort((a, b) => a.rank - b.rank);
      }

      // On overrun, stop the search and let its final `bestmove` resolve with
      // whatever depth was reached; the fallback only fires on a wedged worker.
      let fallback: ReturnType<typeof setTimeout> | null = null;
      const timeout = setTimeout(() => {
        this.worker?.postMessage("stop");
        fallback = setTimeout(() => {
          if (this.worker) {
            this.worker.onmessage = prevOnMessage;
            this.worker.postMessage("setoption name MultiPV value 3");
          }
          resolve(buildResult());
        }, 2000);
      }, 15000);

      const prevOnMessage = this.worker.onmessage;
      this.worker.onmessage = (e: MessageEvent) => {
        const data = e.data as string;
        if (typeof data !== "string") return;

        if (data.startsWith("info depth")) {
          const depthMatch = data.match(/\bdepth (\d+)/);
          const currentDepth = depthMatch ? parseInt(depthMatch[1]) : 0;
          const multipvMatch = data.match(/multipv (\d+)/);
          const cpMatch = data.match(/score cp (-?\d+)/);
          const mateMatch = data.match(/score mate (-?\d+)/);
          const pvMatch = data.match(/ pv (.+)/);

          if (multipvMatch && pvMatch) {
            const rank = parseInt(multipvMatch[1]);
            // Keep the deepest line seen per rank. Searches that end early
            // (forced moves, quick mates, stopped overruns) never reach the
            // target depth; a best-effort line beats returning [] and letting
            // the challenge UI call a valid drill "ambiguous".
            const prev = lines.get(rank);
            if (!prev || currentDepth >= prev.depth) {
              lines.set(rank, {
                depth: currentDepth,
                cp: cpMatch ? parseInt(cpMatch[1]) : null,
                mate: mateMatch ? parseInt(mateMatch[1]) : null,
                pv: pvMatch[1].trim(),
              });
            }
          }
        }

        if (data.startsWith("bestmove")) {
          clearTimeout(timeout);
          if (fallback) clearTimeout(fallback);
          this.worker!.onmessage = prevOnMessage;
          this.worker!.postMessage("setoption name MultiPV value 3");
          resolve(buildResult());
        }
      };

      this.worker.postMessage(`setoption name MultiPV value ${numLines}`);
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  stop() {
    if (this.worker) this.worker.postMessage("stop");
  }

  quit() {
    if (this.worker) {
      this.worker.postMessage("quit");
      this.worker.terminate();
    }
  }
}

export const useStockfish = () => {
  const [topLines, setTopLines] = useState<EngineLine[]>([]);
  const [engine, setEngine] = useState<StockfishEngine | null>(null);

  useEffect(() => {
    const eng = new StockfishEngine();

    eng.onMessage = (data: any) => {
      if (typeof data !== "string") return;

      if (data.includes("info depth") && data.includes("multipv")) {
        const multipvMatch = data.match(/multipv (\d+)/);
        const scoreMatch = data.match(/score cp (-?\d+)/);
        const mateMatch = data.match(/score mate (-?\d+)/);
        const pvMatch = data.match(/ pv (.*)/);

        if (multipvMatch && pvMatch) {
          const multipv = parseInt(multipvMatch[1], 10);
          const cp = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
          const mate = mateMatch ? parseInt(mateMatch[1], 10) : null;
          const pv = pvMatch[1];

          setTopLines((prev) => {
            const newLines = [...prev];
            const index = newLines.findIndex((l) => l.multipv === multipv);
            const newLine = { pv, cp, mate, multipv };

            if (index !== -1) {
              newLines[index] = newLine;
            } else {
              newLines.push(newLine);
            }
            return newLines.sort((a, b) => a.multipv - b.multipv);
          });
        }
      }
    };

    setEngine(eng);

    return () => {
      eng.quit();
    };
  }, []);

  return { engine, topLines };
};
