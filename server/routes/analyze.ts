import { explainBlunderCore } from "../services/coach";
import { getCoachEngine } from "../services/coach_engine";
import { getCachedCoach, putCachedCoach } from "../services/coach_cache";
import { COACH_RESPONSE_SCHEMA } from "../services/coach_prompt";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GEMINI_STREAM_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse";

// Parse FEN into an explicit piece-by-square description to prevent hallucinations
function describeBoardFromFen(fen: string): string {
  const pieceNames: Record<string, string> = {
    K: "White King",
    Q: "White Queen",
    R: "White Rook",
    B: "White Bishop",
    N: "White Knight",
    P: "White Pawn",
    k: "Black King",
    q: "Black Queen",
    r: "Black Rook",
    b: "Black Bishop",
    n: "Black Knight",
    p: "Black Pawn",
  };
  const ranks = fen.split(" ")[0].split("/");
  const pieces: string[] = [];
  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    let fileIdx = 0;
    for (const ch of ranks[rankIdx]) {
      if (/\d/.test(ch)) {
        fileIdx += parseInt(ch);
      } else {
        const square = String.fromCharCode(97 + fileIdx) + (8 - rankIdx);
        pieces.push(`${pieceNames[ch] ?? ch} on ${square}`);
        fileIdx++;
      }
    }
  }
  return pieces.join(", ");
}

// Derive richer position context from FEN: material, pawn structure, king safety, phase
function describePositionContext(fen: string): string {
  const position = fen.split(" ")[0];
  const castling = fen.split(" ")[2] ?? "-";

  // Material count
  const mat: Record<string, number> = {
    K: 0,
    Q: 0,
    R: 0,
    B: 0,
    N: 0,
    P: 0,
    k: 0,
    q: 0,
    r: 0,
    b: 0,
    n: 0,
    p: 0,
  };
  for (const ch of position) if (ch in mat) mat[ch]++;

  const wMat =
    `${mat.Q ? mat.Q + "Q " : ""}${mat.R ? mat.R + "R " : ""}${mat.B ? mat.B + "B " : ""}${mat.N ? mat.N + "N " : ""}${mat.P ? mat.P + "P" : ""}`.trim();
  const bMat =
    `${mat.q ? mat.q + "Q " : ""}${mat.r ? mat.r + "R " : ""}${mat.b ? mat.b + "B " : ""}${mat.n ? mat.n + "N " : ""}${mat.p ? mat.p + "P" : ""}`.trim();

  // Game phase
  const totalPieces =
    mat.Q + mat.q + mat.R + mat.r + mat.B + mat.b + mat.N + mat.n;
  const phase =
    totalPieces >= 12
      ? "Opening/Early Middlegame"
      : totalPieces >= 6
        ? "Middlegame/Late Middlegame"
        : "Endgame";

  // Pawn structure — find files with multiple pawns (doubled) and isolated pawns
  const wPawnFiles: number[] = [];
  const bPawnFiles: number[] = [];
  const ranks = position.split("/");
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of ranks[r]) {
      if (/\d/.test(ch)) f += parseInt(ch);
      else {
        if (ch === "P") wPawnFiles.push(f);
        if (ch === "p") bPawnFiles.push(f);
        f++;
      }
    }
  }
  const doubled = (files: number[]) =>
    files.filter((f, i) => files.indexOf(f) !== i);
  const isolated = (files: number[]) =>
    files.filter((f) => !files.includes(f - 1) && !files.includes(f + 1));
  const fileLabel = (f: number) => String.fromCharCode(97 + f);

  const pawnNotes: string[] = [];
  const wDoubled = [...new Set(doubled(wPawnFiles))];
  const bDoubled = [...new Set(doubled(bPawnFiles))];
  const wIsolated = [...new Set(isolated(wPawnFiles))];
  const bIsolated = [...new Set(isolated(bPawnFiles))];
  if (wDoubled.length)
    pawnNotes.push(
      `White doubled pawns on ${wDoubled.map(fileLabel).join(",")}-file`,
    );
  if (bDoubled.length)
    pawnNotes.push(
      `Black doubled pawns on ${bDoubled.map(fileLabel).join(",")}-file`,
    );
  if (wIsolated.length)
    pawnNotes.push(
      `White isolated pawn(s) on ${wIsolated.map(fileLabel).join(",")}-file`,
    );
  if (bIsolated.length)
    pawnNotes.push(
      `Black isolated pawn(s) on ${bIsolated.map(fileLabel).join(",")}-file`,
    );

  // King safety
  const wKingSafe =
    castling.includes("K") || castling.includes("Q")
      ? "not yet castled"
      : "castled or castling rights lost";
  const bKingSafe =
    castling.includes("k") || castling.includes("q")
      ? "not yet castled"
      : "castled or castling rights lost";

  return [
    `Phase: ${phase}`,
    `White material: ${wMat || "King only"}`,
    `Black material: ${bMat || "King only"}`,
    `White king: ${wKingSafe}`,
    `Black king: ${bKingSafe}`,
    ...(pawnNotes.length
      ? [`Pawn structure notes: ${pawnNotes.join("; ")}`]
      : []),
  ].join("\n    ");
}

