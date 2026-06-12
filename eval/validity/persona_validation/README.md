# Persona validation harness (EV-9)

A validity tool that checks whether an eval run's three simulated-student
**personas** (`proficient`, `struggling`, `overconfident`) are a **trustworthy
measurement instrument**.

## Why this exists

The eval's whole Tier-1 signal depends on the personas being *meaningfully
different* and *exercising the adaptive runtime*. A prior review found
**"persona collapse"**: the `overconfident` persona was once byte-for-byte
identical to `struggling`, which made M3 calibration unobservable — the eval
reported a contrast that did not exist. A later session found the personas were
also coupled to same-item replay. This harness exists to catch that class of
failure mechanically, on every run.

## What it validates (INTERNAL validity)

For one run dir it produces a **scorecard** with a `pass` / `flags` verdict:

1. **Divergence (no collapse).** For every persona *pair* it computes a
   `collapse_score ∈ [0,1]` (high = collapsed). Collapse requires **both**
   near-identical mastery **and** a near-identical transition mix. A pair scoring
   `≥ 0.98` (`COLLAPSE_THRESHOLD`) is flagged `high`. `proficient`-vs-`struggling`
   is additionally required to differ in both mean mastery and transition mix —
   that pair carries the core contrast.
2. **Branch coverage.** The **union** of transition kinds + adaptation `rule_id`s
   fired across all personas must cover the expected adaptive branches:
   `{next, remediate_alt, complete, graph_prereq_gate, graph_universe_escalated}`.
   Any expected-but-missing branch is flagged (the eval is not demonstrably
   touching that adaptive path). `replay`, `graph_skip_mastered`/`skip_mastered`,
   and `calibration` are allowed-but-not-required.
3. **All-completed.** Any persona that didn't complete (hit the turn cap) is
   flagged — a non-completing persona is a broken instrument.

`verdict` is `pass` when there are no `high`-severity findings, else `flags`.

## What it does NOT validate

It does **not** check **real-vs-simulated fidelity** — i.e. whether these
simulated students behave like *real* students. That needs real student
interaction data and is tracked as future work **EV-9b**. The scorecard carries
an explicit honest `note` to that effect.

## Input data shape

Per persona, under a run dir:

```
<run_dir>/sessions/<persona>/driver_result.json   # persona, completed, n_turns,
                                                  # transition_kinds, summary,
                                                  # final_concept_mastery,
                                                  # final_state.concept_states{alpha,beta,...}
<run_dir>/sessions/<persona>/telemetry.jsonl      # adaptation_applied events -> rule_id
```

Mastery per concept is `alpha / (alpha + beta)` from `final_state.concept_states`
(falling back to `final_concept_mastery` if needed). The loader is **defensive**:
missing files/fields yield sensible defaults and never crash.

## How to run

```bash
# analyze an existing eval run
python eval/validity/persona_validation/run_validation.py \
    --run-dir eval/reports/01-deterministic-YYYYMMDD-HHMMSS

# produce a fresh deterministic run for corpus 01, then analyze it
python eval/validity/persona_validation/run_validation.py --corpus 01

# tests (TDD)
python -m pytest eval/validity/persona_validation/tests -q
```

The CLI prints the scorecard and writes
`eval/validity/persona_validation/reports/<run>.json` (that `reports/` dir is
gitignored). Exit code is `0` on `pass`, `1` on `flags` — usable as a CI gate.

## Layout

| file | role |
|------|------|
| `loader.py` | parse `sessions/*` into `PersonaRecord`s (+ `rule_id`s) |
| `metrics.py` | `l1_distance`, `cosine_sim`, transition-distance, `collapse_score` |
| `validate.py` | `validate_run(run_dir)` -> scorecard + verdict |
| `run_validation.py` | CLI (`--run-dir` / `--corpus`) |
| `tests/` | TDD suite (loader / metrics / collapse / pass / missing-branch) |
