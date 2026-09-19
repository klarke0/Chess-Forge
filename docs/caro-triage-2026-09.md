# Caro-Kann Repertoire Triage — Flagged Kevin-Side Moves (2026-09)

**Scope:** the 84 rows in `book_audit` (repertoire_id=2, black to move, verdict='flagged',
loss_cp >= 150) that sit on Kevin's own side of the tree. Read-only analysis; no writes
were made to `server/chess_trainer.db`. All SQL below is proposed, not executed.

## TL;DR

| Bucket | Count | Meaning |
|---|---|---|
| **NOT-IN-SOURCE** | 74 | The exact (position, move) pair does not appear anywhere in any of the 7 source PGNs, including all recursive variations. Delete candidates. |
| **KEEP** | 10 | The move appears in source as a real (non-punished) line — engine just dislikes it. Do not touch. |
| **MIS-SIDED-PUNISH** | 0 | None of the 84 matched a source occurrence that was also flagged as a deliberate wrong-move branch (NAG ?/?? or "mistake/blunder/loses" comment). See caveat below — this bucket is likely under-counted, not truly zero. |
| **UNREACHABLE** (bonus) | 0 of 84 | Every flagged position IS reachable from the repertoire root via `positions.next_fen` chains. The tree's internal connectivity is fine. |

**Overall tree health check:** of all 616 repertoire_id=2 `positions` rows, 0 are
unreachable from the root (tree connectivity is sound). However, a random 100-row sample
of the *entire* 616-row tree (not just flagged rows) only exact-matches a source PGN
edge 38% of the time — see "Important caveat" below before treating NOT-IN-SOURCE as a
clean signal on its own.

## Method

1. Pulled the 84 flagged rows via the suggested join (85 lines incl. header; `positions.comment`
   was NULL for every one of them — not a join bug, just no comment on those specific rows).
