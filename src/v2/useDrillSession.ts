import { useReducer } from "react";

export type SessionState =
  | "idle"
  | "loading"
  | "queued"
  | "drilling"
  | "explanation"
  | "teaching"
  | "complete";

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

export interface TrainPosition {
  id: string;
  fen: string;
  correctSan: string;
  san?: string;
  context?: string;
  cpLoss?: number;
  phase?: string;
  source?: "blunder" | "deviation" | "review" | "repertoire";
  firstEncounter?: boolean;
  /** Heuristic tactical theme label assigned at session-build time. */
  pattern?: TacticalPattern;
}

export interface SessionStats {
  total: number;
  correct: number;
  revealed: number;
}

/**
 * Atomic state for the drill session machine. All eleven fields transition
 * together through `reducer` — no setState chains, no Strict-Mode hazards.
 */
export interface DrillState {
  state: SessionState;
  positions: TrainPosition[];
  currentIdx: number;
  fen: string;
  mistakes: number;
  wrongMove: string | null;
  revealed: boolean;
  shaking: boolean;
  stats: SessionStats;
  revealedPositions: TrainPosition[];
  teachingCount: number;
}

const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const INITIAL_STATE: DrillState = {
  state: "idle",
  positions: [],
  currentIdx: 0,
  fen: INITIAL_FEN,
  mistakes: 0,
  wrongMove: null,
  revealed: false,
  shaking: false,
  stats: { total: 0, correct: 0, revealed: 0 },
  revealedPositions: [],
  teachingCount: 0,
};

/**
 * Side-effect-free transitions for the drill state machine. Network calls,
 * sounds, and coach animations are coordinated by the caller; this reducer
 * only updates state. Each case fully resets the position-scoped fields when
 * advancing so a stale `wrongMove` or `revealed` flag can never leak into a
 * fresh position.
 */
export type DrillAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; positions: TrainPosition[] }
  | { type: "LOAD_EMPTY" }
  | { type: "LOAD_SINGLE"; pos: TrainPosition }
  /** Enter drilling at idx; resets position-scoped fields atomically. */
  | { type: "ENTER_DRILLING"; idx: number; pos: TrainPosition }
  /** Enter teaching at idx; same reset, plus increments teachingCount. */
  | { type: "ENTER_TEACHING"; idx: number; pos: TrainPosition }
  /** Teaching → drilling on the same position (e.g. "Got it" tap). */
  | { type: "TEACHING_GOT_IT"; pos: TrainPosition }
  /** Reset board to position FEN without changing screen state (Replay). */
  | { type: "RESET_POSITION"; pos: TrainPosition }
  /** Correct move accepted; transitions to explanation. */
  | { type: "CORRECT_MOVE"; newFen: string; firstTry: boolean }
  /** Wrong move on first miss (still in drilling). */
  | { type: "WRONG_MOVE"; san: string }
  /** Wrong move on second miss → auto-reveal triggered. */
  | { type: "WRONG_MOVE_REVEAL"; san: string; pos: TrainPosition }
  /** Stop the shake animation (called from setTimeout). */
  | { type: "SHAKING_OFF" }
  /** User tapped Reveal manually; transitions handled separately. */
  | { type: "MANUAL_REVEAL"; pos: TrainPosition }
  /** Side-effect-driven transition into the explanation card. */
  | { type: "ENTER_EXPLANATION" }
  | { type: "COMPLETE" };

function reducer(s: DrillState, a: DrillAction): DrillState {
  switch (a.type) {
    case "LOAD_START":
      return {
        ...s,
        state: "loading",
        currentIdx: 0,
        positions: [],
        teachingCount: 0,
      };
    case "LOAD_SUCCESS":
      return {
        ...s,
        state: "queued",
        positions: a.positions,
        stats: { total: a.positions.length, correct: 0, revealed: 0 },
      };
    case "LOAD_EMPTY":
      return {
        ...s,
        state: "complete",
        stats: { total: 0, correct: 0, revealed: 0 },
      };
    case "LOAD_SINGLE":
      return {
        ...s,
        state: "queued",
        positions: [a.pos],
        stats: { total: 1, correct: 0, revealed: 0 },
      };
    case "ENTER_DRILLING":
      return {
        ...s,
        state: "drilling",
        currentIdx: a.idx,
        fen: a.pos.fen,
        mistakes: 0,
        wrongMove: null,
        revealed: false,
        shaking: false,
      };
    case "ENTER_TEACHING":
      return {
        ...s,
        state: "teaching",
        currentIdx: a.idx,
        fen: a.pos.fen,
        mistakes: 0,
        wrongMove: null,
        revealed: false,
        shaking: false,
        teachingCount: s.teachingCount + 1,
      };
    case "TEACHING_GOT_IT":
      return {
        ...s,
        state: "drilling",
        fen: a.pos.fen,
        mistakes: 0,
        wrongMove: null,
        revealed: false,
        shaking: false,
      };
    case "RESET_POSITION":
      return {
        ...s,
        fen: a.pos.fen,
        mistakes: 0,
        wrongMove: null,
        revealed: false,
        shaking: false,
      };
    case "CORRECT_MOVE":
      return {
        ...s,
        state: "explanation",
        fen: a.newFen,
        wrongMove: a.firstTry ? null : s.wrongMove,
        stats: a.firstTry
          ? { ...s.stats, correct: s.stats.correct + 1 }
          : s.stats,
      };
    case "WRONG_MOVE":
      return {
        ...s,
        wrongMove: a.san,
        mistakes: s.mistakes + 1,
        shaking: true,
      };
    case "WRONG_MOVE_REVEAL":
      return {
        ...s,
        wrongMove: a.san,
        mistakes: s.mistakes + 1,
        shaking: true,
        revealed: true,
        revealedPositions: [...s.revealedPositions, a.pos],
        stats: { ...s.stats, revealed: s.stats.revealed + 1 },
      };
    case "SHAKING_OFF":
      return { ...s, shaking: false };
    case "MANUAL_REVEAL":
      return {
        ...s,
        revealed: true,
        revealedPositions: [...s.revealedPositions, a.pos],
        stats: { ...s.stats, revealed: s.stats.revealed + 1 },
      };
    case "ENTER_EXPLANATION":
      return { ...s, state: "explanation" };
    case "COMPLETE":
      return { ...s, state: "complete" };
    default:
      return s;
  }
}

/**
 * Hook that owns the drill session state machine. Returns the current state
 * and a `dispatch` so the caller can drive transitions atomically. Side
 * effects (API calls, sounds, coach animations, timers) live in the caller —
 * this hook is intentionally pure so the machine stays auditable.
 */
export function useDrillSession() {
  return useReducer(reducer, INITIAL_STATE);
}
