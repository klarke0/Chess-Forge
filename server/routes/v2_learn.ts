import db from "../db";
import { ok, err } from "../utils/response";
import { normalizeFen } from "../utils/fen";
import {
  enumerateLines,
  buildPlacementCounts,
  frequencyScore,
  type BookLine,
} from "../utils/lines";

export interface LessonPayload {
  lineKey: string;
  chapterName: string | null;
  stage: number;
  moves: BookLine["moves"];
  kevinMoveCount: number;
  frequency: number;
  estMinutes: number;
}

export interface NextLessonResult {
  lesson: LessonPayload | null;
  totals: { lines: number; learned: number; quarantined: number };
}

export interface CompleteLessonResult {
  newStage: number;
  promoted: number;
}

const LINES_CACHE_MS = 60_000;
const linesCache = new Map<number, { lines: BookLine[]; expiresAt: number }>();

function getCachedLines(repertoireId: number): BookLine[] {
  const cached = linesCache.get(repertoireId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.lines;
  const lines = enumerateLines(repertoireId, 2000);
  linesCache.set(repertoireId, { lines, expiresAt: now + LINES_CACHE_MS });
  return lines;
}

function bustCache(repertoireId: number) {
  linesCache.delete(repertoireId);
}

interface LearnStateRow {
  line_key: string;
  stage: number;
  completed_at: string | null;
}

function getLearnStates(repertoireId: number): Map<string, LearnStateRow> {
  const rows = db
    .query("SELECT line_key, stage, completed_at FROM learn_state WHERE repertoire_id = ?")
    .all(repertoireId) as LearnStateRow[];
  const map = new Map<string, LearnStateRow>();
  for (const r of rows) map.set(r.line_key, r);
  return map;
}

function toLesson(
  line: BookLine,
  stage: number,
  placementCounts: Map<string, number>,
): LessonPayload {
  const frequency = frequencyScore(line, placementCounts);
  return {
    lineKey: line.lineKey,
    chapterName: line.chapterName,
    stage,
    moves: line.moves,
    kevinMoveCount: line.kevinMoveCount,
    frequency,
    estMinutes: Math.max(2, Math.round(line.kevinMoveCount / 3)),
  };
}

/**
 * Ladder ranking for candidate lines: highest real-game frequency first,
 * then book chapter order (chapterId ASC, nulls last for deep sidelines
 * with no attribution), then shortest lines first.
 */
function rankLines(
  lines: BookLine[],
  placementCounts: Map<string, number>,
): BookLine[] {
  return [...lines].sort((a, b) => {
    const fa = frequencyScore(a, placementCounts);
    const fb = frequencyScore(b, placementCounts);
    if (fa !== fb) return fb - fa;
    const ca = a.chapterId ?? Number.POSITIVE_INFINITY;
    const cb = b.chapterId ?? Number.POSITIVE_INFINITY;
    if (ca !== cb) return ca - cb;
    return a.moves.length - b.moves.length;
  });
}

export function pickNextLesson(repertoireId: number): NextLessonResult {
  const lines = getCachedLines(repertoireId);
  const states = getLearnStates(repertoireId);
  const placementCounts = buildPlacementCounts(repertoireId);

  const stageOf = (line: BookLine) => states.get(line.lineKey)?.stage ?? 0;

  const nonQuarantined = lines.filter((l) => !l.quarantined);
  const learned = nonQuarantined.filter((l) => stageOf(l) >= 3);
  const totals = {
    // Denominator matches `learned`: quarantined lines can never be "mastered"
    // through the picker, so they shouldn't count toward the total either.
    lines: nonQuarantined.length,
    learned: learned.length,
    quarantined: lines.filter((l) => l.quarantined).length,
  };

  const unlearned = nonQuarantined.filter((l) => stageOf(l) < 3);
  if (unlearned.length > 0) {
    const [top] = rankLines(unlearned, placementCounts);
    return { lesson: toLesson(top, stageOf(top), placementCounts), totals };
  }

  if (learned.length > 0) {
    // Refresh pick: least-recently completed stage-3 line.
    const sorted = [...learned].sort((a, b) => {
      const ca = states.get(a.lineKey)?.completed_at ?? "";
      const cb = states.get(b.lineKey)?.completed_at ?? "";
      return ca.localeCompare(cb);
    });
    const pick = sorted[0];
    return { lesson: toLesson(pick, stageOf(pick), placementCounts), totals };
  }

  return { lesson: null, totals };
}

export function completeLesson(
  repertoireId: number,
  lineKey: string,
  stage: number,
  passed: boolean,
): CompleteLessonResult {
  bustCache(repertoireId);

  const existing = db
    .query("SELECT stage FROM learn_state WHERE repertoire_id = ? AND line_key = ?")
    .get(repertoireId, lineKey) as { stage: number } | null;
  const current = existing?.stage ?? 0;

  const advances = passed && stage > current;
  const newStage = advances ? stage : current;
  // A steady-state re-pass (already at stage 3, passes stage 3 again) doesn't
  // advance the stage, but it must still bump completed_at — otherwise the
  // refresh picker (sorts by completed_at ASC) serves this exact line
  // forever once everything is learned.
  const touchesStage3 = passed && stage === 3 && newStage === 3;

  if (advances || touchesStage3) {
    const completedAt = newStage >= 3 ? new Date().toISOString() : null;
    db.query(
      `INSERT INTO learn_state (repertoire_id, line_key, stage, completed_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(repertoire_id, line_key) DO UPDATE SET
         stage = excluded.stage,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at`,
    ).run(repertoireId, lineKey, newStage, completedAt);
  }

  let promoted = 0;
  if (advances && newStage >= 3) {
    const lines = getCachedLines(repertoireId);
    const line = lines.find((l) => l.lineKey === lineKey);
    if (line) {
      // next_review = now so promoted rows are immediately due through
      // v2_train_now's source-1 predicate (total_attempts=0 alone doesn't
      // satisfy it — these rows would otherwise never reach Train Now).
      const insertProgress = db.prepare(
        `INSERT OR IGNORE INTO progress (repertoire_id, fen, total_attempts, correct_attempts, streak, next_review)
         VALUES (?, ?, 0, 0, 0, datetime('now'))`,
      );
      for (const move of line.moves) {
        if (!move.isKevinMove) continue;
        const result = insertProgress.run(repertoireId, normalizeFen(move.fen));
        promoted += result.changes;
      }
    }
  }

  return { newStage, promoted };
}

export function learnNextRoute(url: URL): Response {
  const raw = url.searchParams.get("repertoireId");
  const repertoireId = raw ? parseInt(raw, 10) : NaN;
  if (!raw || Number.isNaN(repertoireId)) {
    return err("repertoireId is required", 400);
  }
  return ok(pickNextLesson(repertoireId));
}

export async function learnCompleteRoute(req: Request): Promise<Response> {
  let body: {
    repertoireId?: number;
    lineKey?: string;
    stage?: number;
    passed?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  const { repertoireId, lineKey, stage, passed } = body;
  if (typeof repertoireId !== "number" || Number.isNaN(repertoireId)) {
    return err("repertoireId is required", 400);
  }
  if (!lineKey || typeof lineKey !== "string") {
    return err("lineKey is required", 400);
  }
  if (stage !== 1 && stage !== 2 && stage !== 3) {
    return err("stage must be 1, 2, or 3", 400);
  }
  if (typeof passed !== "boolean") {
    return err("passed is required", 400);
  }

  return ok(completeLesson(repertoireId, lineKey, stage, passed));
}