2. Parsed all 7 source PGNs (`caro_kann_study.pgn` + the 6 chapter files) with a **custom
   recursive-descent PGN walker** (not `python-chess`'s `chess.pgn.read_game`/`GameBuilder`).
   `python-chess`'s parser crashes (`IndexError: pop from empty list`) or silently truncates
   entire games when it hits an illegal/OCR-garbled SAN token inside a nested variation —
   and that happens constantly in this OCR'd gamebook data. A first pass using stock
   `python-chess` (catching exceptions per-game) still lost most of Chapter 8's content and
   produced a false 82/84 NOT-IN-SOURCE result.
3. Discovered and fixed a second corruption source: the source prose uses **plain
   parentheses for English asides** instead of PGN's `{curly braces}` — e.g.
   `e5! (the rule, the rule!) 7. Nd2` — which desyncs variation-nesting depth for the rest
   of the file once one appears. Added a heuristic pre-pass (`fix_comment_parens`) that
   rewrites any `(...)` span whose first token isn't move-number/SAN-shaped into a `{...}`
   comment before parsing. This alone recovered hundreds of previously-lost move-entries.
4. Built `norm4(fen) -> [{san, nags, comment, is_mainline, source, game_idx}]` across all
   games + all recursive variations (4101 move-entries across 1929 unique 4-field-normalized
   positions after the fix).
5. Classified each of the 84 rows by looking up its exact (norm4-fen, san) edge:
   - No candidates at that FEN at all -> **NOT-IN-SOURCE** ("position never reached").
   - Candidates exist at that FEN but this SAN isn't among them -> **NOT-IN-SOURCE**
     ("position seen Nx, san never played there" — lists the SANs that *were* seen).
   - Candidates match this SAN, and every occurrence carries a negative marker
     (NAG $2/$4/$6, or a comment matching mistake/blunder/wrong/loses/refut/etc.) ->
     **MIS-SIDED-PUNISH**.
   - Otherwise -> **KEEP**.
6. Reachability: BFS from the shared repertoire root FEN (standard starting position —
   all 8 chapters for repertoire 2 use the same `first_fen`) across `positions.fen ->
   positions.next_fen`, normalized to 4 fields.

## Important caveat — read before deleting anything

The 74/84 NOT-IN-SOURCE result is **not** as clean as "these are gamebook wrong-branch
artifacts" alone would suggest. A random 100-row sample of the full 616-row rep-2
`positions` table (unfiltered by loss_cp, i.e. including moves the engine is totally fine
with) only matched a source PGN edge in 38/100 cases with the same method. That means a
meaningful chunk of NOT-IN-SOURCE is a **method limitation** — heavy transposition
(the same FEN reachable via many move orders across 7 files, one game's alternative
mis-parsed, a variation nested too deep for my heuristic paren-fixer, etc.) — not proof
the content is fake.

What *does* make the 84-row result trustworthy is the **contrast with the random
baseline**: only 10/84 (12%) of flagged rows matched source, vs 38% for a random,
loss-unfiltered sample — a ~3x lower match rate specifically among the rows the engine
also independently flagged as huge losers (median loss_cp 675, max 1869 = nearly two
whole queens). And every one of the 10 KEEP rows has loss_cp <= 909, while every row
above 909cp is NOT-IN-SOURCE. Engine-dislikes-it and can't-find-it-in-the-book line up
for the worst offenders, which is exactly the pattern you'd expect from OCR/gamebook
contamination — but it also means some of the 74 are probably legitimate transpositions
my parser just couldn't chase down, especially the ones near the 150cp floor.

**Recommendation:** delete with confidence starting from the top of the loss_cp list
downward; hand-verify (or just leave alone) anything below ~300cp where the signal is
weakest. Given the 616-row tree's ~38% baseline miss rate, it would also be worth a
follow-up pass specifically on **why so much of the non-flagged tree doesn't
independently verify against source text** — that's a bigger finding than these 84 rows
and deserves its own investigation (see "Also worth investigating" below).

## Why MIS-SIDED-PUNISH came back 0

This bucket only fires when a row's (fen, san) edge *does* exist in source (so it passes
the FEN+SAN lookup) but every occurrence is marked negative. Since 74/84 failed at the
FEN+SAN lookup stage entirely (NOT-IN-SOURCE), there was no chance for most of them to
even reach the negative-marker check. In other words: **most of what was hypothesized as
"mis-sided punishment" (gamebook wrong-branch move attributed to Kevin) is instead
showing up as flat NOT-IN-SOURCE**, because the (fen, san) pair the DB has literally does
not match anything in the text — consistent with these being ingestion/linking artifacts
(the position tree wired an edge that never existed in any game or variation) rather than
"real move that existed but was flagged bad in-context." The two hypotheses (bad-branch
misattribution vs. ingestion artifact) both point to the same fix (delete the position),
so it doesn't change the recommended action — the 0-count is a report-writing/semantics
outcome, not "everything's fine."

## Clusters

The 84 rows collapse into two book chapters by shared move prefix:

| Cluster (first 8 plies) | Rows | Bucket breakdown | What it is |
|---|---|---|---|
| `e4 c6 d4 d5 e5 c5 dxc5 e6` | 48 | 39 NOT-IN-SOURCE, 9 KEEP | Chapter 9 — Advance Variation (3...c5 lines), Var A/B1/B2/B3/C |
| `e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6` | 36 | 35 NOT-IN-SOURCE, 1 KEEP | Chapter 8 — Exchange with 4.Bd3, Var A/B/C |

The Chapter 8 (Exchange) cluster is markedly worse: only 1/36 flagged rows there trace to
real source content, vs 9/48 in the Chapter 9 (Advance) cluster. Worth a closer look at
how Chapter 8 specifically got ingested — `caro_kann_chapter_8_complete.pgn` is also the
file whose game 2 (the `6. Bg5` line) crashes stock `python-chess` outright due to the
comment-in-parens bug, so if the app's original ingestion pipeline used a similarly
strict PGN parser without OCR-tolerant recovery, it may have silently dropped or
mis-linked large parts of that chapter while still leaving `book_audit`-flagged edges
behind in `positions`.

## Full per-row table (sorted by loss_cp, descending)

