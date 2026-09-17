import { Chess } from "chess.js";
import db from "../db";
import { normalizeFen } from "../utils/fen";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

interface ChallengeBody {
  fen: string;
  /** The move that the drill currently treats as correct (the user's stored answer) */
  storedCorrectSan: string;
  /** What the engine said is best (rank-1 line) */
  engineBestSan: string;
  /** Short PV in SAN (e.g. "e4 e5 Nf3") for context */
  engineBestPvSan?: string;
  /** Whether the stored move matches the engine's top line within the confidence gap */
  isStoredCorrect: boolean;
  /** cp eval of rank-1 line (centipawns) */
  engineCp?: number | null;
  /** cp eval of rank-2 line, for context */
  engineSecondCp?: number | null;
  repertoireId?: number;
}

interface ChallengeResponse {
  ok: boolean;
  outcome: "confirmed" | "corrected";
  /** Deeper coaching paragraph from Gemini */
  deeperAnalysis: string;
  /** When corrected, the SAN the drill will use going forward */
  newCorrectSan?: string;
  /** Whether the drill row was actually adjusted */
  drillAdjusted?: boolean;
}

async function callGeminiText(
  apiKey: string,
  prompt: string,
): Promise<string> {
  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 600,
          temperature: 0.4,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      console.error("[challenge] Gemini error:", await res.text());
      return "";
    }
    const data = (await res.json()) as any;
    return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
  } catch (e) {
    console.error("[challenge] Gemini fetch threw:", e);
    return "";
  }
}

function describeBoardFromFen(fen: string): string {
  const pieceNames: Record<string, string> = {
    K: "White King", Q: "White Queen", R: "White Rook", B: "White Bishop",
    N: "White Knight", P: "White Pawn",
    k: "Black King", q: "Black Queen", r: "Black Rook", b: "Black Bishop",
    n: "Black Knight", p: "Black Pawn",
  };
  const ranks = fen.split(" ")[0].split("/");
  const pieces: string[] = [];
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of ranks[r]) {
      if (/\d/.test(ch)) f += parseInt(ch);
      else {
        const sq = String.fromCharCode(97 + f) + (8 - r);
        pieces.push(`${pieceNames[ch] ?? ch} on ${sq}`);
        f++;
      }
    }
  }
  return pieces.join(", ");
}

/**
 * Adjust the drill so future training expects `newSan` at this FEN instead of
 * the previously stored answer.
 *   - Book position: promote the new SAN inside `positions` so the canonical
 *     `ORDER BY is_main_line DESC, depth ASC, san ASC` picks it first. Other
 *     book replies at the FEN are kept (they stay correct via acceptableSans).
 *   - Non-book position (game blunder drill): record in `drill_corrections`.
 *     Never insert game FENs into `positions` — that grafts middlegame
 *     positions into the repertoire tree, repertoire-mode sessions, and
 *     deviation detection.
 *   - Either way, reset the progress row so the new answer is re-drilled
 *     fresh (otherwise SM-2 may suppress it for weeks).
 */
function adjustDrill(
  repertoireId: number,
  fen: string,
  newSan: string,
): boolean {
  try {
    const chess = new Chess(fen);
    const move = chess.move(newSan);
    if (!move) return false;
    const nextFen = chess.fen();
    const nFen = normalizeFen(fen);

    const isBookPosition =
      (
        db
          .query(
            "SELECT COUNT(*) as c FROM positions WHERE repertoire_id = ? AND fen = ?",
          )
          .get(repertoireId, nFen) as { c: number }
      ).c > 0;

    const apply = db.transaction(() => {
      if (isBookPosition) {
        // Demote earlier challenge corrections at this FEN so two corrections
        // never tie at (is_main_line=1, depth=-1) and resolve alphabetically.
        // Genuine imported rows are left untouched.
        db.query(
          `UPDATE positions SET is_main_line = 0, depth = 0
           WHERE repertoire_id = ? AND fen = ? AND san != ?
             AND comment = 'challenge-corrected'`,
        ).run(repertoireId, nFen, move.san);

        // Upsert, not INSERT OR REPLACE: when the engine's move is already a
        // book row, keep its comment/next_fen and only promote its priority.
        db.query(
          `INSERT INTO positions (repertoire_id, fen, san, next_fen, comment, is_main_line, depth)
           VALUES (?, ?, ?, ?, 'challenge-corrected', 1, -1)
           ON CONFLICT(repertoire_id, fen, san)
           DO UPDATE SET is_main_line = 1, depth = -1`,
        ).run(repertoireId, nFen, move.san, nextFen);
      } else {
        db.query(
          `INSERT INTO drill_corrections (repertoire_id, fen, san, next_fen)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(repertoire_id, fen) DO UPDATE
             SET san = excluded.san, next_fen = excluded.next_fen,
                 created_at = datetime('now')`,
        ).run(repertoireId, nFen, move.san, nextFen);
      }

      // Reset progress state so we drill the new answer fresh
      db.query(
        `UPDATE progress
         SET ease_factor = 2.5,
             interval_days = 0,
             next_review = datetime('now'),
             streak = 0
         WHERE repertoire_id = ? AND fen = ?`,
      ).run(repertoireId, nFen);
    });
    apply();

    return true;
  } catch (e) {
    console.error("[challenge] adjustDrill failed:", e);
    return false;
  }
}

