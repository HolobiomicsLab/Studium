# Studium eval — validity suite

The eval harness (`eval/run_eval.py`) is a **Tier-1** instrument: cheap, continuous,
self-referential. It measures whether the generated course is *structurally* sound
(prereq gates fire, no same-item replay, pseudonyms distinct, …) — **not whether
students learn**. This `validity/` suite validates the **machinery itself** (Tier-2,
external-benchmark-anchored where possible), so the Tier-1 numbers can be trusted.

See `research/framework-evaluation-strategy.md` (Studium repo) for the 3-tier pyramid.

## Tools

| Tool | Validates | Headline |
|---|---|---|
| **`kt_calibration/`** (EV-4) | the **Beta learner model** (ADR 004) | Brier/AUC of next-answer prediction vs BKT + RunningMean. Beta beats the floor on synthetic KT; plug a real EdNet/ASSISTments CSV via `loader.py` for the external number. |
| **`persona_validation/`** (EV-9) | the **simulated students** (the eval's measurement instrument) | divergence (catches "persona collapse"), runtime-branch coverage, calibration-aware. Validates internal validity; real-vs-simulated fidelity (EV-9b) needs real student data. |
| **`grounding_relevance/`** | the **grounding dimension's blind spot** | the auditor scores citation *presence*, not *relevance*; this flags off-topic citations (lexical Jaccard) — e.g. it exposes mock grounding (auditor 1.0) as `PRESENCE_ONLY`. |

## Run

```bash
PY=.venv/bin/python   # repo root: /Users/holobiomicslab/git/prototype-build
# whole suite (tests)
$PY -m pytest eval/validity -q

# individual reports
$PY eval/validity/kt_calibration/run_calibration.py --synth --seed 1
$PY eval/validity/persona_validation/run_validation.py --corpus 01
$PY eval/validity/grounding_relevance/run_relevance.py --run-dir eval/reports/<a-grounded-run>

# all three at once (kt step auto-uses the REAL ASSISTments 2009 number once fetched)
$PY eval/validity/kt_calibration/fetch_assistments.py   # one-time: enables the external number
$PY eval/validity/run_all.py --corpus 01
```

`run_all.py`'s kt step reports the **external** ASSISTments 2009 result when
`kt_calibration/data/assistments09_canonical.csv` exists (see
`kt_calibration/external_result.json`), else falls back to synthetic.

## What this suite does NOT do
- It does **not** establish *learning efficacy* — that needs a **Tier-3 pilot RCT** with a
  no-AI transfer test (the crutch-effect check; EV-11). All in-session metrics are suspect for efficacy.
- `kt_calibration` synthetic numbers are a *relative* signal + harness validation, **not** the external benchmark.
- `grounding_relevance` is a *lexical* proxy, not semantic embeddings.
- LLM-scored metrics (reasoning_depth, ai_audit) still require the **EV-5/D16** human-agreement study
  before any certificative use (spec: Studium `docs/superpowers/specs/2026-06-12-llm-judge-validity-study-design.md`).
