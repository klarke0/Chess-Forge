import { Chess } from "chess.js";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const GEMINI_STREAM_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse";

// Compute verifiable facts about a move: landing square, captures, pieces it attacks after landing,
// whether it gives check, and which enemy pieces attack the landing square (i.e. is the moved piece hanging).
function computeMoveFacts(fen: string, san: string): string {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    if (!move) return `${san} is not a legal move in this position.`;

    const movedPieceName = pieceFullName(move.piece);
    const movedColor = move.color === "w" ? "White" : "Black";
    const to = move.to;
    const from = move.from;
    const captured = move.captured
      ? `${move.color === "w" ? "Black" : "White"} ${pieceFullName(move.captured)} on ${to}`
      : null;
    const isCheck = chess.inCheck();
    const isCheckmate = chess.isCheckmate();

    // After the move, find all enemy pieces this piece now attacks
    const allMoves = chess.moves({ square: to, verbose: true });
    const attacked: string[] = [];
    for (const m of allMoves) {
      const piece = chess.get(m.to);
      if (piece && piece.color !== move.color) {
        attacked.push(`${piece.color === "w" ? "White" : "Black"} ${pieceFullName(piece.type)} on ${m.to}`);
      }
    }

    // Check if the moved piece is now under attack (hanging or capturable) by the opponent
    const opponentMoves = chess.moves({ verbose: true });
    const attackers = opponentMoves
      .filter((m) => m.to === to && m.captured)
      .map((m) => {
        const p = chess.get(m.from);
        return p ? `${p.color === "w" ? "White" : "Black"} ${pieceFullName(p.type)} on ${m.from}` : "";
      })
      .filter(Boolean);
    // Dedupe
    const uniqueAttackers = [...new Set(attackers)];

    const lines: string[] = [
      `${san} = ${movedColor} ${movedPieceName} moves from ${from} to ${to}.`,
    ];
    if (captured) lines.push(`It captures ${captured}.`);
    if (isCheckmate) lines.push(`This move is CHECKMATE.`);
    else if (isCheck) lines.push(`This move gives CHECK to the opposing king.`);
    else lines.push(`This move does NOT give check.`);
    if (attacked.length > 0) lines.push(`After landing on ${to}, it attacks: ${attacked.join(", ")}.`);
    else lines.push(`After landing on ${to}, it does not attack any enemy piece.`);
    if (uniqueAttackers.length > 0) {
      lines.push(`The ${movedPieceName} on ${to} is itself attacked by: ${uniqueAttackers.join(", ")} — so it can be captured next move.`);
    } else {
      lines.push(`The ${movedPieceName} on ${to} is NOT attacked by any enemy piece — it is safe.`);
    }

    return lines.join(" ");
  } catch (e) {
    return `Could not compute facts for ${san}: ${(e as Error).message}`;
  }
}

function pieceFullName(p: string): string {
  const map: Record<string, string> = { k: "King", q: "Queen", r: "Rook", b: "Bishop", n: "Knight", p: "Pawn" };
  return map[p.toLowerCase()] ?? p;
}

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

