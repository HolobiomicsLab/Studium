# EV-8a — MathDial-anchored BEA validation + improve loop

External-benchmark validation of the EV-3b BEA **guidance / actionability**
heuristics against a real SOTA tutoring corpus (MathDial), plus a held-out
improve loop that tunes the detector lexicon to better match the gold — reported
honestly, before/after. This is a standalone tool in the `kt_calibration` /
`grounding_relevance` house style; it is run on demand and is **not** wired into
`run_all.py`. The dataset is **not** committed (gitignored); the numbers
(`external_result.json`) are.

## Design

MathDial teacher turns carry a gold *move* ∈ {focus, generic, probing, telling}.
We map them to a binary **is_guiding** label:

```
is_guiding = move in {"probing", "focus"}   # Socratic, learner-does-the-work
direct     = move in {"telling", "generic"} # tutor does the work / closes it out
```

The BEA **actionability (#5)** + **guidance (#4)** heuristics should fire on the
guiding moves. We measure that agreement (precision / recall / F1 / Cohen's
kappa) against the `is_guiding` gold, then run an improve loop that tunes the
detector's interrogative lexicon on a **held-out split** and reports the
before/after on the test set.

## What is validated here (and what is NOT)

**Validated: the guiding-vs-direct construct.** MathDial labels this cleanly, so
we report a real agreement number for the BEA guidance/actionability detector.

**Construct-mismatch finding — `telling` ≠ reveal (BEA #3).** MathDial's
`telling` label is **broader** than BEA #3 "revealing-the-answer": telling turns
mostly confirm intermediate steps or give corrective feedback, and **rarely**
state the final answer. So we do **not** force a (misleading) reveal-vs-`telling`
agreement number. Instead we report the **reveal firing rate by move
descriptively** and carry the caveat in the result JSON. A direct human-rated
validation of the reveal dimension is **EV-5**, not this tool.

## The improve loop + the domain-neutral gate

The baseline `_NEXT_STEP` regex (from `bea_tutor`) misses bare interrogative
questions like "how much would she have?", which dominate `probing`. The improve
loop searches a small set of candidate lexicon extensions (generic
interrogatives / `?`), picks the best on the **train** split, and reports its
before/after on the **held-out test** split. Splitting is by `qid` so a whole
dialogue is wholly in train **xor** test (no turn-level leakage), and is
deterministic (seed-rotation, no RNG).

**Gate.** Candidate term sets are accepted only if every term is a
**domain-neutral** generic interrogative / punctuation token, never math
vocabulary. The report **surfaces** the recommended `extra_terms`; it does
**not** auto-edit the shipped `bea_tutor` detector. Adopting the tuned lexicon
is a separate, reviewed change.

## Caveat — MathDial is math-only

MathDial is a **math-only** corpus. Domain transfer of any tuned lexicon to
broad STEM is unproven, which is exactly why the lexicon additions are gated on
the domain-neutral check above. The gold is also a **move-type proxy**, not a
direct per-dimension human BEA rating (that is EV-5).

## Running

The dataset is **not** committed. Fetch it, then run the validation:

```bash
# 1. download the MathDial train CSV (-> data/mathdial_train.csv, gitignored)
.venv/bin/python eval/validity/bea_external/fetch_mathdial.py

# 2. validate + improve + reveal-by-move; writes external_result.json
.venv/bin/python eval/validity/bea_external/run_bea_external.py
#    or point at an existing CSV:
.venv/bin/python eval/validity/bea_external/run_bea_external.py --csv /path/to/train.csv
```

Unit tests:

```bash
.venv/bin/python -m pytest eval/validity/bea_external -q
```
