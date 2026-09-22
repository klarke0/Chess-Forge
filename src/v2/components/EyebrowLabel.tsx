import React from "react";
import { cn } from "../../utils/cn";

type EyebrowLabelProps = React.HTMLAttributes<HTMLSpanElement> & {
  /** sm=8px dense inline tags, md=10px (default, the dominant size), lg=11px section headers */
  size?: "sm" | "md" | "lg";
};

const SIZE_CLASS: Record<NonNullable<EyebrowLabelProps["size"]>, string> = {
  sm: "text-forge-label-sm",
  md: "text-forge-label",
  lg: "text-forge-label-lg",
};

/**
 * The bold/uppercase/tracked label pattern repeated ~40x across V2 screens
 * at inconsistent pixel sizes. Renders as an inline <span> so it composes
 * inside chips, headers, and rows the same way the ad-hoc classes did.
 */
export const EyebrowLabel: React.FC<EyebrowLabelProps> = ({
  size = "md",
  className,
  children,
  ...rest
}) => (
  <span className={cn("font-black uppercase", SIZE_CLASS[size], className)} {...rest}>
    {children}
  </span>
);
