import { create } from 'zustand';
import { Square } from 'chess.js';

export type TrainingMode = 'full' | 'weak' | 'quiz' | 'learn' | 'study' | 'explore';
export type TrainingStatus = 'idle' | 'training' | 'correct' | 'wrong' | 'complete' | 'demo' | 'novelty' | 'simulating';

type Arrow = [Square, Square, string?];

interface MoveRecord {
  san: string;
  eval?: string;
  comment?: string;
}

interface LedgerRow {
  white: MoveRecord;
  black?: MoveRecord;
}

interface TrainingState {
  mode: TrainingMode;
  status: TrainingStatus;
  message: string;
  hint: string | null;
  mistakeCount: number;
  awaitingNext: boolean;
  ledger: LedgerRow[];
  moveHistory: string[];
  arrows: Arrow[];
  learnRunsCompleted: number;
  studyStep: number;

  // Actions
  setMode: (mode: TrainingMode) => void;
  setLearnRunsCompleted: (n: number) => void;
  setStatus: (status: TrainingStatus) => void;
  setMessage: (msg: string) => void;
  setHint: (hint: string | null) => void;
  incrementMistake: () => void;
  setAwaitingNext: (val: boolean) => void;
  setArrows: (arrows: Arrow[]) => void;
  setStudyStep: (step: number) => void;
  addToHistory: (san: string) => void;
  addLedgerWhite: (entry: MoveRecord) => void;
  updateLedgerBlack: (entry: MoveRecord) => void;
  addToLedger: (move: any) => void;
  popMoves: () => void;
  undo: () => void;
  reset: () => void;
  resetSession: () => void;
}

const initialState = {
  mode: 'full' as TrainingMode,
  status: 'idle' as TrainingStatus,
  message: 'Select a line and start drilling.',
  hint: null as string | null,
  mistakeCount: 0,
  awaitingNext: false,
  ledger: [] as LedgerRow[],
  moveHistory: [] as string[],
  arrows: [] as Arrow[],
  learnRunsCompleted: 0,
  studyStep: 0,
};

export const useTrainingStore = create<TrainingState>((set) => ({
  ...initialState,

  setMode: (mode) => set({ mode }),
  setLearnRunsCompleted: (n) => set({ learnRunsCompleted: n }),
  setStatus: (status) => set({ status }),
  setMessage: (message) => set({ message }),
  setHint: (hint) => set({ hint }),
  incrementMistake: () => set((s) => ({ mistakeCount: s.mistakeCount + 1 })),
  setStudyStep: (studyStep) => set({ studyStep }),

  setAwaitingNext: (awaitingNext) => set({ awaitingNext }),
  setArrows: (arrows) => set({ arrows }),

  addToHistory: (san) => set((s) => ({ moveHistory: [...s.moveHistory, san] })),

  addLedgerWhite: (entry) =>
    set((s) => ({ ledger: [...s.ledger, { white: entry }] })),

  updateLedgerBlack: (entry) =>
    set((s) => ({
      ledger: s.ledger.map((row, i) =>
        i === s.ledger.length - 1 ? { ...row, black: entry } : row
      ),
    })),

  addToLedger: (entry) =>
    set((s) =>
      entry.side === 'white'
        ? { ledger: [...s.ledger, { white: { san: entry.san, eval: entry.eval, comment: entry.comment } }] }
        : {
            ledger: s.ledger.map((r, i) =>
              i === s.ledger.length - 1 ? { ...r, black: { san: entry.san, eval: entry.eval, comment: entry.comment } } : r
            ),
          }
    ),

  popMoves: () =>
    set((s) => ({
      moveHistory: s.moveHistory.slice(0, -2),
      ledger: s.ledger.slice(0, -1),
      mistakeCount: 0,
    })),

  undo: () => set((s) => {
    if (s.moveHistory.length === 0) return s;
    const isEven = s.moveHistory.length % 2 === 0;
    return {
      moveHistory: s.moveHistory.slice(0, -1),
      ledger: isEven 
        ? s.ledger.map((row, i) => i === s.ledger.length - 1 ? { ...row, black: undefined } : row)
        : s.ledger.slice(0, -1),
      studyStep: Math.max(0, s.studyStep - 1),
      status: 'training',
      awaitingNext: false,
      arrows: [],
    };
  }),

  reset: () => set({ ...initialState }),
  resetSession: () => set({
    status: 'idle',
    message: 'Starting new session...',
    hint: null,
    mistakeCount: 0,
    awaitingNext: false,
    ledger: [],
    moveHistory: [],
    arrows: [],
  }),
}));
