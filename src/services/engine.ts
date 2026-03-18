import { useState, useEffect } from 'react';

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
      this.worker = new Worker('/stockfish.js');

      this.worker.onmessage = (e) => {
        const data = e.data as string;
        if (typeof data === 'string' && data.includes('uciok')) {
          this._ready = true;
          this._readyCallbacks.forEach(cb => cb());
          this._readyCallbacks = [];
          this._errorCallbacks = [];
        }
        if (this.onMessage) this.onMessage(data);
      };

      this.worker.onerror = (e) => {
        console.error("Stockfish worker error:", e);
        const err = new Error('Stockfish worker failed to load');
        this._errorCallbacks.forEach(cb => cb(err));
        this._readyCallbacks = [];
        this._errorCallbacks = [];
      };

      this.worker.postMessage('uci');
      this.worker.postMessage('setoption name MultiPV value 3');
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

  evaluateOnce(fen: string, depth: number = 16): Promise<{ cp: number | null; mate: number | null; pv: string; bestMove: string }> {
    return new Promise((resolve) => {
      if (!this.worker) { resolve({ cp: null, mate: null, pv: '', bestMove: '' }); return; }
      let lastCp: number | null = null;
      let lastMate: number | null = null;
      let lastPv: string = '';
      
      // Strict timeout: resolve after 5s no matter what to prevent stalls
      const timeout = setTimeout(() => {
        if (this.worker) this.worker.onmessage = prevOnMessage;
        resolve({ cp: lastCp, mate: lastMate, pv: lastPv, bestMove: '' });
      }, 5000);

      const prevOnMessage = this.worker.onmessage;
      this.worker.onmessage = (e: MessageEvent) => {
        const data = e.data as string;
        if (typeof data !== 'string') return;
        
        // Only parse info depth lines to save CPU
        if (data.startsWith('info depth')) {
          const cpMatch = data.match(/score cp (-?\d+)/);
          const mateMatch = data.match(/score mate (-?\d+)/);
          const pvMatch = data.match(/ pv (.*)/);
          
          if (cpMatch) lastCp = parseInt(cpMatch[1], 10);
          if (mateMatch) lastMate = parseInt(mateMatch[1], 10);
          if (pvMatch) lastPv = pvMatch[1];
        }

        if (data.startsWith('bestmove')) {
          clearTimeout(timeout);
          const bestMove = data.split(' ')[1];
          this.worker!.onmessage = prevOnMessage;
          resolve({ cp: lastCp, mate: lastMate, pv: lastPv, bestMove });
        }
      };
      
      // Force single-PV mode for accurate evaluation (init sets MultiPV 3 for live analysis)
      this.worker.postMessage('setoption name MultiPV value 1');
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  stop() {
    if (this.worker) this.worker.postMessage('stop');
  }

  quit() {
    if (this.worker) {
      this.worker.postMessage('quit');
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
      if (typeof data !== 'string') return;
      
      if (data.includes('info depth') && data.includes('multipv')) {
        const multipvMatch = data.match(/multipv (\d+)/);
        const scoreMatch = data.match(/score cp (-?\d+)/);
        const mateMatch = data.match(/score mate (-?\d+)/);
        const pvMatch = data.match(/ pv (.*)/);

        if (multipvMatch && pvMatch) {
          const multipv = parseInt(multipvMatch[1], 10);
          const cp = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
          const mate = mateMatch ? parseInt(mateMatch[1], 10) : null;
          const pv = pvMatch[1];

          setTopLines(prev => {
            const newLines = [...prev];
            const index = newLines.findIndex(l => l.multipv === multipv);
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
