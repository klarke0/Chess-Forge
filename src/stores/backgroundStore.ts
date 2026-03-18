import { create } from 'zustand';

interface BackgroundState {
  isAnalyzing: boolean;
  activeGameName: string | null;
  analyzedCount: number;
  totalInQueue: number;

  setAnalyzing: (val: boolean) => void;
  setStatus: (gameName: string | null, analyzed: number, total: number) => void;
}

export const useBackgroundStore = create<BackgroundState>((set) => ({
  isAnalyzing: false,
  activeGameName: null,
  analyzedCount: 0,
  totalInQueue: 0,

  setAnalyzing: (val) => set({ isAnalyzing: val }),
  setStatus: (activeGameName, analyzedCount, totalInQueue) => set({ activeGameName, analyzedCount, totalInQueue }),
}));
