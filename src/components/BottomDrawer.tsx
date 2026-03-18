// src/components/BottomDrawer.tsx
import React, { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface BottomDrawerProps {
  children: React.ReactNode;
  label: string;
  secondaryLabel?: string; // e.g. "Engine"
}

export const BottomDrawer: React.FC<BottomDrawerProps> = ({
  children,
  label,
  secondaryLabel,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="lg:hidden shrink-0 flex flex-col-reverse overflow-hidden transition-[max-height] duration-300 ease-in-out"
         style={{ maxHeight: isOpen ? '55vh' : '1.75rem' }}>
      {/* Handle — always visible at bottom, rendered first in DOM for flex-col-reverse */}
      <button
        onClick={() => setIsOpen(o => !o)}
        aria-expanded={isOpen}
        className="shrink-0 h-7 w-full flex items-center justify-center gap-2 bg-[#0a0d14] border-t border-white/10 text-slate-500 hover:text-white transition-colors"
      >
        {isOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        <span className="text-[10px] font-black uppercase tracking-widest">
          {label}
          {secondaryLabel && (
            <>
              <span className="text-slate-600 mx-1.5">·</span>
              {secondaryLabel}
            </>
          )}
        </span>
      </button>

      {/* Content — slides up above the handle */}
      <div className="flex-1 min-h-0 flex flex-col bg-[#0a0d14]">
        {children}
      </div>
    </div>
  );
};
