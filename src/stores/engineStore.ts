import { create } from 'zustand';
import { StockfishEngine, EngineLine } from '../services/engine';

interface EngineState {
  engine: StockfishEngine | null;
  evaluation: { cp: number | null; mate: number | null };
  topLines: EngineLine[];
  currentTurn: 'w' | 'b';
  isReady: boolean;
  showLines: boolean;
  showEvalBar: boolean;

  // Actions
  initEngine: () => void;
  evaluate: (fen: string) => void;
  toggleLines: () => void;
  toggleEvalBar: () => void;
}

export const useEngineStore = create<EngineState>((set, get) => ({
  engine: null,
  evaluation: { cp: null, mate: null },
  topLines: [],
  currentTurn: 'w',
  isReady: false,
  showLines: false,
  showEvalBar: false,

  initEngine: () => {
    if (get().engine) return;

    const engine = new StockfishEngine();
    // We hook into the existing onMessage structure
    engine.onMessage = (data: any) => {
      if (typeof data !== 'string') return;

      const { currentTurn } = get();

      // Eval - Normalize to White perspective
      if (data.includes('info depth') && (data.includes('cp') || data.includes('mate'))) {
        const scoreMatch = data.match(/score cp (-?\d+)/);
        const mateMatch = data.match(/score mate (-?\d+)/);
        
        if (mateMatch && mateMatch[1]) {
          let mate = parseInt(mateMatch[1], 10);
          if (currentTurn === 'b') mate = -mate;
          set({ evaluation: { cp: null, mate } });
        } else if (scoreMatch && scoreMatch[1]) {
          let cp = parseInt(scoreMatch[1], 10);
          if (currentTurn === 'b') cp = -cp;
          set({ evaluation: { cp, mate: null } });
        }
      }

      // MultiPV Lines - keep these side-to-move relative for the "Suggested Moves" list
      if (data.includes('info depth') && data.includes('multipv')) {
        const multipvMatch = data.match(/multipv (\d+)/);
        const pvMatch = data.match(/ pv (.*)/);
        const scoreMatch = data.match(/score cp (-?\d+)/);
        const mateMatch = data.match(/score mate (-?\d+)/);

        if (multipvMatch && pvMatch) {
          const multipv = parseInt(multipvMatch[1], 10);
          const cp = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
          const mate = mateMatch ? parseInt(mateMatch[1], 10) : null;
          
          set(state => {
            const newLines = [...state.topLines];
            const index = newLines.findIndex(l => l.multipv === multipv);
            const newLine = { pv: pvMatch[1], cp, mate, multipv };
            
            if (index !== -1) newLines[index] = newLine;
            else newLines.push(newLine);
            
            return { topLines: newLines.sort((a, b) => a.multipv - b.multipv) };
          });
        }
      }
    };

    set({ engine, isReady: true });
  },

  evaluate: (fen: string) => {
    const { engine } = get();
    if (engine) {
      const turn = (fen.split(' ')[1] || 'w') as 'w' | 'b';
      set({ currentTurn: turn });
      engine.evaluate(fen);
    }
  },

  toggleLines: () => set(state => ({ showLines: !state.showLines })),
  toggleEvalBar: () => set(state => ({ showEvalBar: !state.showEvalBar })),
}));
