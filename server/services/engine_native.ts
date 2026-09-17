import { existsSync } from "fs";

export interface EngineEval {
  /** Centipawns, side-to-move POV. null when mate is set. */
  cp: number | null;
  /** Moves to mate, side-to-move POV (positive = side to move mates). */
  mate: number | null;
  bestMoveUci: string;
  pvUci: string[];
}

const CANDIDATE_PATHS = [
  "/opt/homebrew/bin/stockfish",
  "/usr/local/bin/stockfish",
  "/usr/bin/stockfish",
];

export function findStockfishBinary(): string | null {
  for (const p of CANDIDATE_PATHS) if (existsSync(p)) return p;
  return null;
}

/**
 * One long-lived native Stockfish process speaking UCI over stdio.
 * Requests are serialized internally — a single instance is safe to share.
 */
export class NativeEngine {
  private proc: ReturnType<typeof Bun.spawn>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();
  /** Set once the reader pump observes the stream close or error. */
  private closed = false;
  private closeError: Error | null = null;
  /** Woken by the pump whenever new data lands in `buffer`, or on close/error. */
  private waiters: Array<() => void> = [];

  constructor(binaryPath?: string) {
    const bin = binaryPath ?? findStockfishBinary();
    if (!bin) throw new Error("stockfish binary not found — brew install stockfish");
    this.proc = Bun.spawn([bin], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    this.reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
    void this.pump();
    this.send("uci");
    this.send("setoption name Threads value 4");
    this.send("setoption name Hash value 128");
  }

  private send(cmd: string) {
    const stdin = this.proc.stdin as unknown as { write(data: string): void; flush(): void };
    stdin.write(cmd + "\n");
    stdin.flush();
  }

  /**
   * Sole owner of `this.reader` — continuously reads stdout and appends to
   * `this.buffer`, waking anyone blocked in `readUntil`. Because this loop
   * never abandons a `read()` call (unlike a per-call `Promise.race` against
   * a timeout), no chunk can ever be read and then dropped on the floor.
   */
  private async pump(): Promise<void> {
    try {
      while (true) {
        const chunk = await this.reader.read();
        if (chunk.done) {
          this.closed = true;
          this.closeError = new Error("engine process closed");
          break;
        }
        this.buffer += this.decoder.decode(chunk.value, { stream: true });
        this.wake();
      }
    } catch (err) {
      this.closed = true;
      this.closeError = err instanceof Error ? err : new Error(String(err));
    }
    this.wake();
  }

  private wake() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  /** Resolves when the pump appends new data, the stream closes, or `timeoutMs` elapses. */
  private waitForActivity(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve();
      }, timeoutMs);
      this.waiters.push(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Read lines until one matches `until`; return every line seen. Never abandons a read. */
  private async readUntil(until: RegExp, timeoutMs: number): Promise<string[]> {
    const lines: string[] = [];
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) lines.push(line);
        if (until.test(line)) return lines;
        continue;
      }
      if (this.closed) throw this.closeError ?? new Error("engine process closed");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("engine read timeout");
      await this.waitForActivity(remaining);
      if (Date.now() >= deadline && this.buffer.indexOf("\n") < 0 && !this.closed) {
        throw new Error("engine read timeout");
      }
    }
  }

  evaluate(fen: string, depth = 14): Promise<EngineEval> {
    const job = async (): Promise<EngineEval> => {
      this.send("isready");
      await this.readUntil(/^readyok/, 10_000);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      let lines: string[];
      try {
        lines = await this.readUntil(/^bestmove/, 60_000);
      } catch (err) {
        // Tell the engine to end the search so it returns to a clean, idle
        // state before the next request reuses this instance. The pump
        // keeps consuming stdout regardless, so this drain can't lose data.
        this.send("stop");
        try {
          lines = await this.readUntil(/^bestmove/, 5_000);
        } catch {
          throw err;
        }
      }

      let cp: number | null = null;
      let mate: number | null = null;
      let pvUci: string[] = [];
      // Walk backwards: the last full info line before bestmove is the deepest.
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (!l.startsWith("info") || !l.includes(" pv ")) continue;
        const cpM = l.match(/score cp (-?\d+)/);
        const mateM = l.match(/score mate (-?\d+)/);
        const pvM = l.match(/ pv (.+)$/);
        if (cpM) cp = parseInt(cpM[1], 10);
        if (mateM) mate = parseInt(mateM[1], 10);
        if (pvM) pvUci = pvM[1].trim().split(/\s+/);
        break;
      }
      const bestLine = lines[lines.length - 1];
      const bestMoveUci = bestLine.split(/\s+/)[1] ?? "";
      return { cp, mate, bestMoveUci, pvUci };
    };
    const run = this.queue.then(job, job);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  dispose() {
    try {
      this.send("quit");
    } catch {
      /* already dead */
    }
    this.proc.kill();
  }
}
