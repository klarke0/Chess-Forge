import React from 'react';
import { Calendar, Sword, ChevronRight, Activity, ShieldCheck, Upload } from 'lucide-react';
import { cn } from '../utils/cn';

export interface PlatformGame {
  id: string;
  date: string;
  white: string;
  black: string;
  result: '1-0' | '0-1' | '1/2-1/2';
  accuracy?: number;
  timeControl: string;
}

interface GameHubProps {
  games: PlatformGame[];
  onSelectGame: (id: string) => void;
  onClose: () => void;
  username: string;
  onSyncLast?: () => void;
  onImportPgn?: () => void;
}

export const GameHub: React.FC<GameHubProps> = ({ games, onSelectGame, onClose, username, onSyncLast, onImportPgn }) => {
  return (
    <div className="absolute inset-0 z-40 p-12 bg-[#080a0f] overflow-y-auto animate-in fade-in zoom-in-95 duration-500">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-end mb-12 border-b border-white/10 pb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
               <ShieldCheck size={16} className="text-emerald-500" />
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Platform Sync</span>
            </div>
            <h2 className="text-5xl font-black text-white uppercase italic tracking-tighter">Live Game Archive</h2>
            <p className="text-slate-400 font-bold uppercase tracking-[0.3em] mt-2">Ready for Grandmaster Analysis</p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={onImportPgn}
              className="px-6 py-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-black uppercase tracking-widest text-xs rounded-xl border border-indigo-500/30 transition-all flex items-center gap-2"
            >
              <Upload size={14} /> Import PGN
            </button>
            <button
              onClick={onSyncLast}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-xl shadow-emerald-900/20 flex items-center gap-2"
            >
              <Activity size={14} /> Chess.com
            </button>
            <button onClick={onClose} className="px-6 py-3 bg-[#1a1f26] hover:bg-[#252b35] text-slate-200 font-black uppercase tracking-widest text-xs rounded-xl border border-white/10 transition-all shadow-xl">
              Back
            </button>
          </div>
        </div>

        {games.length === 0 ? (
          <div className="bg-[#11151c] border border-white/10 rounded-[3rem] p-20 text-center shadow-2xl">
            <Activity size={64} className="text-slate-700 mx-auto mb-6 opacity-30" />
            <h3 className="text-xl font-bold text-slate-500 uppercase tracking-widest">No Games Synced</h3>
            <p className="text-slate-600 text-sm mt-2 font-medium">Import a PGN file or sync from Chess.com above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {games.map((game) => (
              <div 
                key={game.id}
                onClick={() => onSelectGame(game.id)}
                className="bg-[#11151c] border border-white/10 p-8 rounded-[2.5rem] flex items-center gap-10 hover:border-indigo-500/40 transition-all cursor-pointer group shadow-xl relative overflow-hidden"
              >
                {/* Visual Accent */}
                <div className={cn(
                  "absolute left-0 top-0 bottom-0 w-1.5",
                  game.result === '1-0' ? "bg-emerald-500" : game.result === '0-1' ? "bg-rose-500" : "bg-slate-500"
                )} />

                <div className="flex flex-col items-center min-w-[100px] border-r border-white/5 pr-10">
                  <Calendar size={18} className="text-slate-600 mb-2" />
                  <span className="text-[10px] font-black text-slate-400 uppercase font-mono">{game.date}</span>
                  <span className="text-[8px] font-bold text-slate-600 uppercase mt-1">{game.timeControl}</span>
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-6 mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_white]" />
                      <span className={cn("text-lg font-bold", game.white === username ? "text-indigo-400" : "text-white")}>
                        {game.white}
                      </span>
                    </div>
                    <Sword size={14} className="text-slate-700" />
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-slate-800 border border-white/20" />
                      <span className={cn("text-lg font-bold", game.black === username ? "text-indigo-400" : "text-white")}>
                        {game.black}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-4 items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Result: {game.result}</span>
                    {game.accuracy && (
                      <span className="bg-indigo-500/10 text-indigo-400 text-[9px] font-black px-2 py-0.5 rounded border border-indigo-500/20">
                        {game.accuracy}% Accuracy
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-4">
                  <div className="bg-white/5 p-4 rounded-2xl group-hover:bg-indigo-600 transition-all shadow-inner">
                    <p className="text-[8px] font-black uppercase text-slate-500 group-hover:text-indigo-200 mb-1">Analyze</p>
                    <ChevronRight size={24} className="text-slate-400 group-hover:text-white" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
