# KT calibration harness (EV-4)

A **knowledge-tracing (KT) calibration harness** that measures how well Studium's
production **Beta learner model** predicts a student's *next* answer, compared to
two reference predictors. This is the first external-benchmark-shaped validation
of the adaptation model (validity item **EV-4**).

It is a **reusable evaluation tool**, not a runtime change — nothing here is
imported by the product. It lives entirely under `eval/validity/`.

## What it does

For an interaction stream (per attempt: `student`, `skill`, `correct`, `order`),
each model is replayed **in order**:

1. **PREDICT** P(correct) for the next item, *before* seeing the answer.
2. Record `(y, p)`.
3. **UPDATE** the model with the observed outcome.

Then we score every prediction with **Brier** (↓ better), **ROC-AUC** (↑ better),
and **accuracy**. Three models are compared:

| model          | what it is |
|----------------|------------|
| `beta`         | exact Python reimplementation of the production Beta-updater (`packages/adaptation-engine/src/beta-updater.ts`) |
| `bkt`          | standard 4-parameter Bayesian Knowledge Tracing, **fixed** params |
| `running_mean` | trivial floor: running mean correctness per (student, skill) |

The headline check: on ground-truth synthetic data where learning genuinely
happens, **Beta must beat `running_mean`** on Brier *and* AUC — evidence that the
model tracks learning rather than just memorising a base rate.

## How to run

```bash
# from the repo root, using the project venv
PY=/Users/holobiomicslab/git/prototype-build/.venv/bin/python

# synthetic (default) — deterministic with --seed
$PY eval/validity/kt_calibration/run_calibration.py --synth --seed 1

# tune the synthetic generator
$PY eval/validity/kt_calibration/run_calibration.py \
    --students 80 --skills 8 --attempts 25 --seed 7

# EXTERNAL benchmark: fetch ASSISTments 2009, then run on it (see result below)
$PY eval/validity/kt_calibration/fetch_assistments.py
$PY eval/validity/kt_calibration/run_calibration.py \
    --csv eval/validity/kt_calibration/data/assistments09_canonical.csv

# or plug in any other real KT dataset (EdNet / ASSISTments-2012 / ...)
$PY eval/validity/kt_calibration/run_calibration.py --csv path/to/interactions.csv
```

Each run prints a table and writes `reports/<timestamp>.json` (the `reports/`
dir is git-ignored).

### Tests

```bash
PY=/Users/holobiomicslab/git/prototype-build/.venv/bin/python
$PY -m pytest eval/validity/kt_calibration/tests -q
```

## The Beta update (mirrors production exactly)

Per `(student, skill)` state `(alpha, beta)` init `(1.0, 1.0)`:

```
predict  P(correct) = alpha / (alpha + beta)      # before the answer
correct  alpha += ((1 - w) + 1) / (1 + hint_count)  ==  (2 - w) / (1 + hints)
wrong    beta  += w + 1
```

`w` is item difficulty in `[0, 1]`. In production `w` comes from a Bloom-level
mapping; KT benchmark datasets have **no Bloom level**, so the harness estimates a
per-skill difficulty `w = 1 - p_correct(skill)`, clamped to `[0.1, 0.9]`. By
default this is a global estimate over the stream; `--running-difficulty`
switches to a causal (past-only) estimate. `hint_count` is `0` for KT data.

## Plugging in a real dataset

`loader.load_interactions_csv(path, cols=...)` is the seam. The canonical schema
is `student, skill, correct, order`; map real column names via `cols`, e.g.:

```python
load_interactions_csv(
    "ednet.csv",
    cols={"student": "user_id", "skill": "skill_id",
          "correct": "is_correct", "order": "ts"},
)
```

`order` must sort each `(student, skill)` stream chronologically (timestamp or
attempt index). No dataset is shipped — synthetic is the default.

## External benchmark result (ASSISTments 2009) — ✅ shipped

Online next-step prediction (predict-before-update, leakage-free by construction)
over **278,336 interactions / 3,114 students / 149 skills**, p(correct)=0.659.
Full provenance + caveats in [`external_result.json`](external_result.json).

| model | Brier ↓ | AUC ↑ | Acc ↑ |
|---|---|---|---|
| **beta (ADR 004)** | **0.2090** | **0.6982** | **0.6860** |
| bkt (fixed) | 0.2178 | 0.6776 | 0.6629 |
| running_mean (floor) | 0.2155 | 0.6933 | 0.6845 |

**Beta beats BOTH BKT and the floor on Brier, AUC AND accuracy** (and again in the
leak-free `--running-difficulty` variant: Beta Brier 0.2082 / AUC 0.6981). This
**reverses the synthetic finding** (where BKT edged Beta) and defends the
"simple + explainable" model choice with an *external* number. Honest framing:
AUC ~0.70 is the expected band for simple models here — DKT/SAKT reach ~0.75-0.80
with far more parameters — so the claim is **competitiveness + explainability**,
not SOTA. Strengthen generality by adding EdNet via `loader.py` (one more CSV).

## ⚠️ Synthetic-vs-real caveat (read before quoting numbers)

- **Synthetic data validates the HARNESS** and gives a *relative* Beta-vs-baseline
  signal under known ground truth. It is **not** an external benchmark number — the
  external claim now comes from ASSISTments 2009 (above).
- **BKT here uses FIXED params** (`L0=0.3, T=0.1, G=0.2, S=0.1`), not EM-fit ones.
  It is a *reference*, not a tuned ceiling — a fit BKT would likely score higher.
  EM-fitting is a documented future refinement.

## Files

- `beta_model.py` — exact Beta-updater reimplementation (`BetaModel`).
- `baselines.py` — `BKTModel` (fixed params) and `RunningMeanModel` (floor).
- `metrics.py` — `brier`, `auc` (tie-aware Mann-Whitney), `accuracy` — pure Python.
- `synth.py` — deterministic Rasch/IRT generator (`generate_synthetic`).
- `loader.py` — real-dataset CSV plug-in (`load_interactions_csv`).
- `fetch_assistments.py` — fetch + preprocess ASSISTments 2009 to canonical schema.
- `external_result.json` — committed snapshot of the external benchmark numbers.
- `run_calibration.py` — calibration protocol + CLI (`evaluate_models`, `replay`).
- `tests/` — TDD test suite.
- `data/` — fetched datasets (git-ignored; never committed).
- `reports/` — generated run artifacts (git-ignored).
