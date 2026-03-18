import React from 'react';
import { Activity } from 'lucide-react';
import { useEngineStore } from '../stores/engineStore';
import { cn } from '../utils/cn';
import { formatPV } from '../utils/chessLogic';

interface EngineLinesProps {
  fen: string;
}

export const EngineLines: React.FC<EngineLinesProps> = ({ fen }) => {
  const { topLines, showLines } = useEngineStore();

  if (!showLines || topLines.length === 0) return null;

  return (
    <div className="absolute top-4 right-4 z-30 bg-[#0d1117]/90 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-2xl w-56 animate-in slide-in-from-right-4 duration-300">
      <h4 className="text-[8px] font-black uppercase tracking-[0.2em] text-emerald-500 mb-3 flex items-center gap-2">
        <Activity size={10} /> Top Engine Moves
      </h4>
      <div className="space-y-3">
        {topLines.slice(0, 3).map((line, idx) => (
          <div key={idx} className="flex justify-between items-center group gap-2">
            <span className="text-[10px] font-mono font-bold text-slate-300 group-hover:text-white transition-colors truncate">
              {formatPV(fen, line.pv, 2)}
            </span>
            <span
              className={cn(
                'text-[10px] font-black px-2 py-0.5 rounded-lg shrink-0',
                (line.cp || 0) >= 0
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-rose-500/10 text-rose-400'
              )}
            >
              {line.mate
                ? `M${line.mate}`
                : line.cp !== null
                  ? (line.cp / 100).toFixed(1)
                  : '0.0'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
