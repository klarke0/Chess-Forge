import React from 'react';
import { Sword, Database, BookOpen, CalendarClock, Sparkles, Film } from 'lucide-react';
import { ForgeIcon } from './ForgeIcon';
import { cn } from '../utils/cn';

export type TabMode = 'train' | 'games' | 'library' | 'review' | 'insights' | 'film';

interface LayoutProps {
  children: React.ReactNode;
  activeMode: TabMode;
  onNavigate: (mode: TabMode) => void;
  dueBadge?: number;
}

interface Tab {
  mode: TabMode;
  label: string;
  icon: React.ReactNode;
  activeClass: string;
}

const TABS: Tab[] = [
  { mode: 'train',    label: 'Train',    icon: <Sword size={20} />,        activeClass: 'text-orange-400' },
  { mode: 'games',    label: 'Games',    icon: <Database size={20} />,      activeClass: 'text-emerald-400' },
  { mode: 'library',  label: 'Library',  icon: <BookOpen size={20} />,      activeClass: 'text-amber-400' },
  { mode: 'film',     label: 'Film',     icon: <Film size={20} />,          activeClass: 'text-rose-400' },
  { mode: 'review',   label: 'Review',   icon: <CalendarClock size={20} />, activeClass: 'text-rose-400' },
  { mode: 'insights', label: 'Insights', icon: <Sparkles size={20} />,      activeClass: 'text-violet-400' },
];

export const Layout: React.FC<LayoutProps> = ({ children, activeMode, onNavigate, dueBadge = 0 }) => {
  return (
    <div className="flex h-screen bg-[var(--bg-base)] text-slate-200 font-outfit overflow-hidden flex-col md:flex-row">
      {/* DESKTOP SIDEBAR */}
      <aside className="hidden md:flex w-[90px] bg-[var(--bg-surface)] border-r border-white/5 flex-col items-center py-6 gap-4 z-50 shrink-0">
        {/* Brand */}
        <div className="mb-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <ForgeIcon size={20} />
          </div>
        </div>

        {/* Tabs */}
        <nav className="flex flex-col gap-2 w-full px-2">
          {TABS.map(tab => (
            <button
              key={tab.mode}
              onClick={() => onNavigate(tab.mode)}
              className={cn(
                "w-full py-3 rounded-xl flex flex-col items-center gap-1.5 transition-all border relative",
                activeMode === tab.mode
                  ? cn("bg-white/5 border-white/10", tab.activeClass)
                  : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]"
              )}
            >
              {tab.icon}
              <span className="text-[9px] font-black uppercase tracking-widest">{tab.label}</span>
              {tab.mode === 'review' && dueBadge > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center leading-none">
                  {dueBadge > 99 ? '99+' : dueBadge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* MOBILE BOTTOM NAV */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[var(--bg-nav)] backdrop-blur-xl border-t border-white/5 flex items-center justify-around px-6 z-[100]">
        {TABS.map(tab => (
          <button
            key={tab.mode}
            onClick={() => onNavigate(tab.mode)}
            className={cn(
              "flex flex-col items-center gap-1 relative transition-all",
              activeMode === tab.mode ? tab.activeClass : "text-slate-500"
            )}
          >
            {tab.icon}
            <span className="text-[8px] font-black uppercase tracking-tighter">{tab.label}</span>
            {tab.mode === 'review' && dueBadge > 0 && (
              <span className="absolute -top-1 -right-2 min-w-[14px] h-3.5 px-0.5 bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center leading-none">
                {dueBadge > 99 ? '99+' : dueBadge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* MAIN CONTENT */}
      <main className="flex-1 relative overflow-hidden flex flex-col mb-16 md:mb-0">
        {children}
      </main>
    </div>
  );
};
