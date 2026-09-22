import React from "react";
import { cn } from "../../utils/cn";

/**
 * The `rounded-forge-xl bg-forge-card border border-forge-border-subtle`
 * wrapper repeated across every V2 screen. Exposed as both a class-builder
 * (for `<button>` cards, which need their own element) and a `<div>`
 * component (for the common non-interactive case).
 */
export function forgeCardClass(opts?: { interactive?: boolean }): string {
  return cn(
    "bg-forge-card border border-forge-border-subtle rounded-forge-xl",
    opts?.interactive &&
      "text-left active:scale-[0.98] transition-all duration-forge-fast hover:border-forge-border-default",
  );
}

type ForgeCardProps = React.HTMLAttributes<HTMLDivElement>;

export const ForgeCard: React.FC<ForgeCardProps> = ({ className, children, ...rest }) => (
  <div className={cn(forgeCardClass(), className)} {...rest}>
    {children}
  </div>
);