| fen | san | loss_cp | bucket | evidence |
|---|---|---|---|---|
| `r1b1kbnr/ppq1p1p1/2n2p1Q/3p3p/3P4/2PB3P/PP3PP1/RNB1K1NR b KQkq -` | b6 | 1869 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/ppq2ppp/2n5/3pP1B1/6b1/2PB4/PP2QPPP/RN2K1NR b KQkq -` | Nd4 | 1644 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/1pq1pppp/p1n5/3p4/3P2b1/2PB4/PPN1QPPP/R1B1K1NR b KQkq -` | e6 | 1628 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/ppq1pppp/2n5/3p4/3P2b1/2PB4/PP1NQPPP/R1B1K1NR b KQkq -` | e6 | 1624 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kb1r/ppq1pppp/2n2n2/3p2B1/3P2b1/2PB4/PP1NQPPP/R3K1NR b KQkq -` | Bf5 | 1622 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/ppq1pppp/2n5/3p4/3P2b1/2PBB3/PP2QPPP/RN2K1NR b KQkq -` | a6 | 1604 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/ppq1pppp/2n5/3p4/3P1Bb1/2PB4/PP2QPPP/RN2K1NR b KQkq -` | e6 | 1587 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kb1r/ppq1pppp/2n2n2/3p2B1/3P2b1/2PB3P/PP1N1PP1/R2QK1NR b KQkq -` | h5 | 1586 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/ppq1pppp/2n5/3p4/3P2b1/N1PB4/PP2QPPP/R1B1K1NR b KQkq -` | a6 | 1562 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/ppq1pppp/2n5/3p2B1/3P2b1/2PB4/PP2QPPP/RN2K1NR b KQkq -` | e5 | 1496 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/1pq2ppp/p1n1p3/3p4/3P1Bb1/2PB4/PPN1QPPP/R3K1NR b KQkq -` | Bd6 | 1418 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kb1r/p4pp1/1qn1p3/3pPn1P/3B4/2P5/PP1Q1P1P/RN2KBNR b KQkq -` | Bb4 | 1400 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kb1r/p4pp1/1qn1p3/3pPn1P/3B4/2P5/PP1Q1P1P/RN2KBNR b KQkq -` | Rb8 | 1262 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kb1r/p4ppp/1qn1p3/3pPn2/3B2P1/2P5/PP1Q1P1P/RN2KBNR b KQkq -` | h5 | 1211 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/p4ppp/1Pn1p3/3pPn2/3B2P1/2P5/PP3P1P/RN1QKBNR b KQkq -` | Qxb6 | 1193 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rnbqk2r/1p3p1p/4p2p/2bpP3/1P6/3B4/P4PPP/RN1QK1NR b KQkq -` | Qa5 | 1184 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kb1r/ppq2ppp/2n5/2npP1B1/6b1/2PB3N/PP1N1PPP/R2QK2R b KQkq -` | Qd6 | 1070 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b2rk1/pp1q1pp1/2n1B2p/2bpP3/5B2/5N2/PPP1QPPP/RN3RK1 b - -` | Be3 | 1015 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/ppq2ppp/2n1p3/3p4/3P1Bb1/2PB4/PP1NQPPP/R3K1NR b KQkq -` | Bd6 | 1004 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rnb2rk1/pp1q1pp1/4B2p/2bpP3/5B2/5N2/PPP1QPPP/RN2K2R b KQ -` | Nc6 | 986 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rnb2rk1/ppq2pp1/4B2p/2bpP3/5B2/5N2/PPP2PPP/RN1QK2R b KQ -` | Qd7 | 985 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/p4ppp/1Pn1p3/3pPn2/3B4/2PB4/PP3PPP/RN1QK1NR b KQkq -` | Qxb6 | 956 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3k2r/1p2npp1/p1nqp1B1/3p3p/3P2b1/2P1NN2/PP2QPPP/R3K2R b KQkq -` | Bf5 | 956 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rnb1k2r/1p3p1p/4p2p/q1bpP3/1P6/3B4/P2N1PPP/R2QK1NR b KQkq -` | Nd7 | 947 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/1p1n2pp/1P2p3/p1P1P3/3p4/5N2/P4PPP/RN1QKB1R b KQkq -` | Qxb6 | 946 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqk2r/pp3p1p/2n1p2p/2bpP3/8/2P2N2/PP1N1PPP/R2QKB1R b KQkq -` | Nb4 | 942 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3k1nr/ppq2ppp/2nbp3/3p4/3P1Bb1/2PB3P/PP1NQPP1/R3K1NR b KQkq -` | g6 | 916 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/3n1ppp/1P2p3/p2pPn2/P2B4/2P2N2/1P3PPP/RN1QKB1R b KQkq -` | Qxb6 | 913 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kbnr/ppq1pppp/2n5/3p4/3P4/2PB4/PP2QPPP/RNB1K1NR b KQkq -` | Bg4 | 909 | **KEEP** | mainline, `caro_kann_chapter_8_complete.pgn` game 2, no negative markers |
| `r1b1kb1r/p4ppp/1qn1p3/3pPn2/3B4/2PB4/PP2NPPP/RN1QK2R b KQkq -` | Nxe5 | 888 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3k2r/ppqn1ppp/2nbp3/3p4/3P1Bb1/1QPB1N2/PP1N1PPP/R4RK1 b kq -` | Bh5 | 808 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kb1r/ppq2ppp/2n1pn2/3p1bB1/3P4/2PB1N2/PP1NQPPP/R4RK1 b kq -` | Rb8 | 808 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1r3k1/1p1n1pp1/p1q1p1bp/3pN3/3P4/1QP1R1P1/PP1N1PP1/R5K1 b - -` | b5 | 802 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kb1r/ppq1pppp/2n2n2/3p1bB1/3P4/2PB1N2/PP1NQPPP/R3K2R b KQkq -` | e6 | 789 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kb1r/ppq1pppp/2n2nB1/3p2B1/3P4/2P5/PP3PPP/RN1QK1NR b KQkq -` | Ne4 | 757 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kbnr/ppq1pppp/2n5/3p2B1/3P4/2PB4/PP3PPP/RN1QK1NR b KQkq -` | Bg4 | 746 | NOT-IN-SOURCE | position seen 9x, but san=Bg4 never played there (sans seen: Nd2, Ne2, Nf6, Qb3, Qh4, dxe5, f3, h3, h6) |
| `r3k1nr/1pq2ppp/p1nBp3/3p4/3P2b1/2PB4/PPN1QPPP/R3K1NR b KQkq -` | Qxd6 | 740 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kb1r/p2nqppp/1p2p3/2PpP3/3P4/P1N2N2/1P3PPP/R2QKB1R b KQkq -` | a5 | 727 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/pp1n2pp/4p3/2PpP3/1P6/5N2/P4PPP/RN1QKB1R b KQkq -` | Nxe5 | 713 | NOT-IN-SOURCE | position never appears in any source PGN |
| `1r2kb1r/ppq1ppp1/2n2n2/3p2Bp/P2P2b1/1QPB3P/1P1N1PP1/R3K1NR b KQk -` | Nd7 | 712 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rnb2rk1/ppq2ppp/4B3/2bpP1B1/8/5N2/PPP2PPP/RN1QK2R b KQ -` | h6 | 686 | NOT-IN-SOURCE | position seen 1x, but san=h6 never played there (sans seen: Nc3) |
| `r1b1kbnr/ppq1pp1p/2n3p1/3p4/3P1P2/2PB3P/PP4P1/RNBQK1NR b KQkq -` | Bxh3 | 675 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/p2n1ppp/1p2p3/2PpP3/3P4/2N2N2/PP3PPP/R2QKB1R b KQkq -` | Qe7 | 661 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/ppq1pppp/2n5/3p2B1/3P2b1/2PB4/PPQ2PPP/RN2K1NR b KQkq -` | Nxd4 | 652 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3k1nr/1p3pp1/p1nqp1B1/3p3p/3P2b1/2P2N2/PPN1QPPP/R3K2R b KQkq -` | Nge7 | 644 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kb1r/ppq1ppp1/2n2n2/3p2Bp/3P2b1/1QPB3P/PP1N1PP1/R3K1NR b KQkq -` | Rb8 | 638 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b2rk1/p1q3bp/2n1p1p1/1PPp4/1P6/1N3N2/4BPPP/2RQ1RK1 b - -` | Nd4 | 637 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rn2k2r/1pqbbppp/4p3/pBPpPnB1/1P4P1/2P2N2/P4P1P/RN1QK2R b KQkq -` | Nc6 | 620 | **KEEP** | sideline, `caro_kann_chapter_9_expanded.pgn` game 4, no negative markers |
| `rnb1k2r/ppq2ppp/4p3/2bpPBB1/8/5N2/PPP2PPP/RN1QK2R b KQkq -` | O-O | 597 | **KEEP** | sideline, `caro_kann_chapter_9_expanded.pgn` game 4, no negative markers |
| `r1b1kb1r/3nqp1p/1p2p1p1/p1PpP3/3P4/P1N2N2/1P2QPPP/2R1KB1R b Kkq -` | Bg7 | 582 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rnbqkb1r/1p3p1p/4p2p/2PpP3/1P6/8/P4PPP/RN1QKBNR b KQkq -` | Bxc5 | 575 | NOT-IN-SOURCE | position seen 9x, but san=Bxc5 never played there (sans seen: Bb5+, Nf3, b6) |
| `rnb1kb1r/ppq2ppp/4p3/2PpPnB1/6P1/5N2/PPP2P1P/RN1QKB1R b KQkq -` | Be7 | 537 | **KEEP** | sideline, `caro_kann_chapter_9_expanded.pgn` game 4, no negative markers |
| `r3kb1r/p1q1ppp1/2n2n2/1p1p2Bp/3P2b1/2PB3P/PPQN1PP1/R3K1NR b KQkq -` | Rc8 | 527 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/pp3ppp/2n1p3/2PpPn2/3B2P1/2P5/PP3P1P/RN1QKBNR b KQkq -` | b6 | 471 | NOT-IN-SOURCE | position seen 1x, but san=b6 never played there (sans seen: Nxd4) |
| `r1b1kb1r/3nqppp/1p2p3/p1PpP3/3P4/P1N2N2/1P3PPP/2RQKB1R b Kkq -` | g6 | 465 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kbnr/ppq2ppp/2n1p1B1/3p4/3P2b1/2P5/PP1NQPPP/R1B1K1NR b KQkq -` | Nf6 | 464 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1k1r1/pp1nq2p/4pp1b/1BPp4/1P6/2P1PN2/P5PP/RN1Q1RK1 b q -` | d4 | 462 | NOT-IN-SOURCE | position never appears in any source PGN |
| `2r1kb1r/p1q1ppp1/2n2n2/1p1p2Bp/1P1P2b1/2PB3P/P1QN1PP1/R3K1NR b KQk -` | Qb6 | 460 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b2rk1/1p1nq2p/4pp1b/1BPp4/1P6/P3PN2/6PP/RN1Q1RK1 b - -` | d4 | 452 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqk2r/pp3p1p/4p2p/2bpP3/1n6/1QP2N2/PP1N1PPP/R3KB1R b KQkq -` | Qb6 | 415 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rnb2rk1/ppq2ppp/4p3/2bpPBB1/8/2N2N2/PPP2PPP/R2QK2R b KQ -` | Nc6 | 407 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rn2k2r/ppqbbppp/4p3/1BPpPnB1/1P4P1/5N2/P1P2P1P/RN1QK2R b KQkq -` | a5 | 395 | **KEEP** | sideline, `caro_kann_chapter_9_expanded.pgn` game 4, no negative markers |
| `r1b2rk1/ppq3bp/2n1p1p1/2Pp4/PP6/1N3N2/4BPPP/2RQ1RK1 b - -` | b5 | 386 | NOT-IN-SOURCE | position never appears in any source PGN |
| `1r2kb1r/ppqnppp1/2n3B1/3p2Bp/P2P2b1/1QP4P/1P1N1PP1/R3K1NR b KQk -` | a6 | 348 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3k2r/2qbbppp/2p1p3/p1PpPn2/1P3BP1/2P2N2/P4P1P/RN1QK2R b KQkq -` | g5 | 297 | **KEEP** | sideline, `caro_kann_chapter_9_expanded.pgn` game 4, no negative markers |
| `rnb1k2r/ppq1bppp/4p3/2PpPnB1/2P3P1/5N2/PP3P1P/RN1QKB1R b KQkq -` | Nc6 | 281 | NOT-IN-SOURCE | position seen 1x, but san=Nc6 never played there (sans seen: Qg6) |
| `r3kbnr/pp2pppp/2n5/3p4/3P1qb1/2PB4/PP1NQPPP/R3K1NR b KQkq -` | Nf6 | 257 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kb1r/ppqn1ppp/2n5/3pP1B1/6b1/2PB3N/PP1N1PPP/RQ2K2R b KQkq -` | Nc5 | 247 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqk2r/1p4pp/p2Pp3/3pn3/1P6/8/P4PPP/RN1QKB1R b KQkq -` | Nc6 | 231 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3k2r/2qbbp1p/2p1p3/p1PpPnp1/1P4P1/2P2NB1/P4P1P/RN1QK2R b KQkq -` | h5 | 231 | **KEEP** | sideline, `caro_kann_chapter_9_expanded.pgn` game 4, no negative markers |
| `r1b1k1r1/pp1nq2p/4pp1b/1BPp1n2/1P6/2P1BN2/P4PPP/RN1Q1RK1 b q -` | Nxe3 | 224 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kb1r/ppq1ppp1/2n2n2/3p3p/3P2bB/2PB4/PPQN1PPP/R3K1NR b KQkq -` | e6 | 212 | NOT-IN-SOURCE | position never appears in any source PGN |
| `rn1qkb1r/1p1b1p1p/4p2p/2PpP3/1P6/5N2/P4PPP/RN1QKB1R b KQkq -` | Qc7 | 202 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/pp3ppp/2n1p3/2PpPn2/3B4/2PB4/PP3PPP/RN1QK1NR b KQkq -` | b6 | 199 | NOT-IN-SOURCE | position seen 1x, but san=b6 never played there (sans seen: Nxd4) |
| `r2r2k1/pp3pp1/1q2b2p/4P3/3n1Q2/N4N2/PP3PPP/R3R1K1 b - -` | Nxf3+ | 198 | **KEEP** | mainline, `caro_kann_chapter_9_expanded.pgn` game 4, no negative markers |
| `r1bqkb1r/1p1n1ppp/4p3/p1PpPn2/3B4/2PB1N2/PP3PPP/RN1QK2R b KQkq -` | Nxd4 | 188 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kb1r/3n1ppp/1q2p3/p2pP3/3P4/2NB1N2/PP3PPP/R2QK2R b KQkq -` | Qc7 | 181 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kb1r/ppq2p1p/2n1p2p/2PpP3/8/3B4/PPPNQPPP/R3K1NR b KQkq -` | Bg7 | 179 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/1p1n2pp/4p3/pPPpP3/8/5N2/P4PPP/RN1QKB1R b KQkq -` | d4 | 163 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1b1kbr1/pp1nq2p/5p2/1BPppn2/1P6/2P1BNP1/P4P1P/RN1QK2R b KQq -` | d4 | 161 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r3kb1r/ppq1ppp1/2n2n2/3p2Bp/Q2P2b1/2PB3P/PP1N1PP1/R3K1NR b KQkq -` | b5 | 157 | NOT-IN-SOURCE | position never appears in any source PGN |
| `r1bqkb1r/pp1n1ppp/4p3/2PpPn2/3B4/2P2N2/PP3PPP/RN1QKB1R b KQkq -` | Nxd4 | 152 | **KEEP** | sideline, `caro_kann_chapter_9_expanded.pgn` game 1, no negative markers |
| `r1bqkb1r/pp1n1ppp/4p3/2PpPn2/3B4/2P2N2/PP3PPP/RN1QKB1R b KQkq -` | f6 | 152 | **KEEP** | sideline, `caro_kann_chapter_9_expanded.pgn` game 3, no negative markers |
| `r1b1kb1r/pp1nq2p/4pp2/2Pp1n2/1P6/2P1BN2/P4PPP/RN1QKB1R b KQkq -` | a5 | 151 | NOT-IN-SOURCE | position never appears in any source PGN |

