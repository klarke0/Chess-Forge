import React from "react";
import { cn } from "../../utils/cn";

export type ChipTone =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "insight"
  | "neutral"
  | "grade-best"
  | "grade-inaccuracy"
  | "grade-mistake"
  | "grade-blunder"
  | "drill-blunder"
  | "drill-deviation"
  | "drill-review"
  | "drill-punish";

const TONE_CLASS: Record<ChipTone, string> = {
  primary: "bg-forge-primary text-white",
  success: "bg-forge-success-muted text-forge-success",
  warning: "bg-forge-warning-muted text-forge-warning",
  danger: "bg-forge-danger-muted text-forge-danger",
  insight: "bg-forge-insight-muted text-forge-insight",
  neutral: "bg-forge-elevated text-forge-text-secondary",
  // Grade = engine judgment of a move (server/utils/analysis.ts grade field)
  "grade-best": "bg-forge-success-muted text-forge-grade-best",
  "grade-inaccuracy": "bg-forge-warning-muted text-forge-grade-inaccuracy",
  "grade-mistake": "bg-forge-warm-bg text-forge-grade-mistake",
  "grade-blunder": "bg-forge-danger-muted text-forge-grade-blunder",
  // Drill source = which pool a Train Now card was pulled from (v2_train_now.ts)
  "drill-blunder": "bg-forge-danger-muted text-forge-drill-blunder",
  "drill-deviation": "bg-forge-warning-muted text-forge-drill-deviation",
  "drill-review": "bg-forge-elevated text-forge-drill-review",
  "drill-punish": "bg-forge-insight-muted text-forge-drill-punish",
};

type StatusChipProps = {
  tone: ChipTone;
  size?: "sm" | "md" | "lg";
  className?: string;
  children: React.ReactNode;
};

/** Generalizes the STAGE_CHIP pattern from HomeScreen into a shared, toned badge. */
export const StatusChip: React.FC<StatusChipProps> = ({ tone, size = "md", className, children }) => (
  <span
    className={cn(
      "inline-flex items-center shrink-0 font-black uppercase px-2 py-0.5 rounded-forge-sm",
      size === "sm" ? "text-forge-label-sm" : size === "lg" ? "text-forge-label-lg" : "text-forge-label",
      TONE_CLASS[tone],
      className,
    )}
  >
    {children}
  </span>
);
