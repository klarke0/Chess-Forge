# Archived scripts

One-off importers, seeders, and migrations that have already been run against
the production DB. Preserved for reference but not part of any active build
or runtime path.

If a future migration is needed, write a fresh script with a dated filename;
do not re-run anything in this folder without first verifying the schema and
data state — many of these scripts assume a long-gone DB shape.

The single reusable script (`parseJobava.cjs`) lives at the parent level.

## Anything that writes `positions` must set `is_main_line` and `depth`

The drill builder resolves a FEN with several stored book replies using
`ORDER BY is_main_line DESC, depth ASC, san ASC`. If an importer leaves both
columns at their `0` default the sort collapses to `san ASC` — the displayed
"expected" answer becomes alphabetical. `importCaroKann.ts` had exactly this
bug (all 616 Caro-Kann rows landed with `is_main_line = 0, depth = 0`); it now
writes both. The other archived importers here still don't, so after running
any of them re-derive the flags with:

    node scripts/backfill_main_line.cjs --apply

