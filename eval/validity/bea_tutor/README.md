# bea_tutor — BEA tutor-move scorer (EV-3b)

A **Tier-2 validity tool**. It reads a finished lesson bundle and scores its
authored **tutor moves** — the scaffolding the bundle ships (quiz `hints`,
`feedback_incorrect`, `feedback_correct`) — against BEA's verbatim 8-dimension
pedagogical rubric, emitting a per-move `BeaCard`.

It does not touch the eval harness, the auditor, or the runtime: it reads a
bundle and asks one question the auditor does not ask:

> When the lesson scaffolds the learner, is the move pedagogically sound — and,
> above all, does it **avoid revealing the answer**?

## What it scores

- **Now — authored scaffolding (no runtime needed).** Each quiz scene's `hints`
  become `scaffold_hint` moves (replying to the `question` signal),
  `feedback_incorrect` becomes an `acknowledge_extend` move (replying to a
  `justification`), and `feedback_correct` becomes a `probe_synthesis` move
  (replying to `synthesis`). Each move's **banned** answer set = its own quiz's
  correct choice text(s) + `feedback_correct`, so a hint that states the answer is
  flagged. See `loaders.authored_scaffolding_moves`.
- **Later — live tutor turns.** The `TutorMoveRecord(source="live")` shape already
  supports scoring live `--log-tutor-text` sidecar turns; that loader is deferred
  to a follow-up (needs a `--live-tutor` run to exist).

## The 8 BEA dimensions and the determinism split (spec §4)

Dimension names are **verbatim BEA** (never renamed) so per-move cards are
comparable against MRBench / MathTutorBench.

| # | BEA dimension | Verdict | Deterministic heuristic |
|---|---|---|---|
| 1 | mistake_identification | LLM-gated (lexical floor det.) | floor: error/negation cue present AND lexical overlap with the learner turn; quality → LLM |
| 2 | mistake_location | LLM-gated | floor: pointer token overlaps a span of the learner turn; precise localization → LLM |
| **3** | **revealing_answer (PENALTY)** | **DETERMINISTIC** | `reveals_answer()`: normalized-substring OR token-Jaccard ≥ θ vs the banned set. `revealed=True` is *bad* (`score=1.0`). The headline. |
| 4 | guidance | LLM-gated (lexical floor det.) | floor: a strategy/next-step cue present AND not a reveal; quality → LLM |
| **5** | **actionability** | **DETERMINISTIC** | next-step detector: imperative verb (FR/EN: *try/consider/test/essaie/compare*) or modal ("what if" / "et si"). Pure regex. |
| 6 | coherence | LLM-gated (lexical floor det.) | floor: lexical overlap with the learner turn (engages *this* turn); quality → LLM |
| 7 | tone | LLM-gated (det. red-flag screen) | det. screen: insults / all-caps shouting → gate to `0.0`; positive tone → LLM only |
| 8 | human_likeness | LLM-gated | — (no honest deterministic proxy) |

**Summative-safe now:** #3, #5, the lexical floors on #1/#2/#4/#6, and the #7
red-flag screen.
**Formative-only until the EV-5/D16 human-agreement study:** the quality halves
of #1/#2/#4/#6, positive #7, and all of #8. Those dims carry `score=None`,
`mode="llm_formative"`, `gated="EV-5"`, plus a deterministic `floor` (0.0/0.5),
and are **non-gating** until EV-5 promotes them.

## Reveal-rule parity with the runtime

`reveal_rule.py` is a **behaviour-identical Python mirror** of the runtime
guardrail `packages/lesson-session/src/socratic-tutor/reveal.ts`, so what the
tutor **enforces online** is exactly what this eval **scores offline**. The two
implementations are pinned to a **shared cross-language fixture**
(`fixtures/reveal_parity.json`), asserted by both `tests/test_reveal_parity.py`
(Python) and `src/socratic-tutor/reveal.parity.test.ts` (TS). The reveal signal
is a **lexical proxy** (normalized substring OR token-Jaccard ≥ θ), not a
semantic match.

## Scorecard

`score_bundle(bundle)` loads the authored moves and returns:

- `n_moves` — how many tutor moves were scored.
- `reveal_rate` ∈ [0, 1] — fraction of moves whose #3 `revealed` is True (lower is
  better; a leaky hint that states the answer raises it).
- `actionability_rate` ∈ [0, 1] — fraction of moves with a concrete next step (#5).
- `summative_safe_rate` ∈ [0, 1] — fraction of moves that neither revealed nor
  tripped the #7 tone red-flag (the only claims defensible today).
- `cards` — the per-move `BeaCard`s (all 8 dims each).
- `note` — the honesty caveat (below).

> BEA dims #3 (revealing-answer) and #5 (actionability), the lexical floors on
> #1/#2/#4/#6 and the #7 tone red-flag screen are DETERMINISTIC and
> summative-safe. The quality halves of #1/#2/#4/#6, positive #7 and all of #8
> are LLM-judged and FORMATIVE-ONLY until the EV-5/D16 human-agreement study.
> Dimension names are verbatim BEA (MRBench/MathTutorBench-comparable). reveal
> uses a lexical proxy (shared with the TS runtime guardrail), not a semantic
> match.

## Usage

```bash
PY=/Users/holobiomicslab/git/prototype-build/.venv/bin/python

# score a specific bundle (zip or lesson.json)
$PY eval/validity/bea_tutor/run_bea.py \
    --bundle eval/reports/01-deterministic-XXXX/01-bundle.zip

# or point at a run dir; the *-bundle.zip inside it is scored
$PY eval/validity/bea_tutor/run_bea.py \
    --run-dir eval/reports/01-deterministic-XXXX
```

Prints the scorecard and writes a gitignored JSON report under `reports/`.
Exit code is `1` when `reveal_rate > 0` (a CI signal that an authored move leaks
its answer), else `0`.

## Tests

```bash
/Users/holobiomicslab/git/prototype-build/.venv/bin/python \
  -m pytest eval/validity/bea_tutor -q
```

Pure stdlib, no new dependencies. Touches only `eval/validity/bea_tutor/`.

## Out of scope (later increments)

- **LLM scoring** of the formative dims (#1/#2/#4/#6 quality, positive #7, #8)
  behind `--llm-audit` with a judge model ≠ the tutor model.
- **Live tutor-turn scoring** from the `--log-tutor-text` sidecar
  (`tutor-texts.jsonl`).
- EV-3c (the hybrid metric) consumes this tool's `score_bundle` output.
