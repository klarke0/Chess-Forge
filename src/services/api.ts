const BASE = "/api";

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).error || `API error ${res.status}`);
    }
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// --- Repertoires ---

export interface Repertoire {
  id: number;
  name: string;
  description: string | null;
  side: 'white' | 'black';
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: number;
  name: string;
  sortOrder: number;
  startMoves: string[];
  firstFen: string;
  learnRuns: number;
}

export interface PositionMove {
  san: string;
  nextFen: string;
  comment?: string;
  isMainLine?: boolean;
  depth?: number;
}

export type PositionTree = Record<string, PositionMove[]>;

export function listRepertoires() {
  return request<Repertoire[]>("/repertoires");
}

export function getPositions(repertoireId: number) {
  return request<PositionTree>(`/repertoires/${repertoireId}/positions`);
}

export function getChapters(repertoireId: number) {
  return request<Chapter[]>(`/repertoires/${repertoireId}/chapters`);
}

export function importRepertoire(data: { name: string; chapters?: any[]; positions: Record<string, any[]> }) {
  return request<{ repertoireId: number; positionCount: number }>("/repertoires/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function fetchLichessExplorer(fen: string) {
  const url = `https://explorer.lichess.ovh/lichess?fen=${encodeURIComponent(fen)}&ratings=1800,2000,2200,2500&speeds=blitz,rapid,classical`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch Lichess Explorer data');
  }
  return response.json();
}

export interface MastersMove {
  san: string;
  uci: string;
  white: number;
  draws: number;
  black: number;
}

export interface MastersData {
  white: number;
  draws: number;
  black: number;
  moves: MastersMove[];
}

