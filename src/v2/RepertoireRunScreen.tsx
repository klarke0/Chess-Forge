import React, { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { ArrowLeft, Check, X, RotateCcw } from "lucide-react";
import { cn } from "@/utils/cn";
import { useRepertoireStore } from "@/stores/repertoireStore";
import { normalizeFen } from "@/utils/normalizeFen";
import { useSound } from "@/hooks/useSound";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface RunStats {
  moves: number;
  correct: number;
  wrong: number;
}

type RunState = "playing" | "opponent" | "complete";

interface RepertoireRunScreenProps {
  onBack: () => void;
}

function looseSan(san: string) {
  return san.replace(/[+#x]/g, "").trim();
}

export const RepertoireRunScreen: React.FC<RepertoireRunScreenProps> = ({ onBack }) => {
  const positions = useRepertoireStore((s) => s.positions);
  const repertoireSide = useRepertoireStore((s) => s.repertoireSide);
  const repertoireName = useRepertoireStore((s) => s.repertoireName);
  const { playSound } = useSound();

  const [fen, setFen] = useState(STARTING_FEN);
  const [state, setState] = useState<RunState>("playing");
  const [shaking, setShaking] = useState(false);
  const [wrongMove, setWrongMove] = useState<string | null>(null);
  const [revealMode, setRevealMode] = useState(false);
  const [stats, setStats] = useState<RunStats>({ moves: 0, correct: 0, wrong: 0 });
  const [moveHistory, setMoveHistory] = useState<string[]>([]);

  const chessRef = useRef(new Chess());

  // Side to move derived from FEN
  const sideToMove = fen.split(" ")[1] === "w" ? "white" : "black";
  const isKevinsTurn = sideToMove === repertoireSide;

  const boardOrientation = repertoireSide;

  // On mount and whenever fen changes: if it's opponent's turn, auto-advance
  useEffect(() => {
    if (state !== "playing") return;
    if (!isKevinsTurn) {
      autoPlayOpponent();
    }
  }, [fen, state]); // eslint-disable-line react-hooks/exhaustive-deps

  function autoPlayOpponent() {
    const nfen = normalizeFen(fen);
    const available = positions[nfen];
    if (!available || available.length === 0) {
      // Leaf node on opponent's side — no more moves
      setState("complete");
      return;
    }
    setState("opponent");
    // Pick first available opponent response
    const pick = available[0];
    setTimeout(() => {
      try {
        const chess = new Chess(fen);
        const m = chess.move(pick.san);
        if (m) {
          if (m.flags.includes("c")) playSound("capture");
          else playSound("move");
          const newFen = chess.fen();
          chessRef.current = chess;
          setFen(newFen);
          setMoveHistory((h) => [...h, pick.san]);
          // Check if Kevin has any moves to play next
          const nextNfen = normalizeFen(newFen);
          const nextMoves = positions[nextNfen];
          if (!nextMoves || nextMoves.length === 0) {
            setState("complete");
          } else {
            setState("playing");
          }
        }
      } catch {
        setState("complete");
      }
    }, 600);
  }

  const onDrop = useCallback(
    (source: string, target: string) => {
      if (state !== "playing" || !isKevinsTurn) return false;

      const nfen = normalizeFen(fen);
      const available = positions[nfen];
      if (!available || available.length === 0) {
        setState("complete");
        return false;
      }

      // Try the move in chess.js
      const chess = new Chess(fen);
      let move;
      try {
        move = chess.move({ from: source, to: target, promotion: "q" });
      } catch {
        return false;
      }
      if (!move) return false;

      // Check if this matches any repertoire move
      const correct = available.find((m) => {
        try {
          const ref = new Chess(fen);
          const refMove = ref.move(m.san);
          return refMove && move.from === refMove.from && move.to === refMove.to;
        } catch {
          return looseSan(move.san) === looseSan(m.san);
        }
      });

      if (correct) {
        if (move.flags.includes("c")) playSound("capture");
        else if (chess.inCheck()) playSound("check");
        else playSound("move");

        chessRef.current = chess;
        setFen(chess.fen());
        setWrongMove(null);
        setRevealMode(false);
        setMoveHistory((h) => [...h, move.san]);
        setStats((s) => ({ ...s, moves: s.moves + 1, correct: s.correct + 1 }));
        return true;
      }

      // Wrong move
      playSound("wrong");
      setWrongMove(move.san);
      setStats((s) => ({ ...s, moves: s.moves + 1, wrong: s.wrong + 1 }));
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      return false;
    },
    [state, isKevinsTurn, fen, positions, playSound],
  );

  function handleReveal() {
    setRevealMode(true);
    const nfen = normalizeFen(fen);
    const available = positions[nfen];
    if (!available || available.length === 0) return;
    // Show correct move and auto-advance after delay
    const correct = available[0];
    setTimeout(() => {
      try {
        const chess = new Chess(fen);
        chess.move(correct.san);
        chessRef.current = chess;
        setFen(chess.fen());
        setWrongMove(null);
        setRevealMode(false);
        setMoveHistory((h) => [...h, correct.san]);
      } catch {
        setState("complete");
      }
    }, 1200);
  }

  function handleRestart() {
    chessRef.current = new Chess();
    setFen(STARTING_FEN);
    setState("playing");
    setWrongMove(null);
    setRevealMode(false);
    setStats({ moves: 0, correct: 0, wrong: 0 });
    setMoveHistory([]);
  }

  const acc = stats.moves > 0 ? Math.round((stats.correct / stats.moves) * 100) : 100;
  const depth = moveHistory.length;

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-base)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#0a0d14] border-b border-white/5 shrink-0">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-xl text-slate-400 hover:text-white transition-all active:scale-95"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-black text-slate-200 uppercase tracking-wider">
            {repertoireName}
          </h2>
          <p className="text-[10px] text-slate-500 font-semibold">Move {depth}</p>
        </div>
        {stats.moves > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-emerald-400 font-black">{stats.correct}</span>
            <span className="text-slate-600">/</span>
            <span className="text-slate-400 font-semibold">{stats.moves}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {state === "complete" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 pt-8 pb-24">
            <div className="flex flex-col items-center gap-3">
              <div className="w-20 h-20 rounded-[2rem] border-2 flex items-center justify-center bg-emerald-400/10 border-emerald-400/30">
                <Check size={36} className="text-emerald-400" />
              </div>
              <p className="text-sm font-black uppercase tracking-wider text-emerald-400">
                Line complete
              </p>
              <div className="text-xs text-slate-500">
                {depth} moves · {acc}% accuracy
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center w-full">
              <div className="bg-forge-card border border-forge-border-subtle rounded-2xl py-4">
                <p className="text-2xl font-black text-slate-200">{depth}</p>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">moves</p>
              </div>
              <div className="bg-forge-card border border-forge-border-subtle rounded-2xl py-4">
                <p className="text-2xl font-black text-emerald-400">{stats.correct}</p>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">correct</p>
              </div>
              <div className="bg-forge-card border border-forge-border-subtle rounded-2xl py-4">
                <p className="text-2xl font-black text-rose-400">{stats.wrong}</p>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">missed</p>
              </div>
            </div>

            <button
              onClick={handleRestart}
              className={cn(
                "w-full max-w-xs flex items-center justify-center gap-2 py-4 rounded-2xl",
                "bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98]",
                "text-white font-black text-base uppercase tracking-widest",
                "shadow-xl shadow-indigo-600/30 border border-indigo-400/20 transition-all",
              )}
            >
              <RotateCcw size={16} />
              Run Again
            </button>
          </div>
        ) : (
          <>
            {/* Board */}
            <div
              className={cn(
                "flex-1 flex items-center justify-center p-4 relative",
                shaking && "animate-shake",
              )}
            >
              <div className="w-full aspect-square rounded-xl overflow-hidden border-[6px] border-[#161b22] bg-[#161b22] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)]">
                <Chessboard
                  position={fen}
                  onPieceDrop={state === "playing" && isKevinsTurn ? onDrop : () => false}
                  boardOrientation={boardOrientation}
                  animationDuration={state === "opponent" ? 500 : 150}
                  arePiecesDraggable={state === "playing" && isKevinsTurn}
                  customDarkSquareStyle={{ backgroundColor: "#1e293b" }}
                  customLightSquareStyle={{ backgroundColor: "#475569" }}
                />
              </div>
            </div>

            {/* Status bar */}
            <div className="flex items-center justify-between px-6 py-3 bg-[#0a0d14] border-t border-white/5 shrink-0">
              {state === "opponent" ? (
                <p className="text-xs text-slate-500 italic">Opponent thinking...</p>
              ) : isKevinsTurn ? (
                wrongMove ? (
                  <div className="flex items-center gap-2 text-sm">
                    <X size={14} className="text-rose-400" />
                    <span className="text-rose-400 font-semibold">Not in repertoire</span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    {repertoireSide === "white" ? "Play White's move" : "Play Black's move"}
                  </p>
                )
              ) : (
                <p className="text-xs text-slate-500">Waiting...</p>
              )}
              {wrongMove && !revealMode && isKevinsTurn && (
                <button
                  onClick={handleReveal}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-all ml-auto"
                >
                  Show correct
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