// Build per-side, per-piece-type rosters so the LLM can't confuse who owns which piece
function describeRostersFromFen(fen: string, studentColor: "White" | "Black"): string {
  const ranks = fen.split(" ")[0].split("/");
  const whiteByType: Record<string, string[]> = { K: [], Q: [], R: [], B: [], N: [], P: [] };
  const blackByType: Record<string, string[]> = { K: [], Q: [], R: [], B: [], N: [], P: [] };
  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    let fileIdx = 0;
    for (const ch of ranks[rankIdx]) {
      if (/\d/.test(ch)) {
        fileIdx += parseInt(ch);
      } else {
        const square = String.fromCharCode(97 + fileIdx) + (8 - rankIdx);
        if (ch === ch.toUpperCase() && whiteByType[ch]) whiteByType[ch].push(square);
        else if (ch === ch.toLowerCase() && blackByType[ch.toUpperCase()]) blackByType[ch.toUpperCase()].push(square);
        fileIdx++;
      }
    }
  }
  const fmt = (label: string, byType: Record<string, string[]>) => {
    const names: Record<string, string> = { K: "King", Q: "Queen", R: "Rook", B: "Bishop", N: "Knight", P: "Pawn" };
    const parts: string[] = [];
    for (const t of ["K", "Q", "R", "B", "N", "P"]) {
      const sqs = byType[t];
      if (sqs.length === 0) parts.push(`  ${names[t]}s: NONE`);
      else parts.push(`  ${names[t]}${sqs.length > 1 ? "s" : ""}: ${sqs.join(", ")}`);
    }
    return `${label}\n${parts.join("\n")}`;
  };
  const studentLabel = `STUDENT (${studentColor}) pieces — these are "your" pieces:`;
  const opponentLabel = `OPPONENT (${studentColor === "White" ? "Black" : "White"}) pieces — these are NOT yours, they belong to the enemy:`;
  if (studentColor === "White") {
    return `${fmt(studentLabel, whiteByType)}\n\n${fmt(opponentLabel, blackByType)}`;
  } else {
    return `${fmt(studentLabel, blackByType)}\n\n${fmt(opponentLabel, whiteByType)}`;
  }
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

// Step types for the interactive coach walkthrough. Each beat ties a caption
// to a board action: replay a move, highlight squares, draw an arrow, or
// noop (text-only). The frontend consumes these and dispatches them to the
// existing useCoachBoard imperative API.
export type CoachStepAction =
  | { type: "playMove"; san: string; highlight?: "red" | "green" | "amber" }
  | {
      type: "highlight";
      squares: string[];
      color?: "red" | "green" | "amber" | "blue";
    }
  | {
      type: "arrow";
      from: string;
      to: string;
      color?: "red" | "green" | "amber" | "blue";
    }
  | { type: "noop" };

export interface CoachStep {
  text: string;
  action: CoachStepAction;
}

const SQUARE_RE = /^[a-h][1-8]$/;

/**
 * Validate a sequence of coach steps against the implied board state.
 *
 * Mirrors the frontend's `InteractiveCoach` reset semantics: the board is
 * reset to `startFen` before beat 0 (always) AND before the penultimate
 * beat when there are ≥3 steps, because that beat replays the correct
 * move and the prompt explicitly asks the LLM to emit its SAN as legal
 * from the *original* FEN (not from the post-refutation cumulative state).
 *
 * Validation is forgiving: if a single beat fails (illegal SAN, missing
 * fields, bad squares), we drop just that beat instead of nuking the
 * whole walkthrough. As long as ≥2 beats survive, the result is shown.
 * SAN strings are passed through chess.js, which already tolerates
 * decoration (+, #) and disambiguation differences.
 */
