# Coach output evaluation (POST /api/analyze/blunder)

Date: 2026-09-24. Read-only on repo source. Test backend :3002 on a DB copy; :3001 and the live DB were not touched.
Model in code: `gemini-2.5-flash` (CLAUDE.md still says 2.0 Flash), prose call `temperature 0.5`, steps call `temperature 0.4`, `thinkingBudget: 0` on both.
Scripts and raw outputs: the session scratchpad (`sample.mjs`, `run.mjs`, `check.mjs`, `results.json`).

## Method

- 32 organic samples from `games.analysis_json` (user moves graded blunder/mistake/inaccuracy with a `bestMove`, from-FEN taken from `game_positions.fen_before`), stratified: 10 opening / 12 middlegame / 10 endgame; 11 Caro-Kann, 9 Jobava London, 12 other; 14 blunder, 9 mistake, 9 inaccuracy. Several are mate/forcing-check positions (S11, S14, S16, S18, S22, S23, S26).
- 5 tricky: T1 stalemate trap (Qc7 stalemates, Qc8# mates), T2 wrongMove == correctMove, T3 one-move mate, T4 missed mate with `wrongMove: null`, T5 illegal `wrongMove`.
- 37 endpoint calls + 1 earlier probe. NOTE: each endpoint call fires 2 Gemini calls (prose, then steps) and up to 3 if step validation fails, so about 75-80 Gemini calls in total, not 40.
- Ground truth: Stockfish depth 14 (local binary) on the FEN before, after the played move, and after the stored best move. chess.js for legality. Every hallucination marked F below was checked mechanically (attackers/defenders/legal-move lists via chess.js) or is a plain-board fact (S14 has a black pawn on h7, not a mate square; T1 is stalemate).
- Criteria. (a) only legal moves; (b) names the best move and agrees with engine direction and severity; (c) no false claims about pieces, squares, tactics or material; (d) explains the why at a 1400-1800 level, not just restating the move. P = pass, ~ = partial, F = fail.
- Caveat: pass/fail on (c) and (d) is my judgment, checked against the board where possible. (a) is nearly all P because the server drops illegal step SANs before returning; illegal or false claims survive in prose and captions.

## Sample table

| ID | Phase | Grade | Played -> Best | (a) legal | (b) best/direction | (c) no halluc. | (d) why | Note |
|---|---|---|---|---|---|---|---|---|
| S01 | mid | mistake | a5 -> a6 | P | P | F | F | Invents a "safe square for your Queen on b7"; a6 "supports b6" (it does not). Real point: a6 hits the Nb5. |
| S02 | open | inacc | c3 -> Bd2 | P | F | F | F | Claims c3 hangs to Qxc3+. c3 is defended by b2 and Nb1; Qxc3+ loses the queen. Says "immediately loses material". Engine: loss ~0.7. |
| S03 | end | inacc | Ke7 -> Kf6 | P | P | ~ | ~ | Kf6 "supports pawns on a5" (5 files away). SF loss 0.05, presented as a real error. |
| S04 | open | inacc | Nb5 -> e3 | P | P | F | ~ | "Nd7 ... attacking b5" is false (Nd7 does not attack b5). "Nb5 doesn't attack any enemy piece" is wrong (a7, c7 pawns). SF loss 0.02. |
| S05 | open | inacc | c6 -> Nf6 | P | ~ | P | ~ | Generic; SF prefers d5 over stored Nf6, loss 0.24. |
| S06 | open | blunder | Bf4 -> e4 | P | P | P | ~ | Position is +4 for the student; coach never says so, treats it as a slow-move lecture. |
| S07 | open | mistake | Bxc7 -> Nxd5 | P | ~ | F | F | "Nxd5 attacks the queen" false (queen on h4 is not attacked). "Nd7 punishes your exposed bishop" false. Bxc7 still keeps +4. |
| S08 | mid | blunder | Qxc4+ -> exd5 | P | P | ~ | P | Correct core (Nxc4 wins the queen); "opens the e-file for your King" is filler. |
| S09 | mid | blunder | O-O -> d4 | P | P | F | ~ | Step says "Ne4 attacking your Queen" (Ne4 does not hit d8). Misses the real point: d4 forks Qe3 and Nc3. |
| S10 | open | mistake | Bg5 -> e4 | P | P | ~ | ~ | "challenges Black's central pawn on d7" is misleading (e4 does not touch d7). |
| S11 | end | blunder | Qa5 -> Qe3+ | P | P | ~ | F | Vague ("allow White to develop their attack, e.g. f5"). Engine refutation is Rd7 (-7.6 swing); never mentioned. SF top is Qc5+. |
| S12 | mid | inacc | Bxc5 -> Qxc5 | P | F | ~ | F | Prose says Bxc5 is "safe for your Bishop", steps say Na4 attacks the queen. They contradict each other. Engine: Bxc5 loses a piece to Na4 (fork), -2.7. |
| S13 | mid | mistake | Be5 -> Bxc4 | P | ~ | F | ~ | "Immediately loses material": Nxe5 dxe5 is a trade. "opens the d-file for your queen" false (own pawn on d4). |
| S14 | mid | blunder | Nf5 -> Qh5+ | P | P | F | ~ | "Qh5+ ... threatening checkmate on h7". h7 holds a black pawn; there is no mate threat. Loss is only 0.6. |
| S15 | mid | blunder | Nf4 -> Nf6 | P | P | P | P | Clean: hanging knight, correct attackers. |
| S16 | end | blunder | Rc7 -> Rc8+ | P | P | P | P | Clean. |
| S17 | mid | mistake | Nxe5 -> Nb6 | P | P | ~ | ~ | "dxe5 winning your knight" after the student captured a knight first (it is a trade); the real problem, the pawn hitting Bf6, is not stated. |
| S18 | mid | blunder | Ne4+ -> Qh2+ | P | P | P | ~ | Correct, thin why. |
| S19 | open | mistake | Bf4 -> e4 | P | ~ | ~ | ~ | Engine says the two moves are equal (0.01). Coach lectures on the center. Step 2 (refutation) was silently dropped: only 3 steps. |
| S20 | open | blunder | Qe7 -> h6 | P | P | ~ | F | Wrong reason: "h6 gives your king a flight square on h7". Real reason: h6 hits the white g5 pawn. Misses Bf3. |
| S21 | mid | blunder | O-O -> Qb5 | P | ~ | F | F | "Nb6 attacking your Queen on a5" false (b6 knight does not attack a5). SF top is O-O-O, not Qb5. |
| S22 | mid | inacc | Nc3 -> Bh5+ | P | ~ | P | ~ | "misses a critical tactical opportunity" for a 0.2 pawn difference; recommends a bishop it admits is hanging. |
| S23 | end | blunder | R1b7+ -> Qxd5+ | P | F | F | F | False positive. Both moves mate in 4. Coach says the played move "doesn't create any lasting advantage" and that Qxd5+ "gains material". |
| S24 | end | mistake | Rf2 -> Re2+ | P | P | P | ~ | Correct, thin why. |
| S25 | mid | inacc | Nxd7 -> Nc6 | P | ~ | F | ~ | "loss of material": Nxd7 Qxd7 is a knight-for-knight trade. |
| S26 | open | blunder | Bc4 -> Qh5+ | P | P | F | F | Misses the tactic (Qh5+ then Qxe5+ fork; the Bb5 was attacked by a6, and Bc4 only saved it). "Nc6 attacking d5" false. |
| S27 | end | blunder | Nxg4 -> Rxd8 | P | P | P | ~ | Correct but shallow. |
| S28 | open | blunder | e6 -> Nd6 | P | P | F | F | "e6 pawn is attacked by Bc4 and has no defenders". It is defended by f7 and Bc8; Bxe6 loses a piece. |
| S29 | end | mistake | f6 -> Nd5 | P | P | F | ~ | "Rxf6 winning material": f6 is defended by g7. The good part is right (Nd5 defends f6 and hits Rb6/Re7). |
| S30 | end | inacc | Kd1 -> Bb4 | P | ~ | F | F | Engine says equal (0.03). "Kc8 brings king closer to center" is backwards. Vague. |
| S31 | end | inacc | b6 -> Ra1 | P | P | ~ | F | "Rd7 eyeing your d-pawn" (it is Black's own pawn); no real why for Ra1. |
| S32 | end | mistake | Rhd8 -> Kxd7 | P | ~ | F | F | Violates the prompt's own rule 1 (restates the move). "Nb8 creating a discovered attack on your queen" false. SF top is Qxe2. |
| T1 | end | blunder | Qc7 -> Qc8# | P | F | F | F | Qc7 is STALEMATE. Coach says "the game continues" and "Black's king is safe". Never notices. |
| T2 | open | inacc | Nf3 == Nf3 | ~ | P | ~ | ~ | Says "actually the best move" in the analysis, but steps say "Better was Nf3". Lists "e5" as a reply that is already on the board. |
| T3 | end | inacc | Qb7 -> Qb8+ | P | P | P | P | Correct (note: this is a mate-in-1, so not a true "already won" test). |
| T4 | mid | blunder | null -> Rd8# | P | P | P | P | Correct. |
| T5 | open | mistake | Qd5(illegal) -> e4 | P | P | P | ~ | Prose says "Qd5 is invalid", steps 3 with junk first step. Server does not reject it. |

Tallies over the 32 organic samples:
- (a) legal: 32/32 P (steps are legality-filtered server-side; prose SANs were also all legal).
- (b) best move named: 32/32 mention the stored best move; agrees with engine direction and severity: 20 P, 9 ~, 3 F (S02, S12, S23; T1 also fails among the tricky set). SF's top move differs from the stored best in 4 of 32 (S05, S11, S21, S32).
- (c) hallucination: 15 F (47%), 8 ~ (25%), 9 P (28%).
- (d) explains the why: 3 P (9%), 16 ~, 13 F (41%) among organic. Fewer than 1 in 10 is a clean, useful explanation.
- Including the 5 tricky: 16 of 37 outputs (43%) contain at least one verifiably false claim.

## Overall hallucination rate

Roughly 45-50% of coach outputs contain at least one verifiably false statement about pieces, attacks, defense, or material, and only about 28% are clean. The dominant patterns: (1) inventing that a piece is attacked or undefended (S02, S28, S29), (2) claiming a knight/bishop "attacks" a piece it does not (S04, S07, S09, S21, S26), (3) fictional mate threats or discovered attacks (S14, S32), (4) treating a trade as a loss (S13, S25), (5) missing the actual tactic (S09, S11, S20, S26).

## Latency and failure behavior (criterion e)

- 37 calls, all HTTP 200: min 2.4 s, median 2.9 s, p90 3.5 s, max 3.7 s. One earlier cold probe took 10.5 s, longer than the client's 10 s timeout in `src/services/api.ts`. Pipeline is serial: Lichess masters fetch (up to 4 s), then the prose Gemini call, then the steps Gemini call, with one retry on failure. Worst case is 4 + 3 x Gemini latency with no server-side timeout on any Gemini `fetch`.
- Steps validation drops single bad beats instead of failing, so two of 37 outputs (S19, T5) shipped with 3 beats and a broken story (no refutation beat).
- Gemini API error, missing key, or network failure returns HTTP 200 with `{analysis: "Coach unavailable ...", concept: ""}`. On the UI, `.then(setAnalysis)` runs, so the error string is rendered inside the "Coach Analysis" card as if it were the coach. The `error` state and its fallback ("Engine recommends X") only run on HTTP failure or the 10 s client timeout.
- Malformed body, empty body, or an invalid FEN gives a bare HTTP 500 `{"error":"Internal server error"}` (no validation, `fen.split` throws). The UI's fallback shows correctly, but there is no log context.
- UI race: `BlunderExplanation`'s `useEffect` has no cancel/abort, so a slow response for a previous FEN can overwrite the current card's analysis.
- Nothing is cached, so every reveal (and every Replay/re-mount) pays 2-3 Gemini calls again for an identical (fen, wrongMove, correctMove).

## Findings

### F1. "OPPONENT'S BEST REFUTATION (computed)" is a heuristic, not a refutation. Severity: High. Effort: S-M
Evidence: `analyze.ts` (`explainBlunder`) picks the first legal capture of the moved piece regardless of defenders, else the first 5 legal moves alphabetical-ish. S02 (Qxc3+ loses the queen to bxc3) and S28 (Bxe6 loses a piece to fxe6) were narrated as real refutations in both prose and step beat 2. The "sample of legal replies" case produces arbitrary beats (S19/S26/S30 "Black can respond with Nc6 / Rb8 / Kc8"), and the prompt tells the model to treat this as ground truth.
Fix: compute the refutation with Stockfish (server already has `StockfishEngine`) at depth 14-16: best reply plus 2-3 ply PV, and eval swing. If the played move does not lose more than ~0.5 pawn, say so and do not invent a refutation.

### F2. The model is never given engine evaluations. Severity: High. Effort: M
Evidence: Prompt contains only `cpLoss` and static board facts. Consequences: S23 (both moves mate in 4; coach calls the played move a lesser move), S19/S30/S03/S04 (SF loss under 0.3 pawn, presented as errors), S12 (prose says the bishop capture is "safe"; it drops a piece), S25/S13 (trades called material loss), T1 (stalemate, never flagged).
Fix: feed eval before, after played, after best (from the mover's POV), the best line in SAN, mate distance, and explicit flags (`isStalemate`, `isCheckmate`, `playedMoveLosesMaterial`). Instruct: if loss < 0.3 pawn, say "close call, both fine" and pivot to plan/why.

### F3. Stored `cpLoss` and `bestMove` are noisy and reach the coach as fact. Severity: Medium-High. Effort: M
Evidence (depth-14 SF vs stored depth-12): 21 of 32 sample rows have stored cpLoss differing from my re-eval by more than 1 pawn (e.g. S09 stored 12.4 vs 1.3, S14 5.3 vs 0.6, S23 stored 20.0 vs 0.0, S28 4.0 vs 0.7); 5 of 32 (16%) have real loss under 0.3 pawn (S03, S04, S05, S19, S23); the stored best differs from SF top in 4/32 (S05, S11, S21, S32). Caveat: my eval is one depth and two evals per row; treat as indicative, not exact. This also affects the drill pool (v2_train_now.ts), not just the coach.
Fix: before explaining (or at drill-pool build time), re-verify with a deeper multi-PV pass and drop or re-label rows where loss < threshold, or where stored best is not top-1 at depth 18+. The Challenge button already does this on demand.

### F4. No post-generation verification of claims. Severity: High. Effort: M
Evidence: "X attacks Y" and "Y is undefended" false claims in 15 of 32 outputs (S04, S07, S09, S21, S26, S14, S32, S28...). Prompt rule 4 says only verified facts may be claimed, but the model ignores it because it has no way to check.
Fix: parse the output for `(White|Black) <piece> on <sq>` and "attacks/defends/hangs" claims and SAN tokens; check with chess.js (`attackers()`, legal moves); on failure regenerate once and then fall back to a deterministic template built from engine facts (F1/F2). Cheap and closes most of the (c) failures.

### F5. Two independent Gemini calls (prose then steps) can contradict each other and double cost/latency. Severity: Medium. Effort: M
Evidence: S12 (prose: capture is safe; steps: Na4 attacks the queen), T2 ("actually the best" vs "Better was Nf3"), S19 (3 beats). Serial execution adds the steps call latency on top of the prose call; the client aborts at 10 s while the server keeps working.
Fix: one call returning `{concept, analysis, steps[]}`, `responseMimeType: "application/json"` plus a `responseSchema`, or run the two in parallel. Add `AbortSignal.timeout(6000)` to every Gemini and Lichess fetch.

### F6. Failure is rendered as coach content. Severity: Medium. Effort: S
Evidence: Gemini error / no key / network error returns 200 with a "Coach unavailable" string in `analysis`, and `BlunderExplanation.tsx` shows it in the Coach Analysis card (the `error` fallback is never hit). Fix: return a non-2xx (or `{error: true}`) so the UI shows the existing "Engine recommends X" fallback; also add an `AbortController` to the effect (race on fast Next/Replay) and validate `fen`/`correctMove` and return 400.

### F7. Degenerate inputs are not short-circuited. Severity: Low-Medium. Effort: S
Evidence: T2 (`wrongMove === correctMove`) produced a full lecture and a step that says "Better was Nf3" for the same move; T5 accepted an illegal wrongMove and produced junk steps; T1 stalemate was not detected by the fact-computation (`computeMoveFacts` reports check/mate but not stalemate). Fix: in `explainBlunder`, return early for wrong == correct; validate wrongMove legality; add `isStalemate()` and draw flags to move facts.

### F8. Silent beat dropping breaks the story structure. Severity: Low-Medium. Effort: S
Evidence: S19 and T5 returned 3 beats; the prompt assumes 4 with a fixed role for each index (`resetIndices` in the validator assume position). Fix: if the refutation beat is dropped, drop the beat that depends on it (or reject and retry); require beat count and roles (wrong / punish / better / why) in the validator, not just length 2-6.

### F9. No caching. Severity: Low (cost/latency). Effort: S
Evidence: every reveal re-runs 2-3 Gemini calls. Fix: cache by `(normalizedFen, wrongMove, correctMove, promptVersion)` in a new table; invalidate on prompt/model change (per CLAUDE.md's "clear stale outputs" rule).

### F10. Prompt-level weaknesses. Severity: Medium. Effort: S
- Output length and register are underspecified for a 1400-1800 audience: prose is 2-3 sentences of filler ("develops a piece", "opens lines") and many outputs never state the concrete why (only 3 of 32 do).
- Rule 1 forbids restating the move but says nothing about what to do when there is no tactic. The model fills the gap with invented tactics.
- "Refutation" section is labeled ground truth even when heuristic (F1).
- Prose prompt asks to "hit all three points" (correct move benefit, wrong move consequence, principle), which forces a fabricated consequence when there is none.
- Steps prompt example uses fabricated moves (`Nxe5 ... Qa5+`) that models may pattern-copy.
- Temperature 0.5 with thinking disabled encourages loose claims; chess reasoning benefits from a small thinking budget (e.g. 512-1024) or from being handed the engine PV instead.

### F11. Doc drift. Severity: Low. Effort: S
CLAUDE.md says Gemini 2.0 Flash and the coach is not persisted; code uses 2.5 Flash. Update when the prompt is revised.

## Proposed prompt (replaces both prose and steps prompts)

Server first computes the FACTS block from Stockfish + chess.js; the model only narrates it.

```
You are a chess coach for a 1400-1800 club player. Explain ONE move. You are a narrator of
engine facts, not an analyst: every claim about an attack, defense, capture, check, or
material MUST be copied from the FACTS block. If FACTS does not support a claim, do not make it.

STUDENT: plays {Color}. Their pieces: {roster}. Opponent pieces: {roster}.
POSITION (FEN): {fen}
PIECES: {full piece list with colors and squares}

FACTS (engine depth {d}, computed, treat as ground truth):
- Eval before the move (student POV): {e0}
- After the played move {wrong}: {e1}   (loss: {loss} pawns; severity: {close_call|inaccuracy|mistake|blunder|decisive})
- After the best move {best}: {e2}
- Best line: {best_pv_san}
- Best reply to the played move: {reply_san}. Line: {refutation_pv_san}
- Played move: lands on {sq}; attacked by {attackers}; defended by {defenders}; captures {piece|nothing}; gives {check|no check}
- Best move: lands on {sq}; attacked by {..}; defended by {..}; captures {..}; gives {..}; attacks {pieces}
- Material after best line: {+/-}. Mate in {n} for {side} if any. Stalemate/draw flags: {..}
- Masters: {top moves and %, or "none"}

RULES
1. Name only pieces and squares in PIECES or FACTS. Never use a piece/square not listed.
2. Never write "attacks", "defends", "hangs", "wins", "forks", "pins", "threatens mate" unless
   FACTS states it. Do not add + or # unless FACTS says check or mate.
3. If severity is close_call (loss < 0.3): say both moves are fine and give ONE practical reason
   to prefer {best}. Do NOT invent a tactic or refutation.
4. If the played move equals the best move, say it was correct and why. If it is illegal, say so.
5. Do not restate the move as the explanation. State what the best move DOES (uses a fact) and
   what the played move ALLOWS (uses the "best reply" fact).
6. Speak to the student as "you". Max 55 words in "analysis"; captions max 14 words each.

OUTPUT: JSON only, no fences:
{
  "concept": "<one specific concept, not 'tactics'>",
  "analysis": "<max 55 words: (1) what {best} does, (2) what {wrong} allows via {reply_san}, (3) one principle for this pattern>",
  "steps": [
    {"text": "...", "action": {"type": "playMove", "san": "{wrong}", "highlight": "red"}},
    {"text": "...", "action": {"type": "playMove", "san": "{reply_san}", "highlight": "red"}},   // omit if close_call
    {"text": "...", "action": {"type": "playMove", "san": "{best}", "highlight": "green"}},
    {"text": "...", "action": {"type": "highlight", "squares": ["..."], "color": "blue"}}
  ]
}
The SANs in steps are FIXED by the server: {wrong}, {reply_san}, {best}. Do not choose other moves.
```

Notes on the design: the server, not the model, chooses the SAN moves in steps (removes illegal/arbitrary beats and the contradiction between the prose and steps calls); one call replaces two; temperature 0.2; thinkingBudget 0 is fine once facts are supplied. Follow with the F4 verifier (regex claims + chess.js) and a template fallback.

## Positions Kevin should spot-check manually

Load these on a board (FEN before the played move) and compare to the coach text in `results.json` (id in the first column):

| ID | FEN | Why check |
|---|---|---|
| S02 | `rnb1kbnr/pp1ppppp/8/q1p5/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq - 2 3` | c3 is fine (defended); coach says it loses a pawn. Also White is in check. |
| S28 | `rnbqkb1r/pp2pppp/2p5/8/2B1n3/5N2/PPPP1PPP/R1BQ1RK1 b kq - 1 6` | e6 is defended; coach says Bxe6 wins a pawn. |
| S12 | `r3kb1r/p4ppp/1q2pn2/2Pp4/8/1PN2Q1P/P1P2PP1/R1B2RK1 b kq - 0 12` | Prose says Bxc5 is safe; it loses a piece to Na4. |
| S23 | `1R2b3/5kp1/5p1p/2Qp4/p2N4/4P3/5PPP/1R4K1 w - - 0 30` | Both moves mate in 4; graded blunder cpLoss 20.0. False positive in the data. |
| T1 | `k7/8/1K6/8/8/8/8/2Q5 w - - 0 1` | Qc7 is stalemate; coach says the game continues. |
| S26 | `rnbqkbnr/2pp2pp/p7/1B1Pp3/4p3/8/PPP2PPP/RNBQK1NR w KQkq - 0 6` | Coach misses Qh5+ (wins a rook via Qxe5+) and the Bb5 hanging to a6. |
| S09 | `r1bqk2r/1p2bppp/p1n5/3p4/8/2N1Q3/PP1P1PPP/R1B1K1NR b KQkq - 3 11` | d4 forks Qe3 and Nc3; coach only mentions the queen and invents "Ne4 attacks your Queen". |
| S14 | `r2qk1nr/7p/p2p1p2/2pp4/3N4/4P3/PPP2PPP/R2QK2R w KQkq - 0 13` | "Threatening checkmate on h7" is false. |
| S21 | `r3k2r/pp3ppp/3b4/q2NnP2/8/2P4P/PP3P2/R1BQK2R b KQkq - 0 14` | "Nb6 attacks your queen on a5" is false; SF prefers O-O-O over the stored Qb5. |
| S19 and S30 | see `samples.json` | Engine calls these equal (loss ~0.01-0.03), but they are in the "mistake/inaccuracy" pool; they will feed the drill pool. |
| S15, S16 | see `samples.json` | Clean outputs; use as a baseline for what "good" looks like. |

## Rerun after fix (2026-09-24)

Harness: `scripts/coach_fixture_eval.ts` over the 32 audit positions plus 3 tricky cases (T1 stalemate, T2 same-move, T5 illegal wrong move), cold in-memory cache, real Gemini 2.5 Flash, real Stockfish depth 14, masters disabled. Base commit 01ef745.

```json
{ "total": 35, "status200": 34, "non200": ["T5-illegal-wrong:400"], "model": 4, "template": 30,
  "templateReasons": {"verifier-rejected-twice": 29, "other": 1}, "allStepsLegal": true,
  "medianMs": 3001, "maxMs": 7486, "geminiCalls": 63 }
```
(block predates the bucket fix; the `other: 1` is the T2 same-move card)

Success criteria: T1 returned 200 with model text that names the stalemate; T2 returned the same-move template with 0 Gemini calls; T5 returned 400; every row's steps were legal; max latency 7486ms (under the 9s budget).

### Headline: template share first

**29 of 32 organic outputs (91%) fell back to the deterministic template; 3 were model-written** (S11, S27, S32). Of the 35 cases, 30 were templates (29 verifier-rejected-twice plus the T2 same-move card), 4 model (the 3 organic plus T1), 1 non-200 (T5 -> 400, expected). No Gemini call returned null or timed out. S27 was model-written in the full run but came back as a template on a re-run (Gemini is nondeterministic at temperature 0.2).

The rejections are overwhelmingly "unverifiable claim" (the verifier default-denies anything it cannot check), not proven-false claims. Representative rejected clauses that are actually TRUE: S11 "the best move Qe3+ gives check to the White king on g1"; S29 "Nd5 attacks White's rooks on e7 and b6"; S15 "Keep your pieces safe" (generic principle). So the verifier is safe but over-strict.

### Top violation shapes (raw counts, squares and pieces normalised)

1. `unverifiable claim: "The best move <sq> gives check to the Black <piece> on <sq>"` - 6
2. `unverifiable claim: "<sq> attacks <sq>"` - 5
3. `unverifiable claim: "<sq> captures a <piece> and attacks the Black <piece> on <sq>"` - 5
4. `mentions check but no move gives check` - 4
5. `unverifiable claim: "The best move <sq> captures a <piece> and attacks White's <piece>..."` - 4
6. `unverifiable claim: "The best move <sq> attacks the White <piece> on <sq>"` - 3
7. `unverifiable claim: "which attacks your <piece> on <sq>"` - 3
8. `unverifiable claim: "<sq> attacks the White <piece> on <sq>"` - 3
9. `unverifiable claim: "<sq> attacks White's <piece> and <piece>"` - 3
10. `unverifiable claim: "The best move <sq> gives check to the White <piece> on <sq>"` - 3
11-15. generic advice sentences ("Focus on moves that improve your pieces", "Attack White's pieces to improve yours", "Your <piece> attacks the <piece>", "Keep your <piece> active", "Your move <sq> allows White's <piece> from <sq> to <sq>") - 2 each

Most rejections are "unverifiable claim" on attack/check statements and generic advice, not proven-false statements. Candidates for tuning (controller decision, nothing changed here): the verifier's handling of "<sq> attacks <sq>" style claims and generic advice, and the prompt.

### False-claim grading (independent of the verifier, chess.js checks)

| Group | Audit baseline (old pipeline) | Rerun |
|---|---|---|
| Organic (32 positions) | 15/32 (47%) had a false statement | 0 verifiably false among 31 gradable: 2 model (S11, S32) + 29 template. 1 organic model output (S27) is ungraded because its text was not captured |
| Tricky cases (separate) | n/a | T1 model output graded: 0 false ("Qc7 stalemates", "Qc8# checkmates" both true). T2 is the same-move card (no model). T5 returned 400 |

Model claims checked: S11 "Qa5 attacks the rook on d2", "Qe3+ gives check", "Rd7 attacks pawns a7 and g7" (all true); S32 "Rhd8 attacks the knight on d7", "Kxd7 captures the knight", "both moves are fine" (true; engine eval 566 -> 533). Templates were regenerated deterministically and each "allows X" / "captures your Y" / "gives check" was read against chess.js.

**Caveat: this is not a like-for-like rate.** The 15/32 baseline came from the old pipeline where every output was free model prose. Now 29 of 32 organic outputs are templates that are correct by construction, so 0 false claims for them is nearly guaranteed. The only evidence about model-written text after the fix is 2 graded organic outputs (plus T1), which is too few to estimate a rate. Treat the result as "the verifier let no false text through in this run", not "false claims fell from 47% to 0%".

### Latency and spend

Median 3001ms, max 7486ms per case. Gemini calls: 63 in the full run plus 6 in a re-run of the four model cases to capture their text (69 total, under the 80 cap). The re-run is nondeterministic (S27 flipped from model to template).

Raw per-case records live in the session scratchpad, not the repo.