function parseDemoLine(
  fullText: string,
  repertoireMoves?: string[],
  userColor?: string,
  activeColor?: string,
): string[] {
  const linePart = fullText.match(/LINE:\s*\[(.*?)\]/i);
  const rawDemoLine = linePart
    ? linePart[1]
        .split(",")
        .map((m: string) => m.trim().replace(/['"[\]]/g, ""))
    : [];
  let demoLine = rawDemoLine.filter((m: string) => m.length > 0);
  if (
    repertoireMoves &&
    repertoireMoves.length > 0 &&
    activeColor &&
    userColor &&
    activeColor.toLowerCase() === userColor.toLowerCase() &&
    demoLine.length > 0 &&
    !repertoireMoves.includes(demoLine[0])
  ) {
    demoLine = [repertoireMoves[0], ...demoLine.slice(1)];
  }
  return demoLine;
}

function parseAnalysisText(fullText: string): string {
  let analysisPart = "";
  if (fullText.includes("ANALYSIS:")) {
    analysisPart = fullText
      .split(/LINE:/i)[0]
      .replace(/ANALYSIS:/i, "")
      .trim();
  } else {
    analysisPart = fullText.split(/LINE:/i)[0].trim();
  }
  return (
    analysisPart || "The Grandmaster has shared his thoughts on this position."
  );
}

export async function analyzePosition(req: Request): Promise<Response> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const body = (await req.json()) as {
    fen: string;
    lastMove: string;
    turn: string;
    userColor?: string;
    engineData?: { bestMove: string; eval: string; line: string };
    moveHistory?: string[];
    openingName?: string;
    repertoireComment?: string;
    mode?: string;
    repertoireMoves?: string[];
    mastersData?: {
      white: number;
      draws: number;
      black: number;
      moves: Array<{
        san: string;
        white: number;
        draws: number;
        black: number;
      }>;
    } | null;
    deviationContext?: {
      moveNumber: number;
      playedSan: string;
      repertoireSan: string;
      evalDiff: number;
    } | null;
  };

  if (!GEMINI_API_KEY) {
    return Response.json({
      text: "Coach unavailable — set GEMINI_API_KEY in the server environment.",
      demoLine: [],
      isError: true,
    });
  }

  const {
    fen,
    lastMove,
    engineData,
    openingName = "your opening",
    repertoireComment,
    userColor,
    mode,
    repertoireMoves,
    mastersData,
    moveHistory,
    deviationContext,
  } = body;
  const activeColor = fen.split(" ")[1] === "w" ? "White" : "Black";
  const playerColor = userColor
    ? userColor.charAt(0).toUpperCase() + userColor.slice(1)
    : activeColor;

  let context = "";

  // Repertoire moves for the current position — used to constrain LINE suggestions
  if (repertoireMoves && repertoireMoves.length > 0) {
    const isPlayerTurn =
      activeColor.toLowerCase() === (userColor ?? "").toLowerCase();
    if (isPlayerTurn) {
      context += `
    REPERTOIRE MOVES FOR ${playerColor.toUpperCase()} FROM THIS POSITION:
    ${repertoireMoves.join(", ")}

    ⚠️ CRITICAL CONSTRAINT: Your LINE suggestion for ${playerColor} MUST begin with one of the above repertoire moves.
    Do NOT suggest any move for ${playerColor} that is not in this list. The student is studying a specific repertoire and your job is to reinforce it, not contradict it.
    If you believe a different move is objectively better, you may briefly acknowledge it in the ANALYSIS text, but the LINE must still start with a repertoire move.
    `;
    }
  }

  if (engineData) {
    context += `
    CONTEXT FROM STOCKFISH ENGINE:
    - Best Move: ${engineData.bestMove}
    - Evaluation: ${engineData.eval}
    - Tactical Line: ${engineData.line}

    Use this data to explain WHY the position is evaluated as it is, but remember: the LINE must respect the repertoire constraint above.
    `;
  }

  if (mastersData && mastersData.moves.length > 0) {
    const totalGames =
      mastersData.white + mastersData.draws + mastersData.black;
    const topMoves = mastersData.moves.slice(0, 3).map((m) => {
      const moveTotal = m.white + m.draws + m.black;
      const pct = Math.round((moveTotal / totalGames) * 100);
      const wPct = Math.round((m.white / moveTotal) * 100);
      const dPct = Math.round((m.draws / moveTotal) * 100);
      const lPct = 100 - wPct - dPct;
      return `- ${m.san}: ${pct}% of games — W${wPct}% D${dPct}% L${lPct}%`;
    });
    const mostPopular = mastersData.moves[0]?.san ?? "";
    context += `
    MASTERS DATABASE (titled players, Lichess — ${totalGames.toLocaleString()} games):
    ${topMoves.join("\n    ")}
    The most popular move among masters is ${mostPopular}.

    Use this to contextualize move choices: note when Stockfish's recommendation aligns with master practice, or when masters favor a practical choice the engine doesn't rate highest.
    `;
  }

  if (repertoireComment) {
    context += `
    REPERTOIRE ANNOTATION FOR THE LAST MOVE:
    "${repertoireComment}"

    This is the official study note for this move. Use it as the primary guide for explaining the strategic idea.
    `;
  }

  const whoJustMoved = activeColor === "White" ? "Black" : "White";

  // Mode-specific coaching focus
  let modeInstructions = "";
  if (mode === "study") {
    modeInstructions = `
    The student is in STUDY MODE — stepping through the opening line to understand it.
    Be a Grandmaster lecturer: explain WHY this move was played, what plan it sets up, and what the student should take away.
    Connect every point to THIS specific position. Avoid generic advice.
    `;
  } else if (mode === "learn") {
    modeInstructions = `
    The student is in LEARN MODE — memorizing this line through repetition.
    Give them a memory anchor: a memorable pattern, visual cue, or rule of thumb that makes this move impossible to forget.
    Be punchy — one key insight they can carry into the next drill.
    `;
  } else if (mode === "weak") {
    modeInstructions = `
    The student is drilling a WEAK POSITION — one they've previously gotten wrong.
    Diagnose why this position is tricky: what is the common mistake, what should the thinking process be?
    Be direct and practical.
    `;
  } else if (mode === "quiz") {
    modeInstructions = `
    The student is in QUIZ MODE — testing themselves without guidance.
    Give a post-move debrief: is the position on track, what is the key tension, what should they remember for next time?
    `;
  } else {
    modeInstructions = `
    The student is in FULL DRILL MODE — playing through the complete line.
    Focus on position quality, key strategic ideas for ${playerColor}, and correct continuation.
    `;
  }

  const boardDescription = describeBoardFromFen(fen);
  const positionContext = describePositionContext(fen);
  const moveHistoryStr =
    moveHistory && moveHistory.length > 0
      ? (() => {
          const pairs: string[] = [];
          for (let i = 0; i < moveHistory.length; i += 2) {
            pairs.push(
              `${Math.floor(i / 2) + 1}.${moveHistory[i]}${moveHistory[i + 1] ? " " + moveHistory[i + 1] : ""}`,
            );
          }
          return pairs.join(" ");
        })()
      : null;

  const deviationSection = deviationContext
    ? `
    REPERTOIRE DEVIATION: On move ${deviationContext.moveNumber}, the student played ${deviationContext.playedSan} but the repertoire recommends ${deviationContext.repertoireSan} (eval difference: ${deviationContext.evalDiff.toFixed(1)} pawns). Comment on how this deviation affects the position if relevant.
    `
    : "";

  const prompt = `
    You are a Grandmaster chess coach.
    The student is playing as ${playerColor} in the ${openingName} opening.

    EXACT BOARD POSITION — pieces currently on the board (you must only reference these):
    ${boardDescription}

    POSITION CONTEXT:
    ${positionContext}

    ${moveHistoryStr ? `GAME MOVES SO FAR: ${moveHistoryStr}` : "This is the starting position."}
    ${lastMove !== "Start" ? `${whoJustMoved} just played ${lastMove}.` : ""}
    It is now ${activeColor}'s turn.

    ⚠️ ACCURACY RULE: Only reference pieces, pawns, and squares that appear in the EXACT BOARD POSITION above. Do not mention pieces that have been captured or squares that are empty.

    ${modeInstructions}
    ${context}
    ${deviationSection}

    Your tasks:
    1. Explain the position from ${playerColor}'s perspective based on the coaching mode above.
    2. Comment on the last move (${lastMove}) if it is strategically significant.
    3. Suggest the best continuation — starting with a repertoire move for ${playerColor} if one is specified above.

    OUTPUT FORMAT (use exactly):
    ANALYSIS: [2-3 sentences for the ${playerColor} player]
    LINE: [Move1, Move2, Move3, Move4]

    The LINE must be a comma-separated list of SAN moves in brackets. Example: LINE: [d4, Nf6, Bf4, d5]
  `;

  try {
    const geminiRes = await fetch(
      `${GEMINI_STREAM_URL}&key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.3 },
        }),
      },
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error("Gemini API error:", err);
      return Response.json({
        text: `Coach unavailable — Gemini API error: ${err}`,
        demoLine: [],
        isError: true,
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = geminiRes.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const dataStr = line.slice(6).trim();
              if (!dataStr || dataStr === "[DONE]") continue;
              try {
                const json = JSON.parse(dataStr);
                const token: string =
                  json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                if (token) {
                  fullText += token;
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify({ token, done: false })}\n\n`,
                    ),
                  );
                }
              } catch { /* malformed SSE line — skip */ }
            }
          }
        } finally {
          // Parse the full accumulated response and send done event
          const demoLine = parseDemoLine(
            fullText,
            repertoireMoves,
            userColor,
            activeColor,
          );
          const analysisText = parseAnalysisText(fullText);
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ token: "", analysisText, demoLine, done: true })}\n\n`,
            ),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Gemini proxy error:", error);
    return Response.json({
      text: "Coach unavailable — check your connection.",
      demoLine: [],
      isError: true,
    });
  }
}

/** Fetch top master moves for a given FEN from Lichess. Returns null on any error. */
async function fetchMastersData(fen: string): Promise<{
  white: number;
  draws: number;
  black: number;
  moves: Array<{ san: string; white: number; draws: number; black: number }>;
} | null> {
  try {
    const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=5&topGames=0`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      white: number;
      draws: number;
      black: number;
      moves: Array<{ san: string; uci: string; white: number; draws: number; black: number }>;
    };
    const totalGames = (data.white ?? 0) + (data.draws ?? 0) + (data.black ?? 0);
    if (totalGames < 5) return null; // skip positions with negligible master coverage
    return {
      white: data.white,
      draws: data.draws,
      black: data.black,
      moves: (data.moves ?? []).map((m) => ({ san: m.san, white: m.white, draws: m.draws, black: m.black })),
    };
  } catch {
    return null;
  }
}

