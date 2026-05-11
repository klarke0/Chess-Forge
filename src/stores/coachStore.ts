import { create } from "zustand";
import { useRepertoireStore } from "./repertoireStore";
import type { MastersData } from "../services/api";

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
  analyzePosition: (
    fen: string,
    lastMove: string,
    turn: string,
    engineData?: { bestMove: string; eval: string; line: string },
    repertoireComment?: string,
    userColor?: string,
    mode?: string,
    repertoireMoves?: string[],
    moveHistory?: string[],
    deviationContext?: {
      moveNumber: number;
      playedSan: string;
      repertoireSan: string;
      evalDiff: number;
    } | null,
  ) => Promise<void>;
}

export const useCoachStore = create<CoachState>((set) => ({
  currentInsight: null,
  demoLine: [],
  isAnalyzing: false,
  isError: false,
  mastersData: null,

  setInsight: (insight) => set({ currentInsight: insight }),

  setDemoLine: (line) => set({ demoLine: line }),

  clearInsight: () =>
    set({ currentInsight: null, demoLine: [], isError: false }),

  setMastersData: (data) => set({ mastersData: data }),

  analyzePosition: async (
    fen,
    lastMove,
    turn,
    engineData,
    repertoireComment,
    userColor,
    mode,
    repertoireMoves,
    moveHistory,
    deviationContext,
  ) => {
    set({ isAnalyzing: true, isError: false, currentInsight: null });
    try {
      const openingName =
        useRepertoireStore.getState().repertoireName || "your opening";
      const { mastersData } = useCoachStore.getState();

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fen,
          lastMove,
          turn,
          userColor,
          engineData,
          openingName,
          repertoireComment,
          mode,
          repertoireMoves,
          mastersData,
          moveHistory,
          deviationContext,
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        set({
          currentInsight: (body as any).text || "Coach unavailable.",
          isError: true,
          isAnalyzing: false,
        });
        return;
      }

      const contentType = res.headers.get("Content-Type") ?? "";
      if (contentType.includes("text/event-stream")) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            try {
              const event = JSON.parse(dataStr);
              if (event.done) {
                set({
                  currentInsight:
                    event.analysisText ||
                    accumulated
                      .replace(/^ANALYSIS:\s*/i, "")
                      .split(/\nLINE:/i)[0]
                      .trim(),
                  demoLine: event.demoLine ?? [],
                  isError: false,
                  isAnalyzing: false,
                });
              } else if (event.token) {
                accumulated += event.token;
                const display = accumulated
                  .replace(/^ANALYSIS:\s*/i, "")
                  .split(/\nLINE:/i)[0]
                  .trim();
                set({ currentInsight: display || null });
              }
            } catch { /* malformed SSE line — skip */ }
          }
        }
      } else {
        const data = await res.json();
        set({
          currentInsight: data.text,
          demoLine: data.demoLine ?? [],
          isError: data.isError ?? false,
          isAnalyzing: false,
        });
      }
    } catch (e) {
      console.error(e);
      set({ isError: true, isAnalyzing: false });
    }
  },
}));
