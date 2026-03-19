const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export async function analyzePosition(req: Request): Promise<Response> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const body = await req.json() as {
    fen: string;
    lastMove: string;
    turn: string;
    userColor?: string;
    engineData?: { bestMove: string; eval: string; line: string };
    openingName?: string;
    repertoireComment?: string;
    mode?: string;
    repertoireMoves?: string[];
    mastersData?: {
      white: number;
      draws: number;
      black: number;
      moves: Array<{ san: string; white: number; draws: number; black: number }>;
    } | null;
  };

  if (!GEMINI_API_KEY) {
    return Response.json({
      text: "Coach unavailable — set GEMINI_API_KEY in the server environment.",
      demoLine: [],
      isError: true,
    });
  }

  const { fen, lastMove, engineData, openingName = "your opening", repertoireComment, userColor, mode, repertoireMoves, mastersData } = body;
  const activeColor = fen.split(" ")[1] === "w" ? "White" : "Black";
  const playerColor = userColor ? (userColor.charAt(0).toUpperCase() + userColor.slice(1)) : activeColor;

  let context = "";

  // Repertoire moves for the current position — used to constrain LINE suggestions
  if (repertoireMoves && repertoireMoves.length > 0) {
    const isPlayerTurn = activeColor.toLowerCase() === (userColor ?? '').toLowerCase();
    if (isPlayerTurn) {
      context += `
    REPERTOIRE MOVES FOR ${playerColor.toUpperCase()} FROM THIS POSITION:
    ${repertoireMoves.join(', ')}

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
    const totalGames = mastersData.white + mastersData.draws + mastersData.black;
    const topMoves = mastersData.moves.slice(0, 3).map((m) => {
      const moveTotal = m.white + m.draws + m.black;
      const pct = Math.round((moveTotal / totalGames) * 100);
      const wPct = Math.round((m.white / moveTotal) * 100);
      const dPct = Math.round((m.draws / moveTotal) * 100);
      const lPct = 100 - wPct - dPct;
      return `- ${m.san}: ${pct}% of games — W${wPct}% D${dPct}% L${lPct}%`;
    });
    const mostPopular = mastersData.moves[0]?.san ?? '';
    context += `
    MASTERS DATABASE (titled players, Lichess — ${totalGames.toLocaleString()} games):
    ${topMoves.join('\n    ')}
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
  if (mode === 'study') {
    modeInstructions = `
    The student is in STUDY MODE — stepping through the opening line to understand it.
    Be a Grandmaster lecturer: explain WHY this move was played, what plan it sets up, and what the student should take away.
    Connect every point to THIS specific position. Avoid generic advice.
    `;
  } else if (mode === 'learn') {
    modeInstructions = `
    The student is in LEARN MODE — memorizing this line through repetition.
    Give them a memory anchor: a memorable pattern, visual cue, or rule of thumb that makes this move impossible to forget.
    Be punchy — one key insight they can carry into the next drill.
    `;
  } else if (mode === 'weak') {
    modeInstructions = `
    The student is drilling a WEAK POSITION — one they've previously gotten wrong.
    Diagnose why this position is tricky: what is the common mistake, what should the thinking process be?
    Be direct and practical.
    `;
  } else if (mode === 'quiz') {
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

  const prompt = `
    You are a Grandmaster chess coach.
    The student is playing as ${playerColor} in the ${openingName} opening.
    Current position (FEN): ${fen}
    ${lastMove !== 'Start' ? `${whoJustMoved} just played ${lastMove}.` : 'This is the starting position.'}
    It is now ${activeColor}'s turn.

    ${modeInstructions}
    ${context}

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
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0.6 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Gemini API error:", err);
      return Response.json({ text: "Coach unavailable — Gemini API error.", demoLine: [], isError: true });
    }

    const data = await res.json() as any;
    const fullText: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    let analysisPart = "";
    if (fullText.includes("ANALYSIS:")) {
      analysisPart = fullText.split(/LINE:/i)[0].replace(/ANALYSIS:/i, "").trim();
    } else {
      analysisPart = fullText.split(/LINE:/i)[0].trim();
    }

    const linePart = fullText.match(/LINE:\s*\[(.*?)\]/i);
    const rawDemoLine = linePart
      ? linePart[1].split(",").map((m: string) => m.trim().replace(/['"[\]]/g, ""))
      : [];

    // If repertoire moves were provided and the first suggested move isn't one of them,
    // prepend the first repertoire move so the demo arrow is at least correct.
    let demoLine = rawDemoLine.filter((m: string) => m.length > 0);
    if (
      repertoireMoves && repertoireMoves.length > 0 &&
      activeColor.toLowerCase() === (userColor ?? '').toLowerCase() &&
      demoLine.length > 0 &&
      !repertoireMoves.includes(demoLine[0])
    ) {
      demoLine = [repertoireMoves[0], ...demoLine.slice(1)];
    }

    return Response.json({
      text: analysisPart || "The Grandmaster has shared his thoughts on this position.",
      demoLine,
      isError: false,
    });
  } catch (error) {
    console.error("Gemini proxy error:", error);
    return Response.json({ text: "Coach unavailable — check your connection.", demoLine: [], isError: true });
  }
}

export async function generateRepertoireComment(req: Request): Promise<Response> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return Response.json({ error: "API key not set" }, { status: 500 });

  const { fen, engineLine, explorerData, userColor } = await req.json() as any;
  const playerColor = userColor ? (userColor.charAt(0).toUpperCase() + userColor.slice(1)) : "Player";

  const explorerContext = explorerData?.moves?.slice(0, 3).map((m: any) => 
    `${m.san} (Played ${m.white + m.draws + m.black} times, Win Rate: ${Math.round(m.white / (m.white + m.draws + m.black) * 100)}%)`
  ).join(", ") || "No human data available";

  const prompt = `
    You are a Grandmaster chess author writing a repertoire book.
    Position (FEN): ${fen}
    Target Move for ${playerColor}: ${engineLine.split(' ')[0]}
    
    ENGINE ANALYSIS: ${engineLine}
    HUMAN DATA (Lichess): ${explorerContext}

    Write a 1-2 sentence annotation for the Target Move that explains WHY a human should play it. 
    Balance engine precision with human practical statistics. Keep it concise, punchy, and instructional.
    Do not use markers like "Comment:" or "Annotation:", just provide the text.
  `;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
      }),
    });

    const data = await res.json() as any;
    const comment = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Recommended based on analysis.";
    
    return Response.json({ comment });
  } catch (error) {
    return Response.json({ error: "Failed to generate comment" }, { status: 500 });
  }
}

/**
 * v2: Explain a specific blunder in Grandmaster coaching style.
 * POST /api/analyze/blunder
 */
export async function explainBlunder(req: Request): Promise<Response> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return Response.json({
      text: "Coach unavailable — set GEMINI_API_KEY in the server environment.",
      concept: "",
      isError: true,
    });
  }

  const body = await req.json() as {
    fen: string;
    wrongMove: string;
    correctMove: string;
    cpLoss: number;
    stockfishLine?: string;
    phase?: string;
    openingName?: string;
  };

  const { fen, wrongMove, correctMove, cpLoss, stockfishLine, phase, openingName } = body;

  const prompt = `You are a Grandmaster chess coach explaining a student's specific mistake.

Position (FEN): ${fen}
${phase ? `Game phase: ${phase}` : ""}
${openingName ? `Opening: ${openingName}` : ""}

The student played: ${wrongMove}
The correct move was: ${correctMove}
Pawn loss: ${cpLoss.toFixed(2)}
${stockfishLine ? `Engine continuation after correct move: ${stockfishLine}` : ""}

Your task:
1. Explain concretely why ${wrongMove} is problematic — reference specific pieces, squares, and threats.
2. Explain the specific idea behind ${correctMove} — what it achieves tactically or strategically.
3. Give a memorable principle the student can carry forward.

OUTPUT FORMAT (use exactly):
ANALYSIS: [2-3 concrete sentences referencing actual pieces and squares on this board]
CONCEPT: [short theme tag, e.g. "Discovered attack", "Overloaded piece", "King safety"]`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.5 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Gemini API error (blunder):", err);
      return Response.json({ text: "Coach unavailable — Gemini API error.", concept: "", isError: true });
    }

    const data = await res.json() as any;
    const fullText: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    let analysisText = "";
    let concept = "";

    if (fullText.includes("ANALYSIS:")) {
      analysisText = fullText.split(/CONCEPT:/i)[0].replace(/ANALYSIS:/i, "").trim();
    } else {
      analysisText = fullText.split(/CONCEPT:/i)[0].trim();
    }

    const conceptMatch = fullText.match(/CONCEPT:\s*(.+)/i);
    if (conceptMatch) {
      concept = conceptMatch[1].trim().replace(/^["'\[]|["'\]]$/g, "");
    }

    return Response.json({
      text: analysisText || "The coach could not analyze this position.",
      concept,
      isError: false,
    });
  } catch (error) {
    console.error("Gemini proxy error (blunder):", error);
    return Response.json({ text: "Coach unavailable — check your connection.", concept: "", isError: true });
  }
}
