import React from "react";
import { Sword, Gamepad2, BarChart3, Settings } from "lucide-react";
import { cn } from "@/utils/cn";

export type V2Tab = "train" | "games" | "insights" | "settings";

interface BottomNavProps {
  activeTab: V2Tab;
  onNavigate: (tab: V2Tab) => void;
}

const TABS: { id: V2Tab; label: string; Icon: React.ElementType }[] = [
  { id: "train", label: "Train", Icon: Sword },
  { id: "games", label: "Games", Icon: Gamepad2 },
  { id: "insights", label: "Insights", Icon: BarChart3 },
  { id: "settings", label: "Settings", Icon: Settings },
];

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onNavigate,
}) => {
  return (
    <nav
      className="absolute bottom-0 left-0 right-0 z-[100] bg-forge-nav backdrop-blur-xl border-t border-forge-border-subtle"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-center justify-around h-16 px-6">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={cn(
                "flex flex-col items-center gap-1 min-w-[64px] min-h-[44px] justify-center cursor-pointer",
                "transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-forge-nav rounded-lg",
                active ? "text-forge-primary-hover" : "text-forge-text-inactive hover:text-forge-text-primary",
              )}
            >
              <Icon size={22} />
              <span className="text-[9px] font-black uppercase tracking-widest">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
