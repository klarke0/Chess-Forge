import React from 'react';
import { Brain, BarChart3, GitGraph, Cpu, Settings } from 'lucide-react';
import { useEngineStore } from '../stores/engineStore';
import { useRepertoireStore } from '../stores/repertoireStore';
import { useBackgroundStore } from '../stores/backgroundStore';
import { TabMode } from './Layout';
import { ForgeIcon } from './ForgeIcon';
import { cn } from '../utils/cn';

interface HeaderProps {
  onReset: () => void;
  activeTab: TabMode;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onReset, activeTab, onOpenSettings }) => {
  const { isAnalyzing, activeGameName, analyzedCount, totalInQueue } = useBackgroundStore();
  const { showLines, toggleLines } = useEngineStore();
  const { selectedChapter, chapters, showTree, toggleTree, showDashboard, toggleDashboard } = useRepertoireStore();

  const activeTitle =
    activeTab === 'train'   ? (selectedChapter !== null && chapters[selectedChapter] ? chapters[selectedChapter].name : 'Master Repertoire')
    : activeTab === 'games'   ? 'Game Analysis Hub'
    : activeTab === 'library' ? 'My Library'
    : activeTab === 'review'  ? 'Spaced Review'
    : 'Master Repertoire';

  return (
    <header className="border-b border-white/10 px-4 py-2.5 flex justify-between items-center bg-[#0d1117]/80 backdrop-blur-xl z-20 shrink-0">
      <div className="flex items-center gap-4">
        <div
          className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-600/20 cursor-pointer hover:scale-105 transition-transform"
          onClick={onReset}
        >
          <ForgeIcon size={18} />
        </div>
        <div>
          <h1 className="text-lg font-black tracking-tight text-white uppercase italic font-outfit flex items-center gap-3">
            CHESS <span className="text-orange-500">FORGE</span>
            {isAnalyzing && (
              <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-lg animate-in fade-in zoom-in-95 duration-300 group relative non-italic">
                <Cpu size={10} className="text-orange-400 animate-pulse" />
                <span className="text-[9px] font-mono text-orange-300">{analyzedCount}/{totalInQueue}</span>
                <div className="absolute top-full left-0 mt-2 w-48 bg-slate-900 border border-white/10 p-2 rounded-lg shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  <p className="text-[8px] font-black uppercase text-slate-500 mb-1">Background Scanning</p>
                  <p className="text-[10px] font-bold text-white truncate">{activeGameName}</p>
                </div>
              </div>
            )}
          </h1>
          <p className="text-[8px] text-slate-400 font-black uppercase tracking-[0.3em] flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-orange-500 animate-pulse" />
            {activeTitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {activeTab === 'train' && (
          <>
            <button
              onClick={toggleTree}
              className={cn(
                "p-2 rounded-xl border transition-all flex items-center gap-2 font-bold text-[9px] uppercase tracking-widest",
                showTree ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-400" : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
              )}
            >
              <GitGraph size={16} /> Tree
            </button>
            <button
              onClick={toggleDashboard}
              className={cn(
                "p-2 rounded-xl border transition-all flex items-center gap-2 font-bold text-[9px] uppercase tracking-widest",
                showDashboard ? "bg-amber-600/20 border-amber-500/50 text-amber-400" : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
              )}
            >
              <BarChart3 size={16} /> Stats
            </button>
            <div className="h-6 w-[1px] bg-white/10 mx-1" />
          </>
        )}
        <button
          onClick={toggleLines}
          className={cn(
            "p-2 rounded-xl border transition-all flex items-center gap-2 font-bold text-[9px] uppercase tracking-widest",
            showLines ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-400" : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
          )}
        >
          <Brain size={16} /> Engine
        </button>
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-xl border transition-all bg-white/5 border-white/10 text-slate-400 hover:text-white"
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
};
