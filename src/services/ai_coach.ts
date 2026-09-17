import * as api from "./api";

export async function analyzePosition(
  fen: string,
  lastMove: string,
  turn: string,
  engineData?: { bestMove: string; eval: string; line: string },
  openingName = "your opening",
  repertoireComment?: string,
  userColor?: string,
  mode?: string,
  repertoireMoves?: string[],
  mastersData?: import("./api").MastersData | null,
  moveHistory?: string[],
  deviationContext?: {
    moveNumber: number;
    playedSan: string;
    repertoireSan: string;
    evalDiff: number;
  } | null,
) {
  try {
    return await api.analyzePosition({
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
    });
  } catch (error) {
    console.error("AI Coach error:", error);
    return {
      text: "Coach unavailable — check your connection or start the backend server.",
      demoLine: [],
      isError: true,
    };
  }
}

