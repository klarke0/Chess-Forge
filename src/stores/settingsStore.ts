import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'night';
export type BoardColorScheme = 'slate' | 'green' | 'blue' | 'walnut';

interface BoardSettings {
  showVision: boolean;
  showEngine: boolean;
  autoAnalyze: boolean;
  showThreats: boolean;
}

interface SettingsState {
  // === Existing groups (unchanged) ===
  training: {
    showVision: boolean;
    autoProceed: boolean;
  };
  analysis: BoardSettings;
  lab: {
    showVision: boolean;
    showEngine: boolean;
  };

  // === New groups ===
  appearance: {
    theme: Theme;
  };
  sound: {
    enabled: boolean;
  };
  board: {
    showCoordinates: boolean;
    animatePieces: boolean;
    colorScheme: BoardColorScheme;
  };
  engine: {
    lines: 1 | 2 | 3;
    depth: 16 | 20 | 24;
  };

  // === Existing actions ===
  toggleTrainingVision: () => void;
  setAnalysisSetting: (key: keyof BoardSettings, value: boolean) => void;
  toggleAnalysisVision: () => void;
  toggleAnalysisThreats: () => void;
  setLabSetting: (key: keyof SettingsState['lab'], value: boolean) => void;
  toggleLabVision: () => void;

  // === New actions ===
  setTheme: (theme: Theme) => void;
  toggleSound: () => void;
  toggleAutoProceed: () => void;
  setBoardSetting: <K extends keyof SettingsState['board']>(key: K, value: SettingsState['board'][K]) => void;
  setEngineLines: (lines: 1 | 2 | 3) => void;
  setEngineDepth: (depth: 16 | 20 | 24) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      training: {
        showVision: false,
        autoProceed: false,
      },
      analysis: {
        showVision: false,
        showEngine: false,
        autoAnalyze: false,
        showThreats: false,
      },
      lab: {
        showVision: false,
        showEngine: false,
      },
      appearance: {
        theme: 'dark',
      },
      sound: {
        enabled: true,
      },
      board: {
        showCoordinates: true,
        animatePieces: true,
        colorScheme: 'slate',
      },
      engine: {
        lines: 3,
        depth: 20,
      },

      toggleTrainingVision: () =>
        set((state) => ({
          training: { ...state.training, showVision: !state.training.showVision },
        })),
      setAnalysisSetting: (key, value) =>
        set((state) => ({
          analysis: { ...state.analysis, [key]: value },
        })),
      toggleAnalysisVision: () =>
        set((state) => ({
          analysis: { ...state.analysis, showVision: !state.analysis.showVision },
        })),
      toggleAnalysisThreats: () =>
        set((state) => ({
          analysis: { ...state.analysis, showThreats: !state.analysis.showThreats },
        })),
      setLabSetting: (key, value) =>
        set((state) => ({
          lab: { ...state.lab, [key]: value },
        })),
      toggleLabVision: () =>
        set((state) => ({
          lab: { ...state.lab, showVision: !state.lab.showVision },
        })),

      setTheme: (theme) =>
        set((state) => ({ appearance: { ...state.appearance, theme } })),
      toggleSound: () =>
        set((state) => ({ sound: { enabled: !state.sound.enabled } })),
      toggleAutoProceed: () =>
        set((state) => ({
          training: { ...state.training, autoProceed: !state.training.autoProceed },
        })),
      setBoardSetting: (key, value) =>
        set((state) => ({ board: { ...state.board, [key]: value } })),
      setEngineLines: (lines) =>
        set((state) => ({ engine: { ...state.engine, lines } })),
      setEngineDepth: (depth) =>
        set((state) => ({ engine: { ...state.engine, depth } })),
    }),
    {
      name: 'chess-forge-settings',
      partialize: (state) => ({
        training: state.training,
        analysis: state.analysis,
        lab: state.lab,
        appearance: state.appearance,
        sound: state.sound,
        board: state.board,
        engine: state.engine,
      }),
    }
  )
);
