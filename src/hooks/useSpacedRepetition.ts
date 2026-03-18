import { useState, useEffect, useCallback } from 'react';
import { Chess } from 'chess.js';
import * as api from '../services/api';
import { computeSM2, gradeFromOutcome } from '../utils/sm2';

export type ReviewStatus = 'awaiting_move' | 'wrong' | 'awaiting_next' | 'given_up';

export interface ReviewState {
  duePositions: api.ProgressEntry[];
  currentIndex: number;
  reviewFen: string | null;
  reviewStatus: ReviewStatus;
  reviewMistakeCount: number;
  reviewHint: string | null;
  reviewArrows: [string, string, string][];
  isLoading: boolean;
  isError: boolean;
  doneToday: boolean;
  currentPosition: api.ProgressEntry | null;
  onReviewDrop: (source: string, target: string) => boolean;
  giveUpReview: () => void;
  advanceToNext: () => void;
  reDrillAll: () => void;
  refetch: () => void;
}

export function useSpacedRepetition(): ReviewState {
  const [duePositions, setDuePositions] = useState<api.ProgressEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewFen, setReviewFen] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('awaiting_move');
  const [reviewMistakeCount, setReviewMistakeCount] = useState(0);
  const [reviewHint, setReviewHint] = useState<string | null>(null);
  const [reviewArrows, setReviewArrows] = useState<[string, string, string][]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  const loadDuePositions = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const positions = await api.getDuePositions('all');
      
      // Filter out the absolute starting position and any FENs that are not the player's turn
      const filtered = positions.filter(p => {
        if (p.fen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR')) return false;
        
        const isWhiteTurn = p.fen.includes(' w ');
        if (p.side === 'white' && !isWhiteTurn) return false;
        if (p.side === 'black' && isWhiteTurn) return false;
        
        return true;
      });

      setDuePositions(filtered);
      setCurrentIndex(0);
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDuePositions();
  }, [loadDuePositions]);

  // Derive the active FEN whenever index changes
  useEffect(() => {
    if (duePositions.length === 0 || currentIndex >= duePositions.length) {
      setReviewFen(null);
      return;
    }

    const position = duePositions[currentIndex];
    const fen = position.fen;

    setReviewFen(fen);

    setReviewStatus('awaiting_move');
    setReviewMistakeCount(0);
    setReviewHint(null);
    setReviewArrows([]);
  }, [currentIndex, duePositions]);

  const submitGrade = useCallback(
    (position: api.ProgressEntry, correct: boolean, mistakeCount: number, wasGivenUp: boolean) => {
      const grade = gradeFromOutcome(correct, mistakeCount, wasGivenUp);
      const sm2Result = computeSM2(
        {
          easeFactor: position.ease_factor ?? 2.5,
          intervalDays: position.interval_days ?? 0,
          repetitions: position.streak ?? 0,
        },
        grade,
      );

      const repId = position.repertoire_id ?? 0;
      if (repId > 0) {
        api.recordAttempt(repId, {
          fen: position.fen,
          correct,
          grade,
          easeFactor: sm2Result.nextEaseFactor,
          intervalDays: sm2Result.nextIntervalDays,
          nextReview: sm2Result.nextReviewDate,
        }).catch(() => {});
      }
    },
    [],
  );

  const onReviewDrop = useCallback(
    (source: string, target: string): boolean => {
      // Allow retries while wrong; block only after correct or give-up
      if (reviewStatus === 'awaiting_next' || reviewStatus === 'given_up' || !reviewFen) return false;

      const position = duePositions[currentIndex];
      if (!position) return false;

      try {
        const chess = new Chess(reviewFen);
        const move = chess.move({ from: source, to: target, promotion: 'q' });
        if (!move) return false;

        const expectedMoves = position.expected_moves || [];
        const isCorrect = expectedMoves.includes(move.san);

        if (isCorrect) {
          submitGrade(position, true, reviewMistakeCount, false);
          setReviewStatus('awaiting_next');
          setReviewHint(null);
          setReviewFen(chess.fen()); // Keep piece at destination
          return true;
        } else {
          const newMistakeCount = reviewMistakeCount + 1;
          setReviewMistakeCount(newMistakeCount);
          setReviewStatus('wrong');

          // Progressive hints — reveal more with each failure
          if (newMistakeCount >= 3 && expectedMoves.length > 0) {
            setReviewHint(`Answer: ${expectedMoves[0]}`);
          } else if (newMistakeCount === 2 && expectedMoves.length > 0) {
            const san = expectedMoves[0];
            const pieceNames: Record<string, string> = {
              N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king',
            };
            const piece = san[0] === 'O' ? 'king (castling)' : (pieceNames[san[0]] ?? 'pawn');
            setReviewHint(`Hint: move a ${piece}`);
          } else {
            setReviewHint(null); // no hint on first mistake
          }

          return false;
        }
      } catch {
        return false;
      }
    },
    [reviewStatus, reviewFen, duePositions, currentIndex, reviewMistakeCount, submitGrade],
  );

  const giveUpReview = useCallback(() => {
    if (!reviewFen) return;
    const position = duePositions[currentIndex];
    if (!position) return;

    const expectedMoves = position.expected_moves || [];
    if (expectedMoves.length > 0) {
      const correctSan = expectedMoves[0];
      setReviewHint(`Answer: ${correctSan}`);

      // Play the correct move on the board and show an arrow
      try {
        const chess = new Chess(reviewFen);
        const m = chess.move(correctSan);
        if (m) {
          setReviewFen(chess.fen());
          setReviewArrows([[m.from, m.to, 'rgba(245, 158, 11, 0.75)']]);
        }
      } catch { /* ignore */ }
    }

    submitGrade(position, false, reviewMistakeCount, true);
    setReviewStatus('given_up');
  }, [reviewFen, duePositions, currentIndex, reviewMistakeCount, submitGrade]);

  const advanceToNext = useCallback(() => {
    setCurrentIndex((i) => i + 1);
  }, []);

  const reDrillAll = useCallback(() => {
    // Reset per-position state immediately so there's no stale-status frame
    setReviewStatus('awaiting_move');
    setReviewMistakeCount(0);
    setReviewHint(null);
    setReviewArrows([]);
    setCurrentIndex(0);
  }, []);

  const doneToday = !isLoading && !isError && currentIndex >= duePositions.length;
  const currentPosition = duePositions[currentIndex] ?? null;

  return {
    duePositions,
    currentIndex,
    reviewFen,
    reviewStatus,
    reviewMistakeCount,
    reviewHint,
    reviewArrows,
    isLoading,
    isError,
    doneToday,
    currentPosition,
    onReviewDrop,
    giveUpReview,
    advanceToNext,
    reDrillAll,
    refetch: loadDuePositions,
  };
}