## Proposed actions (SQL written, NOT executed)

### 1. Delete the 74 NOT-IN-SOURCE positions rows

```sql
DELETE FROM positions WHERE repertoire_id = 2 AND id IN (
  28339,28342,28344,28346,28354,28356,28364,28404,28406,28408,28410,28411,28412,28414,
  28417,28454,28463,28465,28467,28481,28483,28516,28519,28521,28526,28536,28565,28568,
  28575,28631,28633,28635,28637,28667,28668,28670,28672,28674,28678,28796,28798,28814,
  28829,28845,28848,28871,28882,28888,28890,28892,28895,28899,28902,28904,28906,28907,
  28909,28911,28912,28936,28939,28941,28942,28945,28947,28949,28951,28953,28955,28959,
  28961,28967,28968,28970
);
```

(These 74 IDs were resolved by exact `fen`+`san` match against `positions` — every one of
the 84 flagged rows had exactly one matching `positions.id`, no ambiguity.)

### 2. Clean up the corresponding book_audit rows (optional, housekeeping)

```sql
DELETE FROM book_audit WHERE repertoire_id = 2 AND (fen, san) IN (
  -- same 74 (fen, san) pairs as above; book_audit has no surrogate id, so match on the pair
  ('r1b1kbnr/ppq1p1p1/2n2p1Q/3p3p/3P4/2PB3P/PP3PP1/RNB1K1NR b KQkq -', 'b6'),
  ('r3kbnr/ppq2ppp/2n5/3pP1B1/6b1/2PB4/PP2QPPP/RN2K1NR b KQkq -', 'Nd4')
  -- ... (see full-row table above for the complete list of 74 fen/san pairs)
);
```

