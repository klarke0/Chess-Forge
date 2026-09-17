import { useCallback, useRef, useState } from "react";
import { Chess, Square } from "chess.js";

type Arrow = [Square, Square, string?];

export function useCoachBoard() {
  const [coachArrows, setCoachArrows] = useState<Arrow[]>([]);
  const [coachSquareStyles, setCoachSquareStyles] = useState<
    Record<string, React.CSSProperties>
  >({});
  const [coachFen, setCoachFen] = useState<string | null>(null);
  const [isCoachAnimating, setIsCoachAnimating] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const replayRef = useRef<(() => void) | null>(null);
  // Logical position of the beat walkthrough. beatPlayMove animates the board
  // on a delay, so reading coachFen back would give a stale base when several
  // beats are replayed in one tick (step-jump catch-up). This ref advances
  // synchronously so those calls chain correctly.
  const beatFenRef = useRef<string | null>(null);

  function cancelTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function schedule(fn: () => void, ms: number) {
    timers.current.push(setTimeout(fn, ms));
  }

  function sanToSquares(
    fen: string,
    san: string,
  ): { from: Square; to: Square } | null {
    try {
      const chess = new Chess(fen);
      const move = chess.move(san);
      return move ? { from: move.from, to: move.to } : null;
    } catch {
      return null;
    }
  }

  const clearCoach = useCallback(() => {
    cancelTimers();
    setCoachFen(null);
    setCoachArrows([]);
    setCoachSquareStyles({});
    setIsCoachAnimating(false);
    replayRef.current = null;
    beatFenRef.current = null;
  }, []);

  const triggerReveal = useCallback(
    (fen: string, wrongSan: string | null, correctSan: string) => {
      cancelTimers();
      setIsCoachAnimating(true);

      // Pre-compute post-move FENs so pieces can actually animate to destination squares
      let wrongFen: string | null = null;
      let correctFen: string | null = null;
      if (wrongSan) {
        try {
          const c = new Chess(fen);
          c.move(wrongSan);
          wrongFen = c.fen();
        } catch { /* invalid move — skip */ }
      }
      try {
        const c = new Chess(fen);
        c.move(correctSan);
        correctFen = c.fen();
      } catch { /* invalid move — skip */ }

      const wrong = wrongSan ? sanToSquares(fen, wrongSan) : null;
      const correct = sanToSquares(fen, correctSan);

      if (wrongSan && wrong) {
        // Phase 1: Reset to start, show red arrow pointing to destination
        setCoachFen(fen);
        setCoachArrows([[wrong.from, wrong.to, "rgba(239,68,68,0.75)"]]);
        setCoachSquareStyles({
          [wrong.to]: { backgroundColor: "rgba(239,68,68,0.2)" },
        });

        // Phase 2: Piece slides to wrong square
        schedule(() => {
          if (wrongFen) setCoachFen(wrongFen);
        }, 600);

        // Phase 3: Slide back, show emerald arrow for correct move
        schedule(() => {
          setCoachFen(fen);
          setCoachArrows(
            correct
              ? [[correct.from, correct.to, "rgba(16,185,129,0.85)"]]
              : [],
          );
          setCoachSquareStyles(
            correct
              ? {
                  [correct.from]: { backgroundColor: "rgba(16,185,129,0.15)" },
                  [correct.to]: { backgroundColor: "rgba(16,185,129,0.25)" },
                }
              : {},
          );
        }, 1800);

        // Phase 4: Piece slides to correct square
        schedule(() => {
          if (correctFen) setCoachFen(correctFen);
        }, 2400);

        // Done — hold correct position
        schedule(() => setIsCoachAnimating(false), 3200);
      } else {
        // No wrong move — just show correct
        setCoachFen(fen);
        setCoachArrows(
          correct ? [[correct.from, correct.to, "rgba(16,185,129,0.85)"]] : [],
        );
        setCoachSquareStyles(
          correct
            ? {
                [correct.from]: { backgroundColor: "rgba(16,185,129,0.15)" },
                [correct.to]: { backgroundColor: "rgba(16,185,129,0.25)" },
              }
            : {},
        );
        schedule(() => {
          if (correctFen) setCoachFen(correctFen);
        }, 700);
        schedule(() => setIsCoachAnimating(false), 1600);
      }

      replayRef.current = () => triggerReveal(fen, wrongSan, correctSan);
    },
    [],
  );

  const triggerCoachLine = useCallback((startFen: string, moves: string[]) => {
    cancelTimers();
    setIsCoachAnimating(true);
    setCoachSquareStyles({});

    // Pre-compute the FEN sequence so closures don't fight over mutable state
    const fenSequence: string[] = [startFen];
    const chess = new Chess(startFen);
    for (const san of moves) {
      try {
        chess.move(san);
        fenSequence.push(chess.fen());
      } catch {
        break;
      }
    }

    moves.forEach((san, i) => {
      schedule(() => {
        const stepFen = fenSequence[i];
        const sq = sanToSquares(stepFen, san);
        if (sq) {
          setCoachArrows([[sq.from, sq.to, "rgba(139,92,246,0.75)"]]);
          setCoachFen(fenSequence[i + 1] ?? stepFen);
        }
      }, i * 700);
    });

    // After last move: pause then reset
    schedule(
      () => {
        setCoachFen(null);
        setCoachArrows([]);
        setCoachSquareStyles({});
        setIsCoachAnimating(false);
      },
      moves.length * 700 + 1000,
    );

    replayRef.current = () => triggerCoachLine(startFen, moves);
  }, []);

  const replayCoach = useCallback(() => {
    replayRef.current?.();
  }, []);

  // ──────────────────────────────────────────────────────────────────────
  // Beat-driven primitives — used by InteractiveCoach to dispatch each
  // walkthrough step. Cumulative: beatPlayMove mutates from the current
  // coachFen; beatReset returns to the original blunder FEN passed in.
  // These intentionally bypass the wrong/correct two-phase animation
  // owned by triggerReveal — they're the building blocks for the
  // structured walkthrough.
  // ──────────────────────────────────────────────────────────────────────

  const HIGHLIGHT_COLORS = {
    red: "rgba(239,68,68,0.35)",
    green: "rgba(16,185,129,0.35)",
    amber: "rgba(245,158,11,0.35)",
    blue: "rgba(99,102,241,0.35)",
  } as const;

  const ARROW_COLORS = {
    red: "rgba(239,68,68,0.85)",
    green: "rgba(16,185,129,0.85)",
    amber: "rgba(245,158,11,0.85)",
    blue: "rgba(99,102,241,0.85)",
  } as const;

  const beatReset = useCallback((toFen: string) => {
    cancelTimers();
    setIsCoachAnimating(true);
    beatFenRef.current = toFen;
    setCoachFen(toFen);
    setCoachArrows([]);
    setCoachSquareStyles({});
  }, []);

  const beatPlayMove = useCallback(
    (
      fallbackFen: string,
      san: string,
      highlight?: "red" | "green" | "amber",
    ) => {
      // Use the walkthrough's logical FEN if present, else the position FEN
      // passed by the parent. This makes beats cumulative across a segment.
      const baseFen = beatFenRef.current ?? fallbackFen;
      try {
        const c = new Chess(baseFen);
        const move = c.move(san);
        if (!move) return; // illegal — leave board untouched
        beatFenRef.current = c.fen();
        const colorKey = highlight ?? "amber";
        const arrowColor = ARROW_COLORS[colorKey];
        const sqColor = HIGHLIGHT_COLORS[colorKey];
        // Set the arrow + highlight FIRST so the user sees intent, then
        // animate the piece to its destination on the next paint.
        setCoachArrows([[move.from, move.to, arrowColor]]);
        setCoachSquareStyles({
          [move.from]: { backgroundColor: sqColor },
          [move.to]: { backgroundColor: sqColor },
        });
        // Animate the piece move ~250ms after the arrow appears so the
        // student's eye has time to track from origin → destination.
        schedule(() => {
          setCoachFen(c.fen());
        }, 250);
        setIsCoachAnimating(true);
        // Hold the arrow/highlight for the auto-advance window then settle
        schedule(() => {
          setIsCoachAnimating(false);
        }, 1100);
      } catch {
        /* illegal SAN for this position — leave the board untouched */
      }
    },
    [],
  );

  const beatHighlight = useCallback(
    (
      squares: string[],
      color: "red" | "green" | "amber" | "blue" = "blue",
    ) => {
      const sqColor = HIGHLIGHT_COLORS[color];
      const styles: Record<string, React.CSSProperties> = {};
      for (const sq of squares) styles[sq] = { backgroundColor: sqColor };
      setCoachSquareStyles(styles);
      setCoachArrows([]);
      setIsCoachAnimating(false);
    },
    [],
  );

  const beatArrow = useCallback(
    (
      from: string,
      to: string,
      color: "red" | "green" | "amber" | "blue" = "blue",
    ) => {
      setCoachArrows([[from as Square, to as Square, ARROW_COLORS[color]]]);
      setCoachSquareStyles({});
      setIsCoachAnimating(false);
    },
    [],
  );

  return {
    coachArrows,
    coachSquareStyles,
    coachFen,
    isCoachAnimating,
    triggerReveal,
    triggerCoachLine,
    clearCoach,
    replayCoach,
    beatReset,
    beatPlayMove,
    beatHighlight,
    beatArrow,
  };
}