/** One schema-constrained Gemini call; null on any HTTP/network/timeout failure. */
// Exported only so the key-hygiene test can exercise it.
export async function callGeminiJson(
  apiKey: string,
  prompt: string,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 900,
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: COACH_RESPONSE_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      console.error("Gemini API error (coach):", await res.text());
      return null;
    }
    const data = (await res.json()) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (e) {
    console.error("Gemini fetch error (coach):", `${(e as Error)?.name}: ${String((e as Error)?.message).replace(/key=[^&\s]+/g, "key=REDACTED")}`);
    return null;
  }
}

/**
 * v2: Explain a specific blunder. Facts come from Stockfish + chess.js; Gemini
 * only writes the captions (see docs/superpowers/specs/2026-09-24-coach-engine-facts-design.md).
 * POST /api/analyze/blunder
 */
export async function explainBlunder(req: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Coach unavailable: GEMINI_API_KEY is not set on the server" },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = await explainBlunderCore(body, {
    engine: getCoachEngine(),
    gemini: (prompt, timeoutMs) => callGeminiJson(apiKey, prompt, timeoutMs),
    masters: fetchMastersData,
    cache: { get: (k) => getCachedCoach(k), put: (k, v) => putCachedCoach(k, v) },
  });
  return Response.json(result.body, { status: result.status });
}
