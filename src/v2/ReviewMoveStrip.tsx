import React, { useEffect, useId, useRef } from "react";
import { ListOrdered, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { GRADE_STYLE } from "./GameReviewSummary";

export interface StripMove {
  /** 0-based ply index into the game (even = White, odd = Black). */
  idx: number;
  san: string;
  grade?: string;
}

const FOCUS_INSET =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400";

/** "14." for White plies, "14..." for Black plies. */
export const plyLabel = (idx: number) =>
  `${Math.floor(idx / 2) + 1}${idx % 2 === 0 ? "." : "..."}`;

/** Tinted-chip classes for a move's grade. Colour is never the only cue:
 * callers pair it with the grade label in text (caption / aria-label). */
export const gradeChipClass = (grade?: string) => {
  const style = grade ? GRADE_STYLE[grade] : undefined;
  return cn("border-b-2", style ? cn(style.tint, style.border) : "border-transparent");
};

interface ReviewMoveStripProps {
  moves: StripMove[];
  /** -1 = start position (no move selected). */
  currentIdx: number;
  onSelect: (idx: number) => void;
  onExpand: () => void;
  /** Shows a small dot on the expand button (e.g. out-of-book positions to review). */
  expandHasBadge?: boolean;
}

/**
 * One horizontally scrolling line of move chips (SAN only, tinted by grade),
 * with the current move ringed and centred, plus a button that opens the full
 * move list in a bottom sheet.
 */
export const ReviewMoveStrip: React.FC<ReviewMoveStripProps> = ({
  moves,
  currentIdx,
  onSelect,
  onExpand,
  expandHasBadge,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);

  // Keep the current move centred in the strip.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-strip-idx="${currentIdx}"]`);
    const target = el ? el.offsetLeft - (container.clientWidth - el.offsetWidth) / 2 : 0;
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* matchMedia unavailable */
    }
    container.scrollTo({
      left: Math.max(0, target),
      behavior: reduce || firstRun.current ? "auto" : "smooth",
    });
    firstRun.current = false;
  }, [currentIdx]);

  const tabStop = currentIdx >= 0 ? currentIdx : 0;

  return (
    <div className="shrink-0 flex items-stretch h-11 bg-forge-surface border-t border-forge-border-subtle">
      <div
        ref={scrollRef}
        role="group"
        aria-label="Moves"
        className="relative flex-1 min-w-0 flex items-stretch overflow-x-auto overflow-y-hidden snap-x snap-proximity overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {moves.length === 0 ? (
          <p className="self-center px-3 text-[10px] font-black uppercase tracking-widest text-forge-text-muted">
            No moves yet
          </p>
        ) : (
          moves.map((m) => {
            const isCurrent = m.idx === currentIdx;
            const gradeLabel = m.grade ? GRADE_STYLE[m.grade]?.label : undefined;
            return (
              <React.Fragment key={m.idx}>
                {m.idx % 2 === 0 && (
                  <span
                    aria-hidden="true"
                    className="shrink-0 self-center pl-2 pr-0.5 text-[10px] font-mono text-forge-text-muted select-none"
                  >
                    {Math.floor(m.idx / 2) + 1}.
                  </span>
                )}
                <button
                  type="button"
                  data-strip-idx={m.idx}
                  tabIndex={m.idx === tabStop ? 0 : -1}
                  aria-current={isCurrent ? "true" : undefined}
                  aria-label={`${plyLabel(m.idx)} ${m.san}${gradeLabel ? `, ${gradeLabel}` : ""}`}
                  onClick={() => onSelect(m.idx)}
                  className={cn(
                    "shrink-0 snap-center min-h-[44px] min-w-[44px] px-2 text-[13px] cursor-pointer motion-safe:transition-colors",
                    FOCUS_INSET,
                    gradeChipClass(m.grade),
                    isCurrent
                      ? "font-black text-white ring-2 ring-inset ring-forge-text-primary"
                      : "font-semibold text-forge-text-primary hover:bg-forge-elevated",
                  )}
                >
                  {m.san}
                </button>
              </React.Fragment>
            );
          })
        )}
      </div>
      <button
        type="button"
        onClick={onExpand}
        aria-label="Open full move list"
        aria-haspopup="dialog"
        className={cn(
          "relative shrink-0 min-h-[44px] min-w-[48px] flex items-center justify-center border-l border-forge-border-subtle text-forge-text-secondary hover:text-white cursor-pointer",
          FOCUS_INSET,
        )}
      >
        <ListOrdered size={18} aria-hidden="true" />
        {expandHasBadge && (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-forge-warning"
          />
        )}
      </button>
    </div>
  );
};

interface ReviewSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet rendered inside its (positioned) parent. Closes on backdrop tap
 * or Escape, traps Tab inside itself, and restores focus to the opener.
 */
export const ReviewSheet: React.FC<ReviewSheetProps> = ({ open, title, onClose, children }) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="absolute inset-0 z-[60] flex items-end">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 motion-safe:animate-in motion-safe:fade-in duration-200"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapTab}
        className="relative w-full max-h-[80%] flex flex-col bg-forge-surface border-t border-forge-border-default rounded-t-forge-xl shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-bottom duration-200"
      >
        <div className="shrink-0 flex items-center justify-between pl-4 pr-1 border-b border-forge-border-subtle">
          <h2
            id={titleId}
            className="text-[11px] font-black uppercase tracking-widest text-forge-text-primary"
          >
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={`Close ${title.toLowerCase()}`}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-forge-md text-forge-text-secondary hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">{children}</div>
      </div>
    </div>
  );
};
