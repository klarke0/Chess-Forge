export const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Format a Date as "Mon DD" (e.g. "Mar 14"). */
export function formatWeekLabel(date: Date): string {
  return `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Format an ISO date string as "Mon DD". Returns "" for null/empty input
 * and "?" when the string fails to parse.
 */
export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "?";
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}
