import React, { useRef, useEffect } from 'react';
import { History } from 'lucide-react';
import { cn } from '../utils/cn';

interface MoveRecord {
  san: string;
  eval?: string;
  comment?: string;
}

interface MoveLedgerProps {
  ledger: {white: MoveRecord, black?: MoveRecord}[];
  activeMoveIdx?: number;
  onMoveClick?: (flatIdx: number) => void;
}

export const MoveLedger: React.FC<MoveLedgerProps> = ({ ledger, activeMoveIdx, onMoveClick }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [ledger]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0d1117] border-t border-b border-white/5">
      {/* Compact Header */}
      <div className="px-4 py-2 border-b border-white/5 bg-[#080a0f] flex items-center justify-between shrink-0">
         <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
           <History size={12} /> Moves
         </h3>
         <span className="text-[10px] font-mono text-slate-600">{ledger.length} plies</span>
      </div>

      {/* Tabular List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-0" ref={scrollRef}>
         <table className="w-full text-left border-collapse">
            <tbody className="divide-y divide-white/[0.02]">
              {ledger.map((round, i) => {
                const whiteFlatIdx = 2 * i;
                const blackFlatIdx = 2 * i + 1;
                const whiteActive = activeMoveIdx === whiteFlatIdx;
                const blackActive = activeMoveIdx === blackFlatIdx;

                return (
                  <React.Fragment key={i}>
                    <tr className={cn(i % 2 === 0 ? "bg-transparent" : "bg-white/[0.01]")}>
                       {/* Move Number */}
                       <td className="py-2 px-3 w-8 text-[10px] font-mono text-slate-600 font-bold border-r border-white/5 bg-[#0a0d14]/50">
                         {i + 1}.
                       </td>

                       {/* White Move */}
                       <td className={cn("py-2 px-3 w-[45%]", whiteActive && "bg-indigo-500/10")}>
                          <div className="flex justify-between items-baseline">
                            <span
                              onClick={() => onMoveClick?.(whiteFlatIdx)}
                              className={cn(
                                "text-xs font-bold transition-colors",
                                onMoveClick && "cursor-pointer hover:text-indigo-400",
                                whiteActive ? "text-indigo-300" : "text-slate-200"
                              )}
                            >
                              {round.white.san}
                            </span>
                            {round.white.eval && (
                              <span className="text-[9px] font-mono text-slate-600">{round.white.eval}</span>
                            )}
                          </div>
                       </td>

                       {/* Black Move */}
                       <td className={cn("py-2 px-3 w-[45%] border-l border-white/5", blackActive && "bg-indigo-500/10")}>
                         {round.black ? (
                            <div className="flex justify-between items-baseline">
                              <span
                                onClick={() => onMoveClick?.(blackFlatIdx)}
                                className={cn(
                                  "text-xs font-bold transition-colors",
                                  onMoveClick && "cursor-pointer hover:text-indigo-400",
                                  blackActive ? "text-indigo-300" : "text-indigo-300/70"
                                )}
                              >
                                {round.black.san}
                              </span>
                              {round.black.eval && (
                                <span className="text-[9px] font-mono text-indigo-500/50">{round.black.eval}</span>
                              )}
                            </div>
                         ) : (
                            <span className="text-slate-700">...</span>
                         )}
                       </td>
                    </tr>
                    
                    {/* Inline Comment for White Move */}
                    {round.white.comment && whiteActive && (
                      <tr className="bg-indigo-500/5">
                        <td className="border-r border-white/5 bg-[#0a0d14]/50"></td>
                        <td colSpan={2} className="py-2 px-4 text-[10px] text-indigo-300/80 leading-relaxed italic font-medium">
                          {round.white.comment}
                        </td>
                      </tr>
                    )}

                    {/* Inline Comment for Black Move */}
                    {round.black?.comment && blackActive && (
                      <tr className="bg-indigo-500/5">
                        <td className="border-r border-white/5 bg-[#0a0d14]/50"></td>
                        <td colSpan={2} className="py-2 px-4 text-[10px] text-indigo-300/80 leading-relaxed italic font-medium">
                          {round.black.comment}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
         </table>
         {ledger.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-700 py-8">
               <span className="text-[10px] uppercase tracking-widest">No moves yet</span>
            </div>
         )}
      </div>
    </div>
  );
};
