import db from "../db";

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_URL =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

  // ── GET /api/analyze/patterns — return cached report ─────────────────────────
  export function getPatternReport(_req: Request): Response {
    const row = db.query(
      `SELECT report_json, created_at FROM pattern_reports ORDER BY id DESC LIMIT 1`
    ).get() as { report_json: string; created_at: string } | null;

    if (!row) return Response.json(null);

    try {
      const report = JSON.parse(row.report_json);
      return Response.json({ ...report, createdAt: row.created_at });
    } catch {
      return Response.json(null);
    }
  }

  // ── POST /api/analyze/patterns — run new analysis and cache ───────────────────
  export async function runPatternAnalysis(_req: Request): Promise<Response> {
    const games = db.query(
      `SELECT id, date, white_username, black_username, result, user_color,
              analysis_json, opening_class, time_control, termination, game_shape
       FROM games WHERE analysis_json IS NOT NULL ORDER BY date DESC LIMIT 100`
    ).all() as any[];

    if (games.length === 0) {
      return Response.json({
        summary: "No analyzed games found. Run analysis on your recent games first.",
        patterns: [], action: null, stats: buildEmptyStats(), openings: [], isError: false, createdAt: null,
      });
    }

    // Win rates
    const whiteWins   = games.filter(g => g.user_color === 'white' && g.result === 'win').length;
    const whiteDraws  = games.filter(g => g.user_color === 'white' && g.result === 'draw').length;
    const whiteLosses = games.filter(g => g.user_color === 'white' && g.result === 'loss').length;
    const blackWins   = games.filter(g => g.user_color === 'black' && g.result === 'win').length;
    const blackDraws  = games.filter(g => g.user_color === 'black' && g.result === 'draw').length;
    const blackLosses = games.filter(g => g.user_color === 'black' && g.result === 'loss').length;

    interface PhaseStats { errors: number; totalCpLoss: number; }
    const phases: Record<string, PhaseStats> = {
      opening: { errors: 0, totalCpLoss: 0 },
      middlegame: { errors: 0, totalCpLoss: 0 },
      endgame: { errors: 0, totalCpLoss: 0 },
    };
    let totalTimeSamplesWhite = 0, totalTimeWhite = 0;
    let totalTimeSamplesBlack = 0, totalTimeBlack = 0;
    let blundersUnderPressure = 0;
    let gamesLostOnTime = 0;
    const openingMap: Record<string, { wins: number; draws: number; losses: number; total: number }> = {};
    const shapes: Record<string, number> = {};

    for (const g of games) {
      const opKey = g.opening_class || 'Other';
      if (!openingMap[opKey]) openingMap[opKey] = { wins: 0, draws: 0, losses: 0, total: 0 };
      openingMap[opKey].total++;
      if (g.result === 'win') openingMap[opKey].wins++;
      else if (g.result === 'draw') openingMap[opKey].draws++;
      else openingMap[opKey].losses++;

      if (g.game_shape) shapes[g.game_shape] = (shapes[g.game_shape] ?? 0) + 1;
      if (g.termination && /time/i.test(g.termination) && g.result === 'loss') gamesLostOnTime++;

      let moves: any[];
      try { moves = JSON.parse(g.analysis_json); } catch { continue; }

      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        const moveNumber = Math.floor(i / 2) + 1;
        const phase = moveNumber <= 15 ? 'opening' : moveNumber <= 30 ? 'middlegame' : 'endgame';
        const isUserMove = g.user_color === 'white' ? i % 2 === 0 : i % 2 !== 0;

        if (isUserMove && (m.grade === 'blunder' || m.grade === 'mistake')) {
          phases[phase].errors++;
          phases[phase].totalCpLoss += m.cpLoss ?? 0;
          if (m.underPressure) blundersUnderPressure++;
        }
        if (m.timeSpent !== undefined && m.timeSpent !== null) {
          if (i % 2 === 0) { totalTimeSamplesWhite++; totalTimeWhite += m.timeSpent; }
          else { totalTimeSamplesBlack++; totalTimeBlack += m.timeSpent; }
        }
      }
    }

    const avgTimeWhite = totalTimeSamplesWhite > 0 ? Math.round(totalTimeWhite / totalTimeSamplesWhite) : null;
    const avgTimeBlack = totalTimeSamplesBlack > 0 ? Math.round(totalTimeBlack / totalTimeSamplesBlack) : null;
    const avgCpLoss = (p: PhaseStats) => p.errors > 0 ? Math.round(p.totalCpLoss / p.errors) : 0;

    const stats = {
      totalGames: games.length, gamesAnalyzed: games.length,
      whiteWins, whiteDraws, whiteLosses, blackWins, blackDraws, blackLosses,
      opening: phases.opening.errors, middlegame: phases.middlegame.errors, endgame: phases.endgame.errors,
      gamesLostOnTime, blundersUnderPressure, shapes, avgTimeWhite, avgTimeBlack,
    };

    const openings = Object.entries(openingMap)
      .map(([name, d]) => ({
        name, games: d.total,
        winPct:  d.total > 0 ? Math.round((d.wins  / d.total) * 100) : 0,
        drawPct: d.total > 0 ? Math.round((d.draws / d.total) * 100) : 0,
        lossPct: d.total > 0 ? Math.round((d.losses/ d.total) * 100) : 0,
      }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 10);

    if (!GEMINI_API_KEY) {
      const result = { summary: "Set GEMINI_API_KEY in server env.", patterns: [], action: null, stats, openings, isError: true };
      saveReport(result);
      return Response.json({ ...result, createdAt: new Date().toISOString() });
    }

    const whiteTotal = whiteWins + whiteDraws + whiteLosses;
    const blackTotal = blackWins + blackDraws + blackLosses;

    const prompt = `You are a chess improvement coach analyzing ${games.length} games.

  WIN RATES:
  ${whiteTotal > 0 ? `As White: ${whiteWins}W/${whiteDraws}D/${whiteLosses}L (${Math.round(whiteWins/whiteTotal*100)}% win rate)` : ''}
  ${blackTotal > 0 ? `As Black: ${blackWins}W/${blackDraws}D/${blackLosses}L (${Math.round(blackWins/blackTotal*100)}% win rate)` : ''}

  PHASE ACCURACY:
  Opening (moves 1-15): ${phases.opening.errors} errors, avg ${avgCpLoss(phases.opening)}cp lost
  Middlegame (moves 16-30): ${phases.middlegame.errors} errors, avg ${avgCpLoss(phases.middlegame)}cp lost
  Endgame (moves 31+): ${phases.endgame.errors} errors, avg ${avgCpLoss(phases.endgame)}cp lost

  TOP OPENINGS:
  ${openings.slice(0,5).map(o => `  ${o.name}: ${o.games} games, ${o.winPct}% win, ${o.lossPct}% loss`).join('\n')}

  TIME MANAGEMENT:
  ${avgTimeWhite !== null ? `Avg time/move as White: ${avgTimeWhite}s` : ''}
  ${avgTimeBlack !== null ? `Avg time/move as Black: ${avgTimeBlack}s` : ''}
  Blunders under time pressure: ${blundersUnderPressure}
  Games lost on time: ${gamesLostOnTime}

  GAME SHAPE DISTRIBUTION:
  ${Object.entries(shapes).sort((a,b)=>b[1]-a[1]).map(([s,n])=>`  ${s}: ${n}`).join('\n') || 'No shape data yet.'}

  Based on this data, give a focused improvement report. Be specific — no generic advice.

  REQUIRED FORMAT:
  SUMMARY: [2-3 sentences on biggest weakness]
  PATTERN_1: [First recurring issue]
  PATTERN_2: [Second recurring issue]
  PATTERN_3: [Third issue]
  PATTERN_4: [Fourth issue, or N/A]
  PATTERN_5: [Fifth issue, or N/A]
  ACTION: [Single most impactful improvement focus]`;

    try {
      const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 700, temperature: 0.4 },
        }),
      });

      if (!res.ok) {
        const errResult = { summary: "Gemini API error.", patterns: [], action: null, stats, openings, isError: true };
        saveReport(errResult);
        return Response.json({ ...errResult, createdAt: new Date().toISOString() });
      }

      const data = (await res.json()) as any;
      const fullText: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      const extract = (label: string, next?: string) => {
        const pattern = next
          ? new RegExp(`${label}:\\s*(.+?)(?=${next}:|$)`, "is")
          : new RegExp(`${label}:\\s*(.+?)$`, "is");
        return fullText.match(pattern)?.[1]?.trim() ?? null;
      };

      const summary = extract("SUMMARY", "PATTERN_1") ?? fullText.substring(0, 300);
      const patterns = [
        extract("PATTERN_1", "PATTERN_2"),
        extract("PATTERN_2", "PATTERN_3"),
        extract("PATTERN_3", "PATTERN_4"),
        extract("PATTERN_4", "PATTERN_5"),
        extract("PATTERN_5", "ACTION"),
      ]
        .filter((p): p is string => !!p && p.trim().toLowerCase() !== "n/a")
        .map(p => p.replace(/^\[|\]$/g, "").trim());
      const action = extract("ACTION");

      const result = { summary, patterns, action, stats, openings, isError: false };
      saveReport(result);
      return Response.json({ ...result, createdAt: new Date().toISOString() });
    } catch {
      const errResult = { summary: "Pattern analysis unavailable.", patterns: [], action: null, stats, openings, isError: true };
      saveReport(errResult);
      return Response.json({ ...errResult, createdAt: new Date().toISOString() });
    }
  }

  function buildEmptyStats() {
    return {
      totalGames: 0, gamesAnalyzed: 0,
      whiteWins: 0, whiteDraws: 0, whiteLosses: 0,
      blackWins: 0, blackDraws: 0, blackLosses: 0,
      opening: 0, middlegame: 0, endgame: 0,
      gamesLostOnTime: 0, blundersUnderPressure: 0,
      shapes: {} as Record<string, number>,
      avgTimeWhite: null as number | null,
      avgTimeBlack: null as number | null,
    };
  }

  function saveReport(report: object) {
    try {
      db.prepare(`INSERT INTO pattern_reports (report_json) VALUES (?)`).run(JSON.stringify(report));
      db.query(`DELETE FROM pattern_reports WHERE id NOT IN (SELECT id FROM pattern_reports ORDER BY id DESC LIMIT 5)`).run();
    } catch (e) {
      console.warn("Failed to save pattern report:", e);
    }
  }
