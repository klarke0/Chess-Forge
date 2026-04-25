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

export function addRepertoirePosition(repertoireId: number, data: { fen: string; san: string; nextFen: string; comment?: string }) {
  return request<{ ok: boolean }>(`/repertoires/${repertoireId}/positions`, {
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
}

export function recordAttempt(repertoireId: number, record: AttemptRecord) {
  return request<{ ok: boolean }>("/progress/record", {
    method: "POST",
    body: JSON.stringify({ repertoireId, ...record }),
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
  const res = await fetch(`/api/progress/${repertoireId}/stats`);
  if (!res.ok) throw new Error('Failed to fetch progress stats');
  return res.json();
}

export async function getBlunders(limit = 20): Promise<BlunderMove[]> {
  const res = await fetch(`/api/games/blunders?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch blunders');
  return res.json();
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
  const res = await fetch('/api/analyze/patterns');
  if (!res.ok) throw new Error('Failed to fetch pattern report');
  return res.json();
}

export async function runPatternAnalysis(): Promise<PatternAnalysis> {
  const res = await fetch('/api/analyze/patterns', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to run pattern analysis');
  return res.json();
}

export interface TrainNowCounts {
  blunders: number;
  deviations: number;
  review: number;
  total: number;
}

export function getTrainNowCounts(repertoireId: number): Promise<TrainNowCounts> {
  return request<TrainNowCounts>(`/v2/train-now?repertoireId=${repertoireId}&countOnly=true`);
}
