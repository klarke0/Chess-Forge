import { create } from 'zustand';
import { analyzePosition } from '../services/ai_coach';
import { useRepertoireStore } from './repertoireStore';
import type { MastersData } from '../services/api';

interface CoachState {
  currentInsight: string | null;
  demoLine: string[];
  isAnalyzing: boolean;
  isError: boolean;
  mastersData: MastersData | null;

  setInsight: (insight: string | null) => void;
  setDemoLine: (line: string[]) => void;
  clearInsight: () => void;
  setMastersData: (data: MastersData | null) => void;
  analyzePosition: (fen: string, lastMove: string, turn: string, engineData?: { bestMove: string; eval: string; line: string }, repertoireComment?: string, userColor?: string, mode?: string, repertoireMoves?: string[]) => Promise<void>;
}

export const useCoachStore = create<CoachState>((set) => ({
  currentInsight: null,
  demoLine: [],
  isAnalyzing: false,
  isError: false,
  mastersData: null,

  setInsight: (insight) => set({ currentInsight: insight }),

  setDemoLine: (line) => set({ demoLine: line }),

  clearInsight: () => set({ currentInsight: null, demoLine: [], isError: false }),

  setMastersData: (data) => set({ mastersData: data }),

  analyzePosition: async (fen, lastMove, turn, engineData, repertoireComment, userColor, mode, repertoireMoves) => {
    set({ isAnalyzing: true, isError: false });
    try {
      const openingName = useRepertoireStore.getState().repertoireName || 'your opening';
      const { mastersData } = useCoachStore.getState();
      const result = await analyzePosition(fen, lastMove, turn, engineData, openingName, repertoireComment, userColor, mode, repertoireMoves, mastersData);
      set({ currentInsight: result.text, demoLine: result.demoLine, isError: result.isError, isAnalyzing: false });
    } catch (e) {
      console.error(e);
      set({ isError: true, isAnalyzing: false });
    }
  },
}));