export async function fetchLichessMasters(fen: string): Promise<MastersData> {
  const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=12&topGames=0`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Lichess Masters API error');
  return res.json();
}

// --- Progress ---

export interface ProgressEntry {
  fen: string;
  total_attempts: number;
  correct_attempts: number;
  streak: number;
  ease_factor: number;
  interval_days: number;
  next_review: string | null;
  last_reviewed: string | null;
  expected_moves?: string[];
  side?: 'white' | 'black';
  repertoire_name?: string;
  repertoire_id?: number;
}

export function getProgress(repertoireId: number) {
  return request<ProgressEntry[]>(`/progress/${repertoireId}`);
}

export interface AttemptRecord {
  fen: string;
  correct: boolean;
  grade?: number;
  easeFactor?: number;
  intervalDays?: number;
  nextReview?: string;
  /** V2 metadata used to derive initial ease factor for new progress rows. */
  source?: string;
  /** V2 cpLoss in pawns — used to bucket initial ease for blunder sources. */
  cpLoss?: number;
  /** Idempotency key: the server ignores a repeat of the same id. */
  attemptId?: string;
}

// crypto.randomUUID only exists in secure contexts (https / localhost).
function newAttemptId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function recordAttempt(repertoireId: number, record: AttemptRecord) {
  return request<{ ok: boolean }>("/progress/record", {
    method: "POST",
    body: JSON.stringify({
      repertoireId,
      attemptId: newAttemptId(),
      ...record,
    }),
  });
}

export function updateChapterLearnRuns(chapterId: number, learnRuns: number) {
  return request<{ ok: boolean }>(`/chapters/${chapterId}/learn_runs`, {
    method: "PATCH",
    body: JSON.stringify({ learnRuns }),
  });
}

export function getWeakPositions(repertoireId: number) {
  return request<(ProgressEntry & { accuracy: number })[]>(`/progress/${repertoireId}/weak`);
}

export function getDuePositions(repertoireId: number | 'all') {
  return request<ProgressEntry[]>(`/progress/${repertoireId}/due`);
}

// --- Sessions ---

export interface Session {
  id: number;
  repertoire_id: number;
  started_at: string;
  ended_at: string | null;
  positions_drilled: number;
  correct_count: number;
  mistake_count: number;
}

export function startSession(repertoireId: number) {
  return request<{ id: number }>("/sessions", {
    method: "POST",
    body: JSON.stringify({ repertoireId }),
  });
}

export function endSession(sessionId: number, stats: { positionsDrilled?: number; correctCount?: number; mistakeCount?: number }) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(stats),
  });
}

export function listSessions(repertoireId?: number) {
  const query = repertoireId ? `?repertoireId=${repertoireId}` : "";
  return request<Session[]>(`/sessions${query}`);
}

// --- Games ---

export interface GameRecord {
  id: number;
  uuid: string | null;
  white_username: string | null;
  black_username: string | null;
  user_color: 'white' | 'black' | null;
  result: 'win' | 'loss' | 'draw' | null;
  white_result: string | null;
  black_result: string | null;
  time_control: string | null;
  time_class: 'bullet' | 'blitz' | 'rapid' | 'classical' | null;
  opening_class: string | null;
  opening_name: string | null;
  eco: string | null;
  game_shape: string | null;
  termination: string | null;
  analysis_json: string | null;
  date: string | null;
  pgn: string | null;
  imported_at: string;
}

export function listGames(limit = 50, offset = 0, unanalyzedOnly = false) {
  const query = `limit=${limit}&offset=${offset}${unanalyzedOnly ? '&unanalyzedOnly=true' : ''}`;
  return request<GameRecord[]>(`/games?${query}`);
}

export function getGame(id: number) {
  return request<GameRecord>(`/games/${id}`);
}

export function saveGameAnalysis(id: number, analysis: any[]) {
  return request<{ ok: boolean }>(`/games/${id}/analysis`, {
    method: "POST",
    body: JSON.stringify({ analysis }),
  });
}

export function clearAllAnalysis() {
  return request<{ ok: boolean }>('/games/clear-analysis', {
    method: 'POST',
  });
}

export function syncGamesFromChessCom(username: string) {
  return request<{ imported: number }>('/games/sync', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export function uploadGamesPgn(pgn: string, username: string) {
  return request<{ imported: number }>('/games/upload', {
    method: 'POST',
    body: JSON.stringify({ pgn, username }),
  });
}

// --- AI Coach ---

export interface AnalyzeRequest {
  fen: string;
  lastMove: string;
  turn: string;
  userColor?: string;
  engineData?: { bestMove: string; eval: string; line: string };
  openingName?: string;
  repertoireComment?: string;
  mode?: string;
  repertoireMoves?: string[];
  mastersData?: MastersData | null;
  moveHistory?: string[];
  deviationContext?: {
    moveNumber: number;
    playedSan: string;
    repertoireSan: string;
    evalDiff: number;
  } | null;
}

export interface AnalyzeResponse {
  text: string;
  demoLine: string[];
  isError: boolean;
}

export function analyzePosition(data: AnalyzeRequest) {
  return request<AnalyzeResponse>('/analyze', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export interface ProgressStats {
  totalTracked: number;
  mastered: number;
  dueToday: number;
  weeklyAccuracy: number;
  streak: number;
  lastReviewed: string | null;
  /** True when the user has reviewed at least one position today. */
  dailyGoalDone: boolean;
}

export interface WeakestPosition {
  fen: string;
  correctSan: string;
  accuracy: number;
}

export async function getWeakestPosition(repertoireId: number): Promise<WeakestPosition | null> {
  // request<T> throws on non-2xx; fall through to null so the home dashboard
  // can render even when the endpoint hasn't been seeded yet.
  return request<WeakestPosition | null>(`/progress/${repertoireId}/weakest`).catch(() => null);
}

export interface BlunderMove {
  gameId: number;
  date: string;
  white: string;
  black: string;
  result: string;
  userColor: string | null;
  moveIndex: number;
  san: string;
  grade: string;
  cpLoss: number;
  fen: string;
  gameShape: string | null;
  openingClass: string | null;
  evals: number[];
}

export async function getProgressStats(repertoireId: number): Promise<ProgressStats> {
  return request<ProgressStats>(`/progress/${repertoireId}/stats`);
}

export async function getBlunders(limit = 20): Promise<BlunderMove[]> {
  return request<BlunderMove[]>(`/games/blunders?limit=${limit}`);
}

export interface PatternAnalysis {
  summary: string;
  patterns: string[];
  action: string | null;
  createdAt: string | null;
  stats: {
    totalGames: number;
    gamesAnalyzed: number;
    whiteWins: number;
    whiteDraws: number;
    whiteLosses: number;
    blackWins: number;
    blackDraws: number;
    blackLosses: number;
    opening: number;
    middlegame: number;
    endgame: number;
    gamesLostOnTime: number;
    blundersUnderPressure: number;
    shapes: Record<string, number>;
    avgTimeWhite: number | null;
    avgTimeBlack: number | null;
  };
  openings: Array<{
    name: string;
    games: number;
    winPct: number;
    drawPct: number;
    lossPct: number;
  }>;
  isError: boolean;
}

export async function getPatternReport(): Promise<PatternAnalysis | null> {
  return request<PatternAnalysis | null>('/analyze/patterns');
}

export async function runPatternAnalysis(): Promise<PatternAnalysis> {
  return request<PatternAnalysis>('/analyze/patterns', { method: 'POST' });
}

export interface TrainNowCounts {
  blunders: number;
  deviations: number;
  review: number;
  total: number;
}

export function getTrainNowCounts(
  repertoireId: number,
  phase?: string,
  mode?: string,
): Promise<TrainNowCounts> {
  const params = new URLSearchParams({
    repertoireId: String(repertoireId),
    countOnly: 'true',
  });
  if (phase && phase !== 'all') params.set('phase', phase);
  if (mode && mode !== 'blunder') params.set('mode', mode);
  return request<TrainNowCounts>(`/v2/train-now?${params.toString()}`);
}

export type TacticalPattern =
  | "back-rank"
  | "pin"
  | "fork"
  | "discovered-attack"
  | "promotion"
  | "endgame"
  | "opening"
  | "middlegame"
  | "other";

export interface TrainNowPosition {
  id: string;
  fen: string;
  correctSan: string;
  san?: string;
  context?: string;
  cpLoss?: number;
  phase?: string;
  source?: 'blunder' | 'deviation' | 'review' | 'repertoire' | 'punish';
  firstEncounter?: boolean;
  /** Heuristic tactical theme label assigned at session-build time. */
  pattern?: TacticalPattern;
  /**
   * Every stored book reply for this FEN. A position reachable by several move
   * orders can have more than one correct answer; `correctSan` is only the one
   * we display. Grade against this list.
   */
  acceptableSans?: string[];
  /** Punish drills only — the opponent's book-deviating move to be punished. */
  opponentMove?: string;
  /**
   * Punish drills only — the full punishment line, refutationSans[0] ===
   * correctSan. Drives the client-built refutation walkthrough.
   */
  refutationSans?: string[];
}

export interface FetchTrainNowOptions {
  fen?: string;
  mode?: string;
  phase?: string;
}

/**
 * Fetch a full drill session (positions + scoring metadata) for the given
 * repertoire. The server caps results at 12 by default; pass `fen` to fetch
 * a single-position session (used by deviation drilling from GamesTab).
 */
export function fetchTrainNowSession(
  repertoireId: number,
  opts: FetchTrainNowOptions = {},
): Promise<{ positions: TrainNowPosition[] }> {
  const params = new URLSearchParams({ repertoireId: String(repertoireId) });
  if (opts.fen) params.set('fen', opts.fen);
  if (opts.mode && opts.mode !== 'blunder') params.set('mode', opts.mode);
  if (opts.phase && opts.phase !== 'all') params.set('phase', opts.phase);
  return request<{ positions: TrainNowPosition[] }>(
    `/v2/train-now?${params.toString()}`,
  );
}


// --- Velocity / Blunder Trend ---

export interface VelocityWeek {
  label: string;
  blunders: number;
  games: number;
  avgCpLoss: number;
}

export function fetchVelocity(repertoireId?: number): Promise<{ weeks: VelocityWeek[] }> {
  const params = new URLSearchParams();
  if (repertoireId) params.set('repertoireId', String(repertoireId));
  return request<{ weeks: VelocityWeek[] }>(`/v2/insights/velocity?${params.toString()}`);
}

export function refreshAnalysis(): Promise<{ ok: boolean; queued: number }> {
  return request<{ ok: boolean; queued: number }>("/v2/refresh-analysis", { method: "POST" });
}

// --- Game type stats ---

export interface GameTypeStat {
  timeClass: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  winPct: number;
  drawPct: number;
  lossPct: number;
}

export function fetchGameTypeStats(): Promise<{ byType: GameTypeStat[] }> {
  return request<{ byType: GameTypeStat[] }>("/v2/insights/game-type-stats");
}

// --- Insights dashboard (time-of-day + repertoire accuracy) ---

export interface TimeOfDayBucket {
  bucket: "morning" | "afternoon" | "evening" | "night";
  label: string;
  hourRange: string;
  sessions: number;
  accuracy: number;
}

export interface RepertoireAccuracyStat {
  id: number;
  name: string;
  positions: number;
  attempts: number;
  accuracy: number;
}

export interface InsightsDashboard {
  timeOfDay: TimeOfDayBucket[];
  repertoireAccuracy: RepertoireAccuracyStat[];
}

export function fetchInsightsDashboard(): Promise<InsightsDashboard> {
  return request<InsightsDashboard>("/v2/insights/dashboard");
}

// --- Weekly accuracy trend ---

export interface WeeklyAccuracyWeek {
  label: string;
  /** 0-100 accuracy percentage, or null when no sessions in that week */
  accuracy: number | null;
  attempts: number;
}

export function fetchWeeklyAccuracy(): Promise<{ weeks: WeeklyAccuracyWeek[] }> {
  return request<{ weeks: WeeklyAccuracyWeek[] }>("/v2/insights/weekly-accuracy");
}

// --- Opponent model ---

export interface TopOpponent {
  opponent: string;
  deviationCount: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
}

export function fetchTopOpponents(): Promise<{ opponents: TopOpponent[] }> {
  return request<{ opponents: TopOpponent[] }>("/v2/insights/top-opponents");
}

// --- Repertoire settings ---

export interface DeleteProgressResult {
  cleared: number;
  repertoireId: number;
  name: string;
}

export function deleteRepertoireProgress(repertoireId: number): Promise<DeleteProgressResult> {
  return request<DeleteProgressResult>(`/v2/repertoire/${repertoireId}/progress`, {
    method: "DELETE",
  });
}

// --- Learn (watch / guided / blind ladder) ---

export interface LearnMove {
  fen: string;
  san: string;
  comment: string | null;
  isKevinMove: boolean;
}

export interface Lesson {
  lineKey: string;
  chapterName: string | null;
  stage: number;
  moves: LearnMove[];
  kevinMoveCount: number;
  frequency: number;
  estMinutes: number;
}

export interface NextLessonResult {
  lesson: Lesson | null;
  totals: { lines: number; learned: number; quarantined: number };
}

export interface CompleteLessonResult {
  newStage: number;
  promoted: number;
}

// v2_learn routes respond through the { ok, data } envelope (server/utils/response.ts),
// unlike the bare-body v2_train_now / v2_challenge routes — unwrap .data here.
export async function getNextLesson(repertoireId: number): Promise<NextLessonResult> {
  const res = await request<{ ok: true; data: NextLessonResult }>(
    `/v2/learn/next?repertoireId=${repertoireId}`,
  );
  return res.data;
}

export async function completeLesson(
  repertoireId: number,
  lineKey: string,
  stage: 1 | 2 | 3,
  passed: boolean,
): Promise<CompleteLessonResult> {
  const res = await request<{ ok: true; data: CompleteLessonResult }>("/v2/learn/complete", {
    method: "POST",
    body: JSON.stringify({ repertoireId, lineKey, stage, passed }),
  });
  return res.data;
}
