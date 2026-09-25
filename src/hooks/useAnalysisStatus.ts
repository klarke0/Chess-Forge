import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/services/api";
import { pollDelayMs } from "@/utils/analysisStatus";

export interface UseAnalysisStatus {
  status: api.AnalysisStatus | null;
  /** False until the first successful fetch, and again after a 404/network error. */
  available: boolean;
  /** Set when start/stop/retry fails; cleared by the next action. */
  actionError: string | null;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  retryFailed: () => Promise<void>;
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Server-side analysis job status. Fetches on mount, polls every 5s while the
 * job is running (and every 60s otherwise), and pauses while the tab is hidden.
 * A missing route (404) or network error just marks the feature unavailable —
 * no throw, no console output — and polling keeps going so it recovers.
 */
export function useAnalysisStatus(): UseAnalysisStatus {
  const [status, setStatus] = useState<api.AnalysisStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);
  const runningRef = useRef(false);
  // Bumped per fetch so an older, slower response can't overwrite a newer one.
  const fetchSeq = useRef(0);
  const reschedule = useRef<() => void>(() => {});

  const refresh = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const next = await api.getAnalysisStatus();
      if (!mounted.current || seq !== fetchSeq.current) return;
      runningRef.current = next.running;
      setStatus(next);
      setAvailable(true);
    } catch {
      if (!mounted.current || seq !== fetchSeq.current) return;
      runningRef.current = false;
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clear();
      if (cancelled || !isVisible()) return;
      timer = setTimeout(tick, pollDelayMs(runningRef.current));
    };
    const tick = async () => {
      await refresh();
      schedule();
    };
    const onVisibility = () => {
      if (cancelled) return;
      if (isVisible()) void tick();
      else clear();
    };

    reschedule.current = schedule;
    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      mounted.current = false;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const act = useCallback(
    async (call: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await call();
      } catch (e) {
        if (mounted.current) {
          setActionError(e instanceof Error ? e.message : "Request failed");
        }
      }
      await refresh();
      // Running state may have flipped: re-arm the timer with the right delay.
      reschedule.current();
    },
    [refresh],
  );

  return {
    status,
    available,
    actionError,
    refresh,
    start: useCallback(() => act(api.startAnalysis), [act]),
    stop: useCallback(() => act(api.stopAnalysis), [act]),
    retryFailed: useCallback(() => act(api.retryFailedAnalysis), [act]),
  };
}
