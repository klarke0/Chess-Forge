import * as api from './api';

export async function analyzePosition(
  fen: string,
  lastMove: string,
  turn: string,
  engineData?: { bestMove: string; eval: string; line: string },
  openingName = 'your opening',
  repertoireComment?: string,
  userColor?: string,
  mode?: string,
  repertoireMoves?: string[],
  mastersData?: import('./api').MastersData | null,
) {
  try {
    return await api.analyzePosition({ fen, lastMove, turn, userColor, engineData, openingName, repertoireComment, mode, repertoireMoves, mastersData });
  } catch (error) {
    console.error("AI Coach error:", error);
    return {
      text: "Coach unavailable — check your connection or start the backend server.",
      demoLine: [],
      isError: true,
    };
  }
}

export async function generateRepertoireComment(
  fen: string,
  engineLine: string,
  explorerData: any,
  userColor: string
) {
  try {
    const res = await api.request<{ comment: string }>('/analyze/repertoire-comment', {
      method: 'POST',
      body: JSON.stringify({ fen, engineLine, explorerData, userColor })
    });
    return res.comment;
  } catch (error) {
    console.error("AI Generation error:", error);
    return "This move is recommended based on engine analysis and human master games.";
  }
}
