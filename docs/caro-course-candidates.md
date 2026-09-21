# Free Caro-Kann Lichess Studies — Candidate Survey (2026-09-18)

Context: Kevin plays chess.com rapid at ~1400-1800 and uses the Caro-Kann as his main
defense to 1.e4. His current book/repertoire only covers the **Exchange Variation**
(ch. 8) and one sideline family (ch. 9 — likely vs. 6.Bxh6/Be2/Qd2/a3 systems). Goal:
find a free lichess study that fills the gaps — **Advance, Panov, Classical/Main Line,
Fantasy, and other sidelines** — ideally as a full repertoire rather than another
Exchange deep-dive.

Method: searched reddit/web for recommendations, then verified each candidate by pulling
its public PGN export (`https://lichess.org/api/study/<id>.pgn`) and inspecting chapter
titles/scope directly — no login required for public studies.

## #1 Recommendation — The Caro Kann Defence: Complete Repertoire (Shreksify)

- **URL:** https://lichess.org/study/MBQ3N0F8
- **Author:** Shreksify
- **Chapters:** 60
- **PGN export:** Works. `200 OK`, ~426 KB.
- **Scope:** True full repertoire, not just theory —
  - Exchange Variation (Rubinstein main lines + sidelines with Nf3/Nc3)
  - Panov-Botvinnik Attack (Fianchetto Defence, Standard Defence, QGD structure)
  - Classical Variation (Capablanca, Tartakower/Korchnoi, Bronstein-Larsen,
    Karpov/Smyslov-Petrosian, Finnish, Grünfeld/Modern)
  - Advance Variation (main line Bf5 move order + sidelines, Botvinnik-Carlsbad
    Defence main line + sidelines)
  - Two Knights Attack (Tartakower, Karpov, Classical, Dano-Russian, Rozman variations)
  - Accelerated Panov, Fantasy-Tartakower, catch-all sidelines
  - Plus: 5 "Do's and Don'ts" middlegame-plan chapters (both colors' perspective),
    9 instructive master games (Kasparov, Karpov, Carlsen-Firouzja, Anand, etc.),
    5 tactical puzzle chapters
- **Why #1:** This is the only candidate that is genuinely comprehensive across every
  line Kevin needs (Advance, Panov, Classical, Fantasy, Two Knights, sidelines) *and*
  goes beyond raw theory into plans and instructive games — exactly the kind of
  scaffolding a 1400-1800 player needs to actually understand the resulting middlegames,
  not just memorize moves. Well-organized numbered chapters make it easy to import
  selectively (e.g., skip ch. 1-3 Exchange since Kevin already has that covered, start
  at ch. 4 Panov-Botvinnik).
- **Community regard:** No specific reddit threads found praising it by name, but it
  surfaces at the top of every "best free caro-kann lichess study" and "complete
  repertoire" search, and Shreksify has a second, complementary study (see runner-up).
  Author credentials not verifiable (no titled/rated info found), but the depth and
  structure speak for themselves.

## Runner-up — Caro-Kann - Interactive Lesson - Complete Repertoire (Shreksify)

- **URL:** https://lichess.org/study/BR22mPv3
- **Author:** Shreksify (same author as #1 — complementary product, not a duplicate)
- **Chapters:** ~55 (heavily split into narrow, deep sub-lines)
- **PGN export:** Works. `200 OK`, ~210 KB.
- **Scope:** Same overall coverage as #1 (Advance, Exchange, Panov, Fantasy, Classical,
  Two Knights) but formatted as an **interactive "guess the move" quiz/drill study**
  with much deeper move-tree granularity — especially strong on Advance Variation
  sub-branches (g4!?, h4, Nf3 e6 c4 lines, c5!? gambit tries) and rare White sidelines
  (2.Bc4!?, 2.d3!?, 2.Nc3 Qe2!?) that #1 doesn't drill as deeply.
- **Why runner-up, not #1:** Interactive-quiz format is great for *drilling* moves
  Kevin already understands the plans for, but weaker as a first-pass learning
  resource since it's less narrative/explanatory than #1. Best used as a companion —
  read #1 for plans/understanding, then use this one for move-order drilling (which
  overlaps nicely with Chess Forge's own SM-2 drill philosophy).
- Note: a private/older version of this same author's interactive study
  (`lichess.org/study/rB7wrDVY`, "Caro Kann - Interactive - Complete Repertoire") returned
  `401 Unauthorized` on export — not publicly accessible, skip it.

## #3 — Caro-Kann Defense Repertoire (NM Mr_Penings)

- **URL:** https://lichess.org/study/PDVt7Kbh
- **Author:** Mr_Penings — verified **National Master** (US), active lichess
  content creator (also runs a "Chess Openings Mastery" team/series and has titled
  simuls). Best-credentialed author of the candidates checked.
- **Chapters:** 38
- **PGN export:** Works. `200 OK`, ~49 KB (much lighter than #1/#2 — fewer sub-line
  branches, more thematic explanation).
- **Scope:** Covers everything needed — sidelines (2.c4 Panov, 2.c4 Panov-Botvinnik
  part 2, Nf3+Nc3, 2.f4, 2.d3 KIA, the "Penings-He Gambit"), main lines (3.f3 Fantasy,
  3.Nc3/Nd2 across 4 parts = Classical/Two Knights family, 3.e5 across 3 parts =
  Advance, 3.exd5 and 4.Bd3 = Exchange), plus an intro, 5 "Important Themes" chapters,
  and 11 annotated GM games (Capablanca, Nimzowitsch, Petrosian, Nakamura, Polgar,
  Anand, etc.).
- **Why #3, not #1:** Much more concise and thematic — good as an introductory pass
  before tackling Shreksify's exhaustive tree — but noticeably lighter on move-by-move
  depth (49 KB vs. 426 KB) so it will run out of concrete lines faster in practical
  games. The titled authorship is a real plus for trustworthiness, but for filling
  Kevin's specific gaps (deep Advance/Panov/Classical coverage) the Shreksify study is
  more useful long-term.

## Also checked, not recommended

- **"Crush 1.e4 with the Caro-Kann! Full Repertoire!"** (ST123_stsoham_Chess) —
  https://lichess.org/study/oWZx54ef — PGN exports fine (200 OK, 38 KB) and covers
  Exchange/Panov/Advance/Classical(Tartakower only)/Fantasy/Two Knights plus a large
  fun "random sidelines" section (Hillbilly Attack, Rasa-Studier Gambit, etc.), but the
  Classical coverage is thin (only Tartakower, no Karpov main line) and the whole study
  is casual/beginner-toned (emoji chapter titles, jokey commentary) rather than a
  rigorous reference. Fine as a light intro, not a primary source.
- **"The Complete Caro Kann Repertoire"** (KushagraT) —
  https://lichess.org/study/XALGRVtx — PGN exports (200 OK) but only **6 chapters,
  4.8 KB total** — despite the title, this is a bare skeleton, not remotely complete.
  Skip.

## 5-line summary

Top pick: **Shreksify's "The Caro Kann Defence: Complete Repertoire"**
(lichess.org/study/MBQ3N0F8) — 60 chapters, genuinely covers every gap (Advance,
Panov, Classical, Fantasy, Two Knights) plus plans/instructive games/puzzles, PGN
export confirmed working (~426 KB). Runner-up: Shreksify's companion interactive-quiz
study "Caro-Kann - Interactive Lesson - Complete Repertoire" (BR22mPv3) for drilling
the same lines move-by-move, export confirmed working (~210 KB). Both export cleanly
with no auth required; a third option by NM Mr_Penings (PDVt7Kbh, ~49 KB) is more
concise/thematic and has verified titled authorship, worth a look if #1 feels
overwhelming.
