import { create } from "zustand";
import jobavaData from "../data/jobava_full.json";
import * as api from "../services/api";
import { normalizeFen } from "../utils/normalizeFen";

interface PositionMove {
  san: string;
  nextFen: string;
  comment?: string;
  isMainLine?: boolean;
  depth?: number;
}

interface RepertoireState {
  repertoireId: number;
  repertoireName: string;
  repertoireSide: "white" | "black";
  positions: Record<string, PositionMove[]>;
  chapters: any[];
  availableRepertoires: api.Repertoire[];
  weakPositions: Record<string, number>;
  selectedChapter: number | null;
  showChapters: boolean;
  showTree: boolean;
  showDashboard: boolean;
  isLoading: boolean;
  chessComUsername: string | null;

  // Actions
  loadFromApi: (repertoireId?: number) => Promise<void>;
  selectChapter: (idx: number | null) => void;
  recordMistake: (fen: string) => void;
  getCorrectMoves: (fen: string) => PositionMove[];
  getCorrectMovesForChapter: (
    fen: string,
    moveHistory: string[],
  ) => PositionMove[];
  getChapterMastery: (chapterIdx: number) => number;
  toggleChapters: () => void;
  toggleTree: () => void;
  toggleDashboard: () => void;
  setShowChapters: (val: boolean) => void;
  setTree: (val: boolean) => void;
  setDashboard: (val: boolean) => void;
  setChessComUsername: (username: string) => void;
  setActiveRepertoire: (id: number) => Promise<void>;
  updateChapterLearnRuns: (idx: number, runs: number) => void;
}

// Normalize all position keys in a positions map to 4-field FENs so that
// transpositions (same board, different clock counters) always resolve.
// Also normalizes move objects: bundled JSON uses snake_case `is_main_line`
// while the API returns camelCase `isMainLine`. Map both to `isMainLine`.
function normalizePositionKeys(
  positions: Record<string, any>,
): Record<string, PositionMove[]> {
  const result: Record<string, PositionMove[]> = {};
  for (const [fen, moves] of Object.entries(positions)) {
    result[normalizeFen(fen)] = (moves as any[]).map((m) => ({
      ...m,
      // Bundled JSON uses `is_main_line`; API returns `isMainLine`. Unify here.
      isMainLine: m.isMainLine ?? m.is_main_line ?? false,
    })) as PositionMove[];
  }
  return result;
}

const ACTIVE_REPERTOIRE_KEY = "active_repertoire_id";