function validateAndNormalizeSteps(
  startFen: string,
  steps: any,
): CoachStep[] | null {
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6)
    return null;

  // Match InteractiveCoach.tsx: reset before beat 0 and before penultimate.
  const resetIndices =
    steps.length >= 3 ? new Set([0, steps.length - 2]) : new Set([0]);

  const result: CoachStep[] = [];
  let runningFen = startFen;

  for (let i = 0; i < steps.length; i++) {
    if (resetIndices.has(i)) runningFen = startFen;

    const raw = steps[i];
    if (!raw || typeof raw !== "object") continue;
    if (typeof raw.text !== "string" || raw.text.trim().length === 0) continue;
    if (!raw.action || typeof raw.action !== "object") continue;

    const a = raw.action;
    const text = String(raw.text).trim();

    if (a.type === "playMove") {
      if (typeof a.san !== "string" || !a.san.trim()) continue;
      let nextFen: string;
      try {
        const c = new Chess(runningFen);
        const move = c.move(a.san.trim());
        if (!move) continue;
        nextFen = c.fen();
      } catch {
        continue;
      }
      runningFen = nextFen;
      const highlight =
        a.highlight === "red" ||
        a.highlight === "green" ||
        a.highlight === "amber"
          ? a.highlight
          : undefined;
      result.push({
        text,
        action: { type: "playMove", san: a.san.trim(), highlight },
      });
    } else if (a.type === "highlight") {
      if (!Array.isArray(a.squares) || a.squares.length === 0) continue;
      const sq = a.squares
        .filter((s: any) => typeof s === "string")
        .map((s: string) => s.trim().toLowerCase())
        .filter((s: string) => SQUARE_RE.test(s));
      if (sq.length === 0) continue;
      const color =
        a.color === "red" ||
        a.color === "green" ||
        a.color === "amber" ||
        a.color === "blue"
          ? a.color
          : undefined;
      result.push({ text, action: { type: "highlight", squares: sq, color } });
    } else if (a.type === "arrow") {
      const from =
        typeof a.from === "string" ? a.from.trim().toLowerCase() : "";
      const to = typeof a.to === "string" ? a.to.trim().toLowerCase() : "";
      if (!SQUARE_RE.test(from) || !SQUARE_RE.test(to)) continue;
      const color =
        a.color === "red" ||
        a.color === "green" ||
        a.color === "amber" ||
        a.color === "blue"
          ? a.color
          : undefined;
      result.push({ text, action: { type: "arrow", from, to, color } });
    } else if (a.type === "noop") {
      result.push({ text, action: { type: "noop" } });
    } else {
      continue;
    }
  }

  // Need at least two surviving beats for a meaningful walkthrough.
  if (result.length < 2) return null;
  return result;
}

/**
 * Build the strict-JSON prompt for the structured walkthrough. Asks Gemini
 * to return ONLY a JSON object — we parse it server-side and validate.
 */
function buildStepsPrompt(args: {
  studentColor: "White" | "Black";
  rosters: string;
  boardDescription: string;
  positionContext: string;
  phase?: string;
  wrongMove: string | null;
  correctMove: string;
  cpLossPawns: number | null;
  refutationFacts: string;
  correctMoveFacts: string;
  wrongMoveFacts: string;
  mastersContext?: string;
}): string {
  const {
    studentColor,
    rosters,
    boardDescription,
    positionContext,
    phase,
    wrongMove,
    correctMove,
    cpLossPawns,
    refutationFacts,
    correctMoveFacts,
    wrongMoveFacts,
    mastersContext,
  } = args;

  const opponentColor = studentColor === "White" ? "Black" : "White";
  const cpStr =
    cpLossPawns !== null && cpLossPawns > 0
      ? `${cpLossPawns.toFixed(1)} pawns`
      : "unknown";

  return `You are a Grandmaster chess coach producing an INTERACTIVE 3-to-5-step walkthrough that explains a single mistake. The board (driven by your steps) is the dialogue — the student WATCHES pieces move while reading short captions.

The student is playing as ${studentColor}. Their pieces are ${studentColor}; the opponent's pieces are ${opponentColor}.

PIECE OWNERSHIP (treat as ground truth — confusing colors makes the walkthrough useless):
${rosters}

EXACT PIECES ON THE BOARD:
${boardDescription}

POSITION CONTEXT:
${positionContext}
${phase ? `Game phase: ${phase}` : ""}

The student played: ${wrongMove ?? "(no wrong move — they missed it)"}  ${
    cpStr !== "unknown" ? `(cost: ${cpStr})` : ""
  }
The correct move was: ${correctMove}

VERIFIED FACTS — CORRECT MOVE (${correctMove}):
${correctMoveFacts || "(none)"}

${mastersContext ? mastersContext : ""}
${
  wrongMove
    ? `VERIFIED FACTS — WRONG MOVE (${wrongMove}):
${wrongMoveFacts || "(none)"}

OPPONENT'S BEST REFUTATION TO ${wrongMove}:
${refutationFacts || "(none)"}`
    : ""
}

Return ONLY valid JSON (no markdown fences, no prose before or after) with this exact shape:

{
  "concept": "<single concept name like 'Fork', 'Pin', 'Discovered attack' — never generic words like 'tactics'>",
  "steps": [
    { "text": "<≤16 words caption>",
      "action": { "type": "playMove" | "highlight" | "arrow" | "noop", ...fields } }
  ]
}

Action shape rules:
- playMove: { "type": "playMove", "san": "<legal SAN from the implied current FEN>", "highlight": "red" | "green" | "amber" (optional) }
- highlight: { "type": "highlight", "squares": ["e4","f3"], "color": "red" | "green" | "amber" | "blue" (optional) }
- arrow:    { "type": "arrow", "from": "e4", "to": "f3", "color": "red" | "green" | "amber" | "blue" (optional) }
- noop:     { "type": "noop" } — text-only beat, prefer the others

⚠️ STRICT STORY STRUCTURE — exactly 3 to 5 steps, in this order:
1. FIRST step: replay the student's wrong move${wrongMove ? ` ${wrongMove}` : ""} as a playMove with highlight="red". Caption framed as "In your game you played X" or "You played X here".
${
  refutationFacts
    ? `2. SECOND step: show the opponent's punishment as a playMove (the refutation move from the verified facts above). Caption explains what white/black does to refute.`
    : `2. SECOND step: a highlight or arrow showing why the wrong move fails (which piece is hanging, which square is weak).`
}
3. PENULTIMATE step: replay the CORRECT move ${correctMove} as a playMove with highlight="green".
   ⚠️ The frontend RESETS the board to the original starting FEN before this beat fires. So emit ${correctMove}'s SAN as legal from the ORIGINAL starting FEN — NOT from the post-refutation position. Caption: "Better was ${correctMove}" or similar.
