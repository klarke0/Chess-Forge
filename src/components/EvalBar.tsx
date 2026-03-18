import React from 'react';
import { useEngineStore } from '../stores/engineStore';

export const EvalBar: React.FC = () => {
  const { evaluation, topLines } = useEngineStore();
  
  // Use evaluation state if available, otherwise fallback to topLines[0]
  const bestLine = topLines[0];
  const evalData = (evaluation.cp !== null || evaluation.mate !== null) 
    ? evaluation 
    : bestLine;

  const getHeight = () => {
    if (!evalData) return 50;
    if (evalData.mate) {
      // If it's mate for the active side, bar is full (100%), if for opponent, empty (0%)
      // Stockfish returns positive mate for the side to move
      return evalData.mate > 0 ? 100 : 0;
    }
    if (evalData.cp === null || evalData.cp === undefined) return 50;
    
    // Normalize CP (-500 to +500 range for the bar)
    const clamped = Math.max(-500, Math.min(500, evalData.cp));
    return 50 + clamped / 10;
  };

  const evalText = evalData?.mate
    ? `M${evalData.mate}`
    : evalData?.cp !== null && evalData?.cp !== undefined
      ? (evalData.cp / 100).toFixed(1)
      : '0.0';

  return (
    <div className="w-full h-full bg-black/40 rounded-full overflow-hidden border border-white/5 flex flex-col justify-end relative shadow-2xl">
      <div
        className="w-full bg-slate-100 transition-all duration-1000 ease-out shadow-[0_0_20px_rgba(255,255,255,0.2)]"
        style={{ height: `${getHeight()}%` }}
      />
      <div className="absolute top-4 left-0 w-full text-[10px] font-black text-slate-400 text-center uppercase tracking-tighter">
        {evalText}
      </div>
    </div>
  );
};
