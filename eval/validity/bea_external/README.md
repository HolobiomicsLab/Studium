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

---

# EV-8b — LLM-judge validation against MathDial gold

This extends EV-8a with an **LLM judge** for a single gold-mappable formative BEA
dimension — **"providing guidance"** — and validates it against MathDial's
human-annotated guiding-vs-direct gold, side by side with the shipped
deterministic detector. It is the **EV-5 LLM-judge dry-run** on a silver
standard, executed at near-zero cost and **circularity-free by construction**.

## What it validates

The judge scores each tutor turn on the BEA **"providing guidance"** rubric
(reused **verbatim**) → ordinal `{1, 0.5, 0}`. The scores are binarised at
`>= 0.5` and compared to MathDial's `is_guiding`
(`probing`/`focus` = guiding, `telling`/`generic` = direct) gold, reporting:

- **binary** precision / recall / F1 / Cohen's κ against the gold, and
- **ordinal** quadratic weighted kappa (QWK) over the 3-point scale.

The **same sample** is scored by the shipped deterministic
`score_actionability` detector so the LLM judge and the heuristic are reported
**head to head** against identical gold.

## No circularity

The judge is **not** scoring our own tutor — MathDial turns are **human-written**.
Judge ≠ tutor here, so there is no self-grading loop. This is precisely the EV-5
LLM-judge methodology, dry-run against a human silver standard.

## Running the real validation (operator-driven)

The default run makes **one real `claude` call per sampled turn** (it costs
inference), so it is **not** run in CI and **not** exercised by any unit test
(tests inject a `StubJudge`). After merge, the operator runs it and commits the
result artifact `external_result_llm.json`:

```bash
# default: 25 turns × 4 move types = 100 live `claude` judge calls
.venv/bin/python eval/validity/bea_external/run_llm_judge.py --n-per-move 25
#   or point at an existing CSV / pin a model:
.venv/bin/python eval/validity/bea_external/run_llm_judge.py --csv /path/to/train.csv --model <id>
```

**Cost note.** One Claude call per sampled turn (`n_per_move × 4` calls total).
Use `--no-report` to skip writing `external_result_llm.json`.

## Scope

This validates **only** the gold-mappable guidance construct. It does **not**
replace the EV-5 human study for the non-mappable BEA dimensions
(mistake-identification / mistake-location / coherence / tone / humanlikeness),
for which MathDial carries no gold. The `revealing-answer` (#3) dimension is also
out of scope here — MathDial `telling` ≠ reveal (the EV-8a construct finding), so
it remains human-gated.

## EV-8b result — LLM guidance-judge vs MathDial gold (real run, n=100)

`external_result_llm.json` (seed 0, default Claude judge, 25×4 stratified, 0 null judgments):

| rater | F1 | precision | recall | κ | QWK |
|---|---|---|---|---|---|
| LLM judge (BEA guidance) | 0.732 | 0.616 | 0.900 | 0.340 | **0.391** |
| deterministic (improved) | 0.741 | 0.652 | 0.860 | 0.400 | — |

**Honest conclusions (the EV-5 LLM-judge dry-run):**
1. **QWK 0.39 < the EV-5 pre-registered gate (0.60)** → the LLM guidance judge is **formative-only**, not
   certificative-eligible. Consistent with the field's modest LLM-judge reliability (EV-5 §1).
2. The LLM judge **does not beat the cheap deterministic detector** (F1/κ tied) → for the *guidance* dim
   the free, explainable heuristic suffices; the LLM doesn't justify its inference cost here.
3. High recall (0.90) / lower precision (0.62) = **leniency bias** (over-calls "guiding") — a Zheng-2023
   bias the full EV-5 study probes formally.

This validates only the gold-mappable *guidance* dim on a math silver standard; the non-mappable dims
(mistake-id/location/coherence/tone/humanlikeness) and certificative use still require the **EV-5 human study**.