4. FINAL step: the WHY — must be a highlight (key squares) or arrow (showing the threat/benefit). Captions like "controls the d-file" or "removes the central knight". MUST NOT be playMove.

⚠️ HARD ACCURACY RULES:
- Beat 1's SAN must be legal from the STARTING FEN above.
- Beat 2's SAN must be legal from the FEN AFTER beat 1.
- The penultimate beat's SAN must be legal from the STARTING FEN again (board is reset before this beat).
- Squares must be 2-character lowercase like "e4". No "O-O" castling notation outside playMove SAN.
- Captions must be ≤16 words and concrete. Reference specific pieces and squares — never "the player did X". Use "you" sparingly.
- Do NOT add "+" or "#" to any SAN unless the verified facts confirm check or mate.
- Do NOT name pieces or squares that don't appear in EXACT PIECES.

EXAMPLE (illustrative — do NOT copy text or moves; produce your own based on this position):
{
  "concept": "Loose Piece",
  "steps": [
    { "text": "You played Nxe5, but the knight isn't actually defended.", "action": { "type": "playMove", "san": "Nxe5", "highlight": "red" } },
    { "text": "Black wins the piece with Qa5+, forking king and knight.", "action": { "type": "playMove", "san": "Qa5+", "highlight": "red" } },
    { "text": "Better was c3, calmly defending b4 and preparing d4.", "action": { "type": "playMove", "san": "c3", "highlight": "green" } },
    { "text": "c3 keeps the queenside structure intact and stops Qa5 ideas.", "action": { "type": "highlight", "squares": ["c3","b4","a5"], "color": "blue" } }
  ]
}

