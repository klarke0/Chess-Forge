import { create } from 'zustand';
import jobavaData from '../data/jobava_full.json';
import * as api from '../services/api';
import { normalizeFen } from '../utils/normalizeFen';

interface PositionMove {
  san: string;
  nextFen: string;
  comment?: string;
}

interface RepertoireState {
  repertoireId: number;
  repertoireName: string;
  repertoireSide: 'white' | 'black';
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
  getCorrectMovesForChapter: (fen: string, moveHistory: string[]) => PositionMove[];
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
  addPositionToStore: (fen: string, san: string, nextFen: string, comment?: string) => void;
}

// Normalize all position keys in a positions map to 4-field FENs so that
// transpositions (same board, different clock counters) always resolve.
function normalizePositionKeys(positions: Record<string, any>): Record<string, PositionMove[]> {
  const result: Record<string, PositionMove[]> = {};
  for (const [fen, moves] of Object.entries(positions)) {
    result[normalizeFen(fen)] = moves as PositionMove[];
  }
  return result;
}

export const useRepertoireStore = create<RepertoireState>((set, get) => ({
  repertoireId: 1,
  repertoireName: 'Jobava London',
  repertoireSide: 'white',
  positions: normalizePositionKeys(jobavaData.positions as Record<string, any>),
  chapters: (jobavaData as any).chapters,
  availableRepertoires: [],
  weakPositions: {},
  chessComUsername: localStorage.getItem('chess_com_username') || 'Klarke',
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
      
      const repId = targetId || get().repertoireId || repertoires[0].id;
      const rep = repertoires.find(r => r.id === repId) || repertoires[0];

      const [positions, chapters, weakData] = await Promise.all([
        api.getPositions(rep.id),
        api.getChapters(rep.id),
        api.getWeakPositions(rep.id).catch(() => []),
      ]);
      // Convert weak positions from API to Record<fen, count>
      const weakPositions: Record<string, number> = {};
      for (const w of weakData) {
        weakPositions[normalizeFen(w.fen)] = w.total_attempts - w.correct_attempts;
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
      console.warn('API unavailable, using bundled data:', e);
      set({ isLoading: false });
    }
  },

  setActiveRepertoire: async (id) => {
    await get().loadFromApi(id);
  },

  selectChapter: (idx) => set({ selectedChapter: idx, showChapters: false }),

  recordMistake: (fen) => {
    const { weakPositions } = get();
    const key = normalizeFen(fen);
    set({ weakPositions: { ...weakPositions, [key]: (weakPositions[key] || 0) + 1 } });
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
      const guidedMove = allPossible.find(m => m.san === guidedSan);
      
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
    let currentFen = normalizeFen(chapter.firstFen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    chapterFens.add(currentFen);
    for (const san of (chapter.startMoves ?? [])) {
      const move = (positions[currentFen] ?? []).find(m => m.san === san);
      if (!move) break;
      currentFen = normalizeFen(move.nextFen);
      chapterFens.add(currentFen);
    }

    const chapterWeakCount = [...chapterFens].filter(fen => weakPositions[fen] > 0).length;
    const deduction = Math.min(20, chapterWeakCount * 2);

    return Math.max(0, base - deduction);
  },

  toggleChapters: () => set(state => ({
    showChapters: !state.showChapters,
    showTree: false,
    showDashboard: false
  })),

  toggleTree: () => set(state => ({
    showTree: !state.showTree,
    showChapters: false,
    showDashboard: false
  })),

  toggleDashboard: () => set(state => ({
    showDashboard: !state.showDashboard,
    showChapters: false,
    showTree: false
  })),

  setShowChapters: (val) => set({ showChapters: val }),
  setTree: (val) => set({ showTree: val }),
  setDashboard: (val) => set({ showDashboard: val }),
  setChessComUsername: (username) => {
    localStorage.setItem('chess_com_username', username);
    set({ chessComUsername: username });
  },

  updateChapterLearnRuns: (idx, runs) => set(state => ({
    chapters: state.chapters.map((ch: any, i: number) =>
      i === idx ? { ...ch, learnRuns: runs } : ch
    ),
  })),

  addPositionToStore: (fen: string, san: string, nextFen: string, comment?: string) => {
    set((state) => {
      const normalizedFen = normalizeFen(fen);
      const positions = { ...state.positions };
      
      if (!positions[normalizedFen]) {
        positions[normalizedFen] = [];
      }
      
      const existingIdx = positions[normalizedFen].findIndex(m => m.san === san);
      
      if (existingIdx >= 0) {
        // Update existing move's comment
        positions[normalizedFen][existingIdx] = {
          ...positions[normalizedFen][existingIdx],
          comment: comment || positions[normalizedFen][existingIdx].comment
        };
      } else {
        // Add new move
        positions[normalizedFen] = [
          ...positions[normalizedFen],
          { san, nextFen, comment }
        ];
      }
      
      return { positions };
    });
  },
}));
