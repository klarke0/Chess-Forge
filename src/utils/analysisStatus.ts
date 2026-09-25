import type { AnalysisStatus } from "@/services/api";

export const POLL_RUNNING_MS = 5_000;
export const POLL_IDLE_MS = 60_000;

/** How long to wait before the next status poll. */
export function pollDelayMs(running: boolean): number {
  return running ? POLL_RUNNING_MS : POLL_IDLE_MS;
}

/** "~6h", "~40m", "<1m", "~2d". Returns null when there is no estimate. */
export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return "<1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes}m`;
  const hours = Math.max(1, Math.round(seconds / 3600));
  if (hours < 48) return `~${hours}h`;
  return `~${Math.round(hours / 24)}d`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Games worked through so far vs. games the job needs to cover (failed ones excluded). */
export function analysisProgress(status: AnalysisStatus): { done: number; of: number } {
  const { done, pending } = status.counts;
  return { done, of: done + pending };
}

/** "Analyzing 132/1,015 · ~6h" */
export function formatRunningLabel(status: AnalysisStatus): string {
  const { done, of } = analysisProgress(status);
  const eta = formatEta(status.etaSeconds);
  return `Analyzing ${formatCount(done)}/${formatCount(of)}${eta ? ` · ${eta}` : ""}`;
}