Return ONLY the JSON object. No backticks. No prose. No comments inside the JSON.`;
}

/**
 * Attempt to parse strict JSON from a Gemini response. Strips markdown fences,
 * leading/trailing prose, and trims whitespace. Returns null on failure.
 */
function tryParseJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  // Find first { and last } — Gemini sometimes adds prose around the JSON
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = s.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

async function callGeminiForSteps(
  apiKey: string,
  prompt: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1200,
          temperature: 0.4,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Gemini API error (steps):", err);
      return null;
    }
    const data = (await res.json()) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (e) {
    console.error("Gemini fetch error (steps):", e);
    return null;
  }
}

/**
 * v2: Explain a specific blunder in Grandmaster coaching style.
 * POST /api/analyze/blunder
 */
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

export async function explainBlunder(req: Request): Promise<Response> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return Response.json({
      analysis:
        "Coach unavailable — set GEMINI_API_KEY in the server environment.",
      concept: "",
    });
  }

  const body = (await req.json()) as {
    fen: string;
    wrongMove: string | null;
    correctMove: string;
    cpLoss: number | null;
    phase?: string;
    framing?: string;
  };

  const { fen, wrongMove, correctMove, cpLoss, phase, framing } = body;

  // Derive which color the student is from the FEN (they were to move at this position)
  const sideToMove = fen.split(" ")[1] === "w" ? "White" : "Black";

  const boardDescription = describeBoardFromFen(fen);
  const rosters = describeRostersFromFen(fen, sideToMove as "White" | "Black");
  const positionContext = describePositionContext(fen);
  const correctMoveFacts = computeMoveFacts(fen, correctMove);
  const wrongMoveFacts = wrongMove ? computeMoveFacts(fen, wrongMove) : "";

  // Compute the opponent's best refutation to wrongMove (so the LLM knows the actual punishment)
  let refutationFacts = "";
  if (wrongMove) {
    try {
      const chess = new Chess(fen);
      const wm = chess.move(wrongMove);
      if (wm) {
        const opponentColor = chess.turn() === "w" ? "White" : "Black";
        // Find best capture/check available to opponent — heuristic: prefer captures of the just-moved piece
        const opponentMoves = chess.moves({ verbose: true });
        const capturesOfMovedPiece = opponentMoves.filter((m) => m.to === wm.to && m.captured);
        if (capturesOfMovedPiece.length > 0) {
          const cap = capturesOfMovedPiece[0];
          const capPiece = chess.get(cap.from);
          refutationFacts = `Opponent (${opponentColor}) can immediately reply with ${cap.san} — ${capPiece ? pieceFullName(capPiece.type) : "piece"} from ${cap.from} captures the ${pieceFullName(wm.piece)} on ${wm.to}.`;
        } else {
          // List a few legal opponent responses for context
          const sample = opponentMoves.slice(0, 5).map((m) => m.san).join(", ");
          refutationFacts = `Opponent (${opponentColor}) has these legal responses (sample): ${sample}.`;
        }
      }
    } catch { /* chess.js can throw on illegal positions — skip refutation */ }
  }

  // Fetch Lichess Masters data in parallel with the refutation computation above.
  // We race against a 4-second timeout (handled inside fetchMastersData).
  const mastersData = await fetchMastersData(fen);

  const cpStr =
    cpLoss !== null && cpLoss > 0 ? `${cpLoss.toFixed(1)} pawns` : null;

  const mistakeLine = wrongMove
    ? `The student (${sideToMove}) played: ${wrongMove} — this was a mistake${cpStr ? ` (cost: ${cpStr})` : ""}.`
    : `The student (${sideToMove}) did not find the correct move${cpStr ? ` (cost of missing it: ${cpStr})` : ""}.`;

  // Build masters context string for prose prompt
  let mastersContext = "";
  if (mastersData && mastersData.moves.length > 0) {
    const totalGames = mastersData.white + mastersData.draws + mastersData.black;
    const topMoves = mastersData.moves.slice(0, 3).map((m) => {
      const moveTotal = m.white + m.draws + m.black;
      const pct = Math.round((moveTotal / totalGames) * 100);
      const wPct = moveTotal > 0 ? Math.round((m.white / moveTotal) * 100) : 0;
      const dPct = moveTotal > 0 ? Math.round((m.draws / moveTotal) * 100) : 0;
      const lPct = 100 - wPct - dPct;
      return `  - ${m.san}: ${pct}% of games — W${wPct}% D${dPct}% L${lPct}%`;
    });
    mastersContext = `
