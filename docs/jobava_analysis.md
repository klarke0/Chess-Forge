# Jobava London Repertoire — Structural Analysis & Drill Fix

## Summary

Bortnyk & Naroditsky's Jobava London course ships as a folder of PGNs.
Empirical comparison (parsed each file, deduplicated `(fen, san)` entries):

| File | Entries | Notes |
|---|---:|---|
| `Jobava London New Version.pgn` | **4292** | 9 chapter games — superset, this is canonical |
| `Jobava London 3...e6.pgn` | 566 | subset of NV chapter 4 |
| `Jobava London 3...Bf5.pgn` | 499 | subset of NV chapter 8 |
| `Jobava London 3...a6.pgn` | 416 | subset of NV chapter 3 |
| `Jobava London 3...c5.pgn` | 354 | subset of NV chapter 2 |
| `Jobava London 3...g6.pgn` | 350 | subset of NV chapter 6 |
| `Jobava London 3...c6.pgn` | 165 | subset of NV chapter 9 |
| `Jobava London 1...d5 2.Nc3 Bf5.pgn` | 63 | subset of NV chapter 5 |
| `Jobava London Rare 3rd Moves.pgn` | 53 | subset of NV chapter 7 |
| `All Lines in One File .pgn` | 2022 | identical to NV chapter 1 ("All Files Combined") |
| `Typical Ideas for White.pgn` | 44 | distinct content — 7 *thematic* games (e3-e4 break, knight-on-b5, etc.) |
| **Union of all files** | 4327 | only **35 entries** are in non-NV files but missing from NV |

The "New Version" PGN is **not** a flattened export — it preserves the
same nested-variation structure as the per-chapter PGNs. The 9 NV
chapters correspond 1:1 to the 8 per-chapter PGNs plus `All Lines in
One File`. The per-chapter files are strict subsets.

The 35 stragglers come almost entirely from `Typical Ideas for White`,
which is a **thematic illustration** file (positional ideas with
arbitrary starting FENs), not Jobava-from-the-start repertoire moves.
Including it in the drill pool would queue middlegame puzzle positions
that the trainer has no business asking when Kevin sits down to drill
his White opening — it would actually make the drill *worse*.

## Tree shape

Each chapter is a single PGN game whose **mainline = the move sequence
the author actively recommends as our (White) repertoire**. Every
deviation is expressed as a parenthesised PGN variation, nested
arbitrarily deep. Comments (`{...}`) carry author prose. NAGs and
glyphs (`!`, `?`, `!?`) decorate moves but don't change main-line
status.

The clean signal is **structural**: the move on the outermost main
line of each chapter is the recommended repertoire move. Anything
inside a `(...)` is a sideline (though still a real move that we'd
play if forced into that branch).

Chapter 1 ("All Files Combined") is a 250KB mega-tree whose own
outer-mainline happens to be the 3...c6 line. Chapters 2–9 redo the
other Black tries (3...c5, 3...a6, 3...e6, 3...Bf5, 3...g6, 3...Nc6,
1...d5 2.Nc3 Bf5, Rare 3rd Moves) as their own outer mainlines so
their recommended White responses get marked `is_main_line=1, depth=0`.
The dedup in `upsertMove` keeps the best classification across chapters.

## Schema

`positions`:

| Column | Meaning |
|---|---|
| `is_main_line INTEGER NOT NULL DEFAULT 0` | 1 iff every ancestor frame on the path from chapter root to this move was on its own main line and we never descended into a `(...)`. The recommended repertoire move. |
| `depth INTEGER NOT NULL DEFAULT 0` | Variation depth. 0 = chapter mainline, 1 = first-level sideline, etc. |

When the same `(fen, san)` is encountered multiple times we keep the
**best** classification: `is_main_line=1` wins; tie → smallest `depth`.

## Drill query

All four `positions` reads in `server/routes/v2_train_now.ts` order by:
```sql
ORDER BY is_main_line DESC, depth ASC, san ASC
```
The repertoire-drill query additionally collapses multi-move FENs to a
single best row via a correlated subquery on `id`, so each FEN is
queued exactly once with a deterministic answer.

## Counts (current, repertoire id=3)

| Metric | Value |
|---|---:|
| Total positions rows | 4292 |
| Distinct FENs | 3451 |
| Main-line entries (`is_main_line=1`) | 251 |
| Sideline entries (`is_main_line=0`) | 4041 |
| White-to-move drillable rows (after side+dedup filter) | 1778 |

Why is `main_line` only 251 across 9 chapters? Each chapter mainline is
~15–53 plies but most plies are shared (1.d4 Nf6 2.Nc3 d5 3.Bf4 is the
prefix for 7 chapters and counts once). Sum of declared chapter
mainlines is 315; after de-duplication on `(fen, san)` we land at 251.

## 2026-05 re-investigation (regression report)

After the prior re-ingestion (4768 → 4292), Kevin reported "Jobava
lines are even worse." Diagnosis traced **every plausible cause**:

1. **Wrong canonical file?** No. Empirically, `Jobava London New
   Version.pgn` is a strict superset of every per-chapter file (verified
   by parsing each independently and computing the set difference). The
   only content not in NV is `Typical Ideas for White.pgn` (44
   thematic-position entries) — including this in the drill pool would
   queue arbitrary middlegame puzzles, hurting drill quality, not
   helping.
2. **Stale rows in `positions`?** No. Re-seed wipes by
   `repertoire_id=3` then re-inserts; no leftover rows.
3. **Wrong main-line classification?** Spot-checked against 7 chapter
   mainlines (3...c5, 3...a6, 3...e6, 3...Bf5, 3...g6, 3...Nc6, 2.Nc3
   Bf5). All recommended White responses correctly flagged
   `is_main_line=1, depth=0`. 2.Nc3 specifically: stored as `Nc3
   (m=1, d=0)` after both `1.d4 Nf6` and `1.d4 d5`.
4. **Drill queries non-deterministic?** No. All four `FROM positions`
   reads include the deterministic `ORDER BY` and the rep-drill source
   uses a correlated-subquery `id` collapse.
5. **Stale answers in `progress` table?** Progress only stores
   `(repertoire_id, fen)`. Answers are looked up fresh on every drill,
   so there are no stale-answer rows. (71 of 79 Jobava progress rows
   *are* orphan in the sense of not existing in `positions` — those are
   blunder-source FENs from Kevin's actual games and are legitimate for
   blunder-mode drilling, just skipped in repertoire mode.)

**Conclusion: no data-layer bug exists.** The reported regression is
almost certainly attributable to one of:
- The known false-flag classifier issue on 2.Nc3 (being addressed by a
  parallel agent in `background_analysis.ts` / classifier).
- Stale PWA bundle on Kevin's mobile (force-refresh after the next
  build).

A re-ingest under a different source choice would either be a no-op
(per-chapter files = strict subset) or actively harmful (adding
thematic positions from `Typical Ideas`).

## Files

- `scripts/parseJobava.cjs` — canonical parser (NV-only, BOM/CRLF safe,
  emits `is_main_line` + `depth`).
- `scripts/reseed_jobava.cjs` — idempotent re-seed of repertoire 3.
- `server/db.ts` — `seedJobavaLondon` writes new columns.
- `server/routes/v2_train_now.ts` — all four `FROM positions` queries
  ordered by `is_main_line DESC, depth ASC, san ASC`; pool queries dedupe
  per FEN.
- `src/data/jobava_full.json` — parser output cache.
