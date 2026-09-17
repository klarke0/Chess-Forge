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
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();

  constructor(binaryPath?: string) {
    const bin = binaryPath ?? findStockfishBinary();
    if (!bin) throw new Error("stockfish binary not found — brew install stockfish");
    this.proc = Bun.spawn([bin], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    this.reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
    this.send("uci");
    this.send("setoption name Threads value 4");
    this.send("setoption name Hash value 128");
  }

  private send(cmd: string) {
    const stdin = this.proc.stdin as unknown as { write(data: string): void; flush(): void };
    stdin.write(cmd + "\n");
    stdin.flush();
  }

  /** Read lines until one matches `until`; return every line seen. */
  private async readUntil(until: RegExp, timeoutMs: number): Promise<string[]> {
    const lines: string[] = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const nl = this.buffer.indexOf("\n");
      if (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) lines.push(line);
        if (until.test(line)) return lines;
        continue;
      }
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("engine read timeout")), deadline - Date.now()),
        ),
      ]);
      if (chunk.done) throw new Error("engine process closed");
      this.buffer += new TextDecoder().decode(chunk.value);
    }
    throw new Error("engine read timeout");
  }

  evaluate(fen: string, depth = 14): Promise<EngineEval> {
    const job = async (): Promise<EngineEval> => {
      this.send("isready");
      await this.readUntil(/^readyok/, 10_000);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      const lines = await this.readUntil(/^bestmove/, 60_000);

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
