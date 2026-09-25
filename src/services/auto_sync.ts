import * as api from "./api";
import { useRepertoireStore } from "../stores/repertoireStore";

const SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000;
let started = false;

/**
 * Pull new Chess.com games once per page load, then every 2 hours while the
 * app stays open. Analysis of the new games is the server's job (it kicks off
 * after a sync that inserted games) — the browser no longer analyses anything.
 * Guarded at module level so StrictMode's double effect can't double-fire it.
 */
export function startAutoSync(): void {
  if (started) return;
  started = true;
  const run = () => {
    const username = useRepertoireStore.getState().chessComUsername;
    if (!username) return;
    // Best-effort: a failed background sync is not worth surfacing.
    api.syncGamesFromChessCom(username).catch(() => {});
  };
  run();
  setInterval(run, SYNC_INTERVAL_MS);
}