MASTERS DATABASE (titled players, Lichess — ${totalGames.toLocaleString()} games from this position):
${topMoves.join("\n")}
The most popular move among masters is ${mastersData.moves[0].san}.
Use this to ground your explanation: note whether the correct move aligns with master practice, or whether masters prefer a different practical choice.
`;
  }

  const prompt = `You are a Grandmaster chess coach explaining a specific mistake to a student.

The student is playing as ${sideToMove}. Their pieces are ${sideToMove}; the opponent's pieces are ${sideToMove === "White" ? "Black" : "White"}.

PIECE OWNERSHIP — read this carefully before writing anything. Confusing who owns a piece is the #1 failure mode and will make the response useless:
${rosters}

EXACT PIECES ON THE BOARD (full list, with color tags) — only reference these, nothing else:
${boardDescription}

POSITION CONTEXT:
${positionContext}
${phase ? `Game phase: ${phase}` : ""}

${mistakeLine}
The correct move was: ${correctMove}

VERIFIED FACTS ABOUT THE CORRECT MOVE (${correctMove}) — computed from the actual position, treat as absolute ground truth:
${correctMoveFacts || "No additional facts computed."}

${wrongMove ? `VERIFIED FACTS ABOUT THE WRONG MOVE (${wrongMove}) — computed from the actual position, treat as absolute ground truth:
${wrongMoveFacts || "No additional facts computed."}

OPPONENT'S BEST REFUTATION TO ${wrongMove} (computed):
${refutationFacts || "No refutation computed."}` : ""}
${mastersContext}
⚠️ HARD RULES — violating any of these will make your response useless:
1. DO NOT restate the move name as the explanation. Saying "${correctMove} is the correct move" or "${correctMove} wins" tells the student nothing — that is the very thing being explained.
2. DO NOT guess or mention any opening name.
3. DO NOT reference pieces or squares not listed in the EXACT PIECES section above. Every piece you name MUST appear in EXACT PIECES with the exact square given there.
4. DO NOT claim a move attacks, defends, captures, or hangs any piece UNLESS that fact is explicitly stated in the VERIFIED FACTS sections above. If the verified facts say "does NOT give check", do NOT call it check. NEVER add the symbols "+" or "#" to a move that the verified facts say is not check / not mate. If the verified facts list the attackers of a piece, do NOT invent additional attackers or defenders.
5. The student's color is ${sideToMove}. When you say "your Knight" / "your Pawn" / "your piece", you MUST mean a ${sideToMove} piece listed under "STUDENT (${sideToMove}) pieces" in the PIECE OWNERSHIP roster — never an opponent piece. If you are about to call something on a square "yours", first check whether that square appears in the STUDENT roster above. If it does not, the piece is the OPPONENT's, not yours.
6. When explaining why ${wrongMove ?? "the missed move"} is bad, you MUST base it on the VERIFIED FACTS ABOUT THE WRONG MOVE and the OPPONENT'S BEST REFUTATION above — do not invent a different consequence. Do NOT introduce side effects on other pieces (e.g. "this leaves your X on Y hanging") unless that piece appears in the STUDENT roster AND the consequence follows from the verified facts.