### 3. Do NOT touch these 10 (KEEP)

```
r1b1kbnr/ppq1pppp/2n5/3p4/3P4/2PB4/PP2QPPP/RNB1K1NR b KQkq -   | Bg4
rn2k2r/1pqbbppp/4p3/pBPpPnB1/1P4P1/2P2N2/P4P1P/RN1QK2R b KQkq -| Nc6
rnb1k2r/ppq2ppp/4p3/2bpPBB1/8/5N2/PPP2PPP/RN1QK2R b KQkq -     | O-O
rnb1kb1r/ppq2ppp/4p3/2PpPnB1/6P1/5N2/PPP2P1P/RN1QKB1R b KQkq - | Be7
rn2k2r/ppqbbppp/4p3/1BPpPnB1/1P4P1/5N2/P1P2P1P/RN1QK2R b KQkq -| a5
r3k2r/2qbbppp/2p1p3/p1PpPn2/1P3BP1/2P2N2/P4P1P/RN1QK2R b KQkq -| g5
r3k2r/2qbbp1p/2p1p3/p1PpPnp1/1P4P1/2P2NB1/P4P1P/RN1QK2R b KQkq -| h5
r2r2k1/pp3pp1/1q2b2p/4P3/3n1Q2/N4N2/PP3PPP/R3R1K1 b - -        | Nxf3+
r1bqkb1r/pp1n1ppp/4p3/2PpPn2/3B4/2P2N2/PP3PPP/RN1QKB1R b KQkq -| Nxd4
r1bqkb1r/pp1n1ppp/4p3/2PpPn2/3B4/2P2N2/PP3PPP/RN1QKB1R b KQkq -| f6
```

## Also worth investigating (separate from this ticket)

The 38%-match baseline on the full 616-row tree suggests the underlying ingestion
pipeline (whatever originally built `positions` from these PGNs) and this ad-hoc
triage script disagree on a lot of transpositions/edges that are probably real book
content, just reached a different way than either tool expects. Two follow-ups worth
scoping separately:
- Re-run the same "does this edge independently verify against source text" check
  against the **full** 616-row tree (not just the 84 flagged), and see whether the
  non-matches cluster the same way (Chapter 8 disproportionately worse) or are spread
  evenly — that would tell us whether it's an ingestion-time problem specific to one
  chapter's PGN file, vs. a general transposition-handling gap.
- The comment-in-plain-parens issue (`(the rule, the rule!)` instead of
  `{the rule, the rule!}`) is a source-file quality problem, not just a parsing
  problem — worth a quick regex sweep + manual fix pass on the 7 PGN files themselves
  if they're ever re-imported or re-audited.

## Files

- Working scripts (scratchpad, not repo): `triage2.py` (robust PGN walker +
  classifier), `finalize.py` (84-row classification + clustering + sanity sampling).
- Raw classified CSV: `classified2.csv` / `final_results.csv` (scratchpad).