export async function challengeMove(req: Request): Promise<Response> {
  let body: ChallengeBody;
  try {
    body = (await req.json()) as ChallengeBody;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const {
    fen,
    storedCorrectSan,
    engineBestSan,
    engineBestPvSan,
    isStoredCorrect,
    engineCp,
    engineSecondCp,
    repertoireId,
  } = body;

  if (!fen || !storedCorrectSan || !engineBestSan) {
    return Response.json(
      { error: "fen, storedCorrectSan, engineBestSan required" },
      { status: 400 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const sideToMove = fen.split(" ")[1] === "w" ? "White" : "Black";
  const board = describeBoardFromFen(fen);

  let deeperAnalysis = "";
  let outcome: "confirmed" | "corrected";
  let newCorrectSan: string | undefined;
  let drillAdjusted = false;

  if (isStoredCorrect) {
    outcome = "confirmed";
    if (apiKey) {
      const prompt = `You are a Grandmaster chess coach. The student challenged the drill's answer in this position and Stockfish confirms it IS the best move. Give the student a DEEPER understanding of WHY ${storedCorrectSan} is correct.

The student is playing as ${sideToMove}.

EXACT BOARD:
${board}

The drill's correct move (engine-confirmed at depth 20): ${storedCorrectSan}
${engineBestPvSan ? `Best continuation: ${engineBestPvSan}` : ""}
${engineCp != null ? `Eval after the move: ${(engineCp / 100).toFixed(2)}` : ""}
${engineSecondCp != null && engineCp != null ? `Gap to 2nd-best line: ${((engineCp - engineSecondCp) / 100).toFixed(2)} pawns` : ""}

Write a 3-4 sentence deeper coaching note. Don't restate "${storedCorrectSan} is best" — explain the underlying ideas: what concrete piece/square it attacks or controls, what plan or threat it sets up, what the alternative moves fail to achieve. Reference specific pieces and squares from the board above. Be tactical and concrete, not generic.`;
      deeperAnalysis = await callGeminiText(apiKey, prompt);
    }
    if (!deeperAnalysis) {
      deeperAnalysis = `${storedCorrectSan} is confirmed best at depth 20${
        engineCp != null && engineSecondCp != null
          ? ` (${((engineCp - engineSecondCp) / 100).toFixed(1)}-pawn margin over the 2nd-best line)`
          : ""
      }. Trust the line and look for the concrete reason it works in this exact position.`;
    }
  } else {
    outcome = "corrected";
    newCorrectSan = engineBestSan;
    if (apiKey) {
      const prompt = `You are a Grandmaster chess coach. The student challenged the drill's answer and was RIGHT — the stored answer is not actually best.

The student is playing as ${sideToMove}.

EXACT BOARD:
${board}

Drill's previously-stored answer (NOT actually best): ${storedCorrectSan}
Engine's true best move: ${engineBestSan}
${engineBestPvSan ? `Best continuation: ${engineBestPvSan}` : ""}
${engineCp != null ? `Eval after the best move: ${(engineCp / 100).toFixed(2)}` : ""}

Write a 3-4 sentence coaching note that:
1. States what ${engineBestSan} achieves concretely (piece, square, threat).
2. Notes why ${storedCorrectSan} falls short — what tactic or idea it misses, or what defense it allows.
3. Names the concept (fork, pin, prophylaxis, etc) when relevant.
Reference specific pieces and squares from the board. No generic advice.`;
      deeperAnalysis = await callGeminiText(apiKey, prompt);
    }
    if (!deeperAnalysis) {
      deeperAnalysis = `Engine prefers ${engineBestSan}${
        engineBestPvSan ? ` (${engineBestPvSan})` : ""
      } over ${storedCorrectSan}. The drill has been updated to test ${engineBestSan} going forward.`;
    }

    // Adjust the drill if we have a repertoire context
    if (repertoireId) {
      drillAdjusted = adjustDrill(repertoireId, fen, engineBestSan);
    }
  }

  const resp: ChallengeResponse = {
    ok: true,
    outcome,
    deeperAnalysis,
    newCorrectSan,
    drillAdjusted,
  };
  return Response.json(resp);
}
