# Book Audit Report — September 2026

First full engine audit of both repertoires (depth 14, Stockfish 19 native,
2026-09-17/18). Data lives in `book_audit`; re-runnable via
`POST /api/v2/audit/sweep`. This report interprets it.

## Totals

| | positions swept | ok | gray (75–149cp) | flagged (≥150cp) | errors |
|---|---|---|---|---|---|
| Jobava London (rep 3) | 6,596 | 6,105 | 208 | 290 (+2 pre-fix) | 0 |
| Caro-Kann (rep 2) | 616 | 383 | 57 | 176 | 0 |

## The side split is the headline

A repertoire tree stores BOTH sides' moves. Flags on the **opponent's** moves
are usually intentional — inferior tries the course teaches you to punish.
Flags on **Kevin's own** moves are real book defects. Split:

| | flagged, Kevin's move | flagged, opponent's move |
|---|---|---|
| Jobava (White) | **29** | 261 |
| Caro-Kann (Black) | **84** | 92 |

**Jobava: healthy.** 261/290 flags are opponent bait — expected course design.
The 29 Kevin-side flags (0.4% of the book) are the real review list; the known
move-16 bishop-hang line should be among them.

**Caro-Kann: not healthy.** 84 Kevin-side flags out of a 616-position book
(13.6%) is far beyond course-design noise, and the top offenders form a
suspicious cluster: near-identical middlegame positions (Black Qc7 + Bg4
structures vs White Bd3/Qe2) where the book plays quiet moves (`a6`, `e6`,
`b6`, `h5`) while the engine measures **14–19 pawn** losses — queen-hang /
mate-threat territory. Quiet moves don't lose 16 pawns in sound lines. Candidate causes, in
likelihood order given the data's provenance (**the Caro book was OCR-ingested
from a physical book** — Kevin, 2026-09-17):

1. **OCR transcription errors** — wrong move or wrong position recorded.
2. **Mis-sided punish lines** — the book showed deliberately bad moves "to
   punish"; ingestion may have stored them as repertoire moves. These aren't
   defects to delete — they belong in punish/bait training, on the other side.
3. **Corrupted merged lines** — multiple variations stitched to wrong
   continuations (same bug family as the import fixes shipped 2026-09-17).

Kevin is not deeply familiar with these lines, so triage must lean on engine
evidence plus comparison against the source PGNs (`caro_kann_study.pgn`,
`caro_kann_chapter_*.pgn`), not eyeballing.

## Masters tiebreak: blocked

`explorer.lichess.ovh` returns 401 for all anonymous requests from this
machine (verified against the start position — not a code bug). All 265 gray
rows remain `gray`/retryable. **Ruling:** gray rows are NOT quarantined —
course-trusted per the spec's "engine flags only egregious losses" principle.
Only `flagged` rows gate the future Learn queue. Re-run
`POST /api/v2/audit/tiebreak` when explorer access works (lichess API token,
or proxy through the browser where the masters-coach feature calls the same
endpoint).

## Recommended follow-ups (not yet done)

1. **Triage the 84 Caro Kevin-side flags** — likely one root cause (bad
   import/merge), not 84 individual errors. Compare against the source PGNs;
   fix the importer or excise the corrupt subtree, then re-sweep rep 2
   (minutes — audit rows for changed FENs re-sweep automatically).
2. **Review the 29 Jobava Kevin-side flags** — small enough to eyeball;
   confirm and excise the bishop-hang line.
3. **Lichess token** for the masters tiebreak of 265 gray rows.
4. When the Learn queue ships, quarantine = `verdict='flagged'` on Kevin-side
   moves only; opponent-side flags feed punish/bait training instead.

## Queries used

```sql
-- side split
SELECT a.repertoire_id,
  CASE WHEN substr(a.fen, instr(a.fen,' ')+1, 1) = substr(r.side,1,1)
       THEN 'KEVIN' ELSE 'opponent' END AS mover, COUNT(*)
FROM book_audit a JOIN repertoires r ON r.id = a.repertoire_id
WHERE a.verdict='flagged' GROUP BY 1,2;

-- Kevin-side worst offenders
SELECT a.repertoire_id, a.loss_cp, a.san, a.fen
FROM book_audit a JOIN repertoires r ON r.id = a.repertoire_id
WHERE a.verdict='flagged'
  AND substr(a.fen, instr(a.fen,' ')+1, 1) = substr(r.side,1,1)
ORDER BY a.loss_cp DESC;
```