export const useRepertoireStore = create<RepertoireState>((set, get) => ({
  repertoireId:
    parseInt(localStorage.getItem(ACTIVE_REPERTOIRE_KEY) || "0", 10) || 0,
  repertoireName: "Jobava London",
  repertoireSide: "white",
  positions: normalizePositionKeys(jobavaData.positions as Record<string, any>),
  chapters: (jobavaData as any).chapters,
  availableRepertoires: [],
  weakPositions: {},
  chessComUsername: localStorage.getItem("chess_com_username") || "Klarke",
  selectedChapter: null,
  showChapters: false,
  showTree: false,
  showDashboard: false,
  isLoading: false,

  loadFromApi: async (targetId) => {
    set({ isLoading: true });
    try {
      const repertoires = await api.listRepertoires();
      if (repertoires.length === 0) {
        set({ isLoading: false, availableRepertoires: [] });
        return;
      }

      const storedId = parseInt(
        localStorage.getItem(ACTIVE_REPERTOIRE_KEY) || "0",
        10,
      );
      const repId = targetId || storedId || get().repertoireId;
      // When no preference is stored, prefer white-side repertoire (the primary training focus)
      const defaultRep =
        repertoires.find((r) => r.side === "white") || repertoires[0];
      const rep =
        (repId ? repertoires.find((r) => r.id === repId) : null) || defaultRep;
      localStorage.setItem(ACTIVE_REPERTOIRE_KEY, String(rep.id));

      const [positions, chapters, weakData] = await Promise.all([
        api.getPositions(rep.id),
        api.getChapters(rep.id),
        api.getWeakPositions(rep.id).catch(() => []),
      ]);
      // Convert weak positions from API to Record<fen, count>
      const weakPositions: Record<string, number> = {};
      for (const w of weakData) {
        weakPositions[normalizeFen(w.fen)] =
          w.total_attempts - w.correct_attempts;
      }

      set({
        repertoireId: rep.id,
        repertoireName: rep.name,
        repertoireSide: rep.side,
        positions: normalizePositionKeys(positions as Record<string, any>),
        chapters,
        weakPositions,
        availableRepertoires: repertoires,
        isLoading: false,
      });
    } catch (e) {
      console.warn("API unavailable, using bundled data:", e);
      set({ isLoading: false });
    }
  },

  setActiveRepertoire: async (id) => {
    localStorage.setItem(ACTIVE_REPERTOIRE_KEY, String(id));
    await get().loadFromApi(id);
  },

  selectChapter: (idx) => set({ selectedChapter: idx, showChapters: false }),

  recordMistake: (fen) => {
    const { weakPositions } = get();
    const key = normalizeFen(fen);
    set({
      weakPositions: { ...weakPositions, [key]: (weakPositions[key] || 0) + 1 },
    });
  },

  getCorrectMoves: (fen) => {
    const { positions } = get();
    return positions[normalizeFen(fen)] || [];
  },

  getCorrectMovesForChapter: (fen, moveHistory) => {
    const { chapters, selectedChapter, positions } = get();
    const allPossible = positions[normalizeFen(fen)] || [];

    if (selectedChapter === null || !chapters[selectedChapter]) {
      return allPossible;
    }

    const chapter = chapters[selectedChapter];
    const nextIdx = moveHistory.length;

    // If the chapter guide has a move for this exact step in the history
    if (chapter.startMoves && chapter.startMoves[nextIdx]) {
      const guidedSan = chapter.startMoves[nextIdx];
      const guidedMove = allPossible.find((m) => m.san === guidedSan);

      // If the guided move exists in our position tree, prioritize it
      if (guidedMove) {
        return [guidedMove];
      }
    }

    return allPossible;
  },

  getChapterMastery: (chapterIdx) => {
    const { chapters, weakPositions, positions } = get();
    const chapter = chapters[chapterIdx];
    if (!chapter) return 0;

    // Base score: how far through the 3-phase learn cycle (0→33→67→100)
    const learnRuns = chapter.learnRuns ?? 0;
    const base = Math.min(100, Math.round((learnRuns / 3) * 100));

    // Traverse this chapter's main line to collect its FENs, then count weak ones
    const chapterFens = new Set<string>();
    let currentFen = normalizeFen(
      chapter.firstFen ??
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
    chapterFens.add(currentFen);
    for (const san of chapter.startMoves ?? []) {
      const move = (positions[currentFen] ?? []).find((m) => m.san === san);
      if (!move) break;
      currentFen = normalizeFen(move.nextFen);
      chapterFens.add(currentFen);
    }

    const chapterWeakCount = [...chapterFens].filter(
      (fen) => weakPositions[fen] > 0,
    ).length;
    const deduction = Math.min(20, chapterWeakCount * 2);

    return Math.max(0, base - deduction);
  },

  toggleChapters: () =>
    set((state) => ({
      showChapters: !state.showChapters,
      showTree: false,
      showDashboard: false,
    })),

  toggleTree: () =>
    set((state) => ({
      showTree: !state.showTree,
      showChapters: false,
      showDashboard: false,
    })),

  toggleDashboard: () =>
    set((state) => ({
      showDashboard: !state.showDashboard,
      showChapters: false,
      showTree: false,
    })),

  setShowChapters: (val) => set({ showChapters: val }),
  setTree: (val) => set({ showTree: val }),
  setDashboard: (val) => set({ showDashboard: val }),
  setChessComUsername: (username) => {
    localStorage.setItem("chess_com_username", username);
    set({ chessComUsername: username });
  },

  updateChapterLearnRuns: (idx, runs) =>
    set((state) => ({
      chapters: state.chapters.map((ch: any, i: number) =>
        i === idx ? { ...ch, learnRuns: runs } : ch,
      ),
    })),
}));
