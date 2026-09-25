/**
 * Game-analysis job constants. Bump ANALYSIS_VERSION when the grading model or
 * the shape/meaning of `analysis_json` changes: games stored under an older
 * version (or none) are queued for re-analysis and overwritten in place.
 * Version NULL = the legacy browser depth-12 scan; 2 = the server job.
 */
export const ANALYSIS_VERSION = 2;
/** Target search depth per position. */
export const ANALYSIS_DEPTH = 14;
/** Per-position time cap: `go depth 14 movetime 3000` — whichever limit hits first ends the search. */
export const ANALYSIS_MOVETIME_MS = 3000;