Your task — be specific and tactical, not generic:
1. CORRECT MOVE: Explain the concrete tactical or structural benefit ${correctMove} creates — use ONLY the pieces and squares confirmed in VERIFIED MOVE FACTS and EXACT PIECES above.
2. WRONG MOVE CONSEQUENCE: If ${wrongMove ? `${wrongMove} was played` : "the correct move was missed"}, state exactly what goes wrong — which specific piece becomes hanging or undefended, which square becomes weak, which combination or tactic is missed. Concrete, not vague.
3. PRINCIPLE: End with one sharp, memorable principle that applies to THIS type of position — not a generic chess rule.
${framing ? `\n\nCONTEXT: ${framing}` : ""}
OUTPUT FORMAT (use exactly):
ANALYSIS: [2-3 concrete sentences hitting all three points above. Name squares and pieces explicitly.]
CONCEPT: [A precise chess concept — e.g. "Fork", "Pin", "Discovered attack", "Overloaded piece", "Back-rank weakness", "Zwischenzug", "King safety", "Piece activity" — NOT generic like "tactics" or "strategy"]`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1500, temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Gemini API error (blunder):", err);
      return Response.json({
        analysis: "Coach unavailable — Gemini API error.",
        concept: "",
      });
    }

    const data = (await res.json()) as any;
    const fullText: string =
      data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    let analysisText = "";
    let concept = "";

    if (fullText.includes("ANALYSIS:")) {
      analysisText = fullText
        .split(/CONCEPT:/i)[0]
        .replace(/ANALYSIS:/i, "")
        .trim();
    } else {
      analysisText = fullText.split(/CONCEPT:/i)[0].trim();
    }

    const conceptMatch = fullText.match(/CONCEPT:\s*(.+)/i);
    if (conceptMatch) {
      concept = conceptMatch[1].trim().replace(/^["'[]|["'\]]$/g, "");
    }

    // ────────────────────────────────────────────────────────────────────
    // Structured walkthrough: ask Gemini for a 3-5 beat sequence the
    // frontend can drive on the board. Run in parallel-ish (after the
    // prose) so a failure here never blocks the legacy fallback.
    // ────────────────────────────────────────────────────────────────────
    let steps: CoachStep[] | null = null;
    try {
      const stepsPrompt = buildStepsPrompt({
        studentColor: sideToMove as "White" | "Black",
        rosters,
        boardDescription,
        positionContext,
        phase,
        wrongMove,
        correctMove,
        cpLossPawns: cpLoss,
        refutationFacts,
        correctMoveFacts,
        wrongMoveFacts,
        mastersContext: mastersContext || undefined,
      });

      const ensureFullFen = (f: string): string => {
        const parts = f.split(" ");
        if (parts.length >= 6) return f;
        if (parts.length === 4) return f + " 0 1";
        return f;
      };
      const fullFen = ensureFullFen(fen);

      // Attempt 1
      let raw = await callGeminiForSteps(GEMINI_API_KEY, stepsPrompt);
      let parsed = raw ? tryParseJson(raw) : null;
      let validated = parsed
        ? validateAndNormalizeSteps(fullFen, parsed.steps)
        : null;

      // Attempt 2 (single retry on failure)
      if (!validated) {
        console.warn(
          "[explainBlunder] steps validation failed on first try, retrying once",
        );
        raw = await callGeminiForSteps(GEMINI_API_KEY, stepsPrompt);
        parsed = raw ? tryParseJson(raw) : null;
        validated = parsed
          ? validateAndNormalizeSteps(fullFen, parsed.steps)
          : null;
      }

      if (validated) {
        steps = validated;
        // Prefer Gemini's steps-mode concept if present and the prose-mode
        // didn't already produce one.
        if (
          (!concept || concept.length === 0) &&
          parsed?.concept &&
          typeof parsed.concept === "string"
        ) {
          concept = parsed.concept.trim();
        }
      } else {
        console.warn(
          "[explainBlunder] steps validation failed twice — falling back to prose only",
        );
      }
    } catch (e) {
      console.error("[explainBlunder] steps generation threw:", e);
      // Fall through with steps = null — frontend renders prose only.
    }

    return Response.json({
      analysis: analysisText || "The coach could not analyze this position.",
      concept,
      steps,
    });
  } catch (error) {
    console.error("Gemini proxy error (blunder):", error);
    return Response.json({
      analysis: "Coach unavailable — check your connection.",
      concept: "",
    });
  }
}
