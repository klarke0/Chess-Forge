import React, { useState, useMemo, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import { ChevronRight, Eye, Layers, RotateCw } from 'lucide-react';
import { useTrainingStore } from '../stores/trainingStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useSettingsStore } from '../stores/settingsStore';
import { EvalBar } from './EvalBar';
import { EngineLines } from './EngineLines';
import { VisionOverlay } from './VisionOverlay';
import { calculateControl } from '../utils/chessLogic';
import { cn } from '../utils/cn';

const BOARD_COLORS = {
  slate:  { dark: '#1e293b', light: '#475569' },
  green:  { dark: '#769656', light: '#eeeed2' },
  blue:   { dark: '#4f7eba', light: '#dce7f5' },
  walnut: { dark: '#a07753', light: '#e0c494' },
} as const;

interface ChessBoardPanelProps {
  fen: string;
  onDrop: (source: string, target: string) => boolean;
  onProceed: () => void;
}

export const ChessBoardPanel: React.FC<ChessBoardPanelProps> = ({
  fen,
  onDrop,
  onProceed,
}) => {
  const awaitingNext = useTrainingStore(s => s.awaitingNext);
  const status = useTrainingStore(s => s.status);
  const arrows = useTrainingStore(s => s.arrows);
  const repertoireSide = useRepertoireStore(s => s.repertoireSide);
  const { training, toggleTrainingVision, board } = useSettingsStore();
  const showVision = training.showVision;
  const autoProceed = useSettingsStore(s => s.training.autoProceed);
  const colors = BOARD_COLORS[board.colorScheme];

  const [orientation, setOrientation] = useState<'white' | 'black'>('white');

  useEffect(() => {
    if (!awaitingNext || !autoProceed) return;
    const t = setTimeout(() => onProceed(), 500);
    return () => clearTimeout(t);
  }, [awaitingNext, autoProceed, onProceed]);

  // Sync orientation with repertoire side when it changes
  useEffect(() => {
    setOrientation(repertoireSide);
  }, [repertoireSide]);

  const controlMap = useMemo(() => {
    if (!showVision) return {} as ReturnType<typeof calculateControl>;
    return calculateControl(fen);
  }, [fen, showVision]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center">
      {/* 
        This container uses a vmin-based size to guarantee a square that fits the screen.
        85vmin means 85% of the smaller screen dimension (width or height).
        This works perfectly for both portrait and landscape.
      */}
      <div className="flex gap-4 lg:gap-8 items-center justify-center relative w-[85vmin] h-[85vmin] max-w-[800px] max-h-[800px]">
        
        {/* Eval Bar: Absolute positioned to not mess with the board's flow */}
        <div className="absolute -left-6 lg:-left-10 top-0 bottom-0 w-3 lg:w-4 hidden md:block">
           <EvalBar />
        </div>
        
        {/* Mobile Eval Bar (Top) */}
        <div className="absolute -top-6 left-0 right-0 h-3 md:hidden">
           <EvalBar />
        </div>
        
        {/* Board Container */}
        <div className="w-full h-full shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] rounded-xl lg:rounded-[2rem] overflow-hidden border-[8px] lg:border-[12px] border-[#161b22] relative group box-border bg-[#161b22]">
            <Chessboard
              position={fen}
              onPieceDrop={onDrop}
              boardOrientation={orientation}
              customArrows={arrows}
              customDarkSquareStyle={{ backgroundColor: colors.dark }}
              customLightSquareStyle={{ backgroundColor: colors.light }}
              showBoardNotation={board.showCoordinates}
              animationDuration={board.animatePieces ? 150 : 0}
            />

            {showVision && <VisionOverlay control={controlMap} orientation={orientation} />}
            <EngineLines fen={fen} />

            {/* Controls Overlay (Top Right) */}
            <div className="absolute top-4 right-4 z-30 flex flex-col gap-2">
              <button 
                onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
                className="p-2 rounded-xl shadow-xl border bg-[#1a1f26] text-slate-400 border-white/10 hover:text-white transition-all"
                title="Flip Board"
              >
                <RotateCw size={16} />
              </button>
              <button 
                onClick={toggleTrainingVision}
                className={cn(
                  "p-2 rounded-xl shadow-xl border transition-all",
                  showVision ? "bg-emerald-600 text-white border-emerald-500" : "bg-[#1a1f26] text-slate-400 border-white/10 hover:text-white"
                )}
                title="Toggle Vision"
              >
                <Layers size={16} />
              </button>
            </div>

            {awaitingNext && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-20 flex items-center justify-center animate-in fade-in duration-300">
                <button
                  onClick={onProceed}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-[0.2em] shadow-2xl shadow-indigo-600/50 flex items-center gap-3 active:scale-95 transition-all border border-indigo-400/20"
                >
                  Proceed <ChevronRight size={20} />
                </button>
              </div>
            )}

            {status === 'demo' && (
              <div className="absolute top-4 left-4 z-30 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-xl flex items-center gap-2 animate-pulse border border-indigo-400/30">
                <Eye size={12} /> Coach Demo
              </div>
            )}
        </div>
      </div>
    </div>
  );
};
