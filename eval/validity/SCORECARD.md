# Validity scorecard

- **run id**: `05-deterministic-20260909-113535`
- **author mode**: deterministic  ·  **corpus**: 05
- **code**: `ff7abc24b892`
- **generated**: 2026-09-09T09:43:11Z

The run directory itself is gitignored (it carries per-learner state). This file is the
committed record: it names the run, the code, and the digest of every report it read.

| tool | status | attributed to this run | source report | sha256 |
|---|:-:|:-:|---|---|
| kt_calibration | ok | n/a | `eval/validity/kt_calibration/reports/20260909T114311.json` | `93b67f61cfb8` |
| persona_validation | ok | yes | `eval/validity/persona_validation/reports/05-deterministic-20260909-113535.json` | `fbcb95bb20b5` |
| grounding_relevance | ok | yes | `eval/validity/grounding_relevance/reports/05-bundle.json` | `af1b55a82f8d` |
| bea_tutor | ok | yes | `eval/validity/bea_tutor/reports/05-bundle.json` | `d1c7912c0d26` |
| reasoning_depth | ok | yes | `eval/validity/reasoning_depth/reports/05-deterministic-20260909-113535.json` | `3c40a27a91cb` |

## Headline numbers

### kt_calibration
> validates the learner model against an external dataset, not against this run: the same number for any run id

```json
{
  "source_type": "csv",
  "n_observations": 278336,
  "beta_beats_running_mean": true,
  "results": {
    "beta": {
      "auc": 0.6981769869734796,
      "brier": 0.20895070531854049,
      "acc": null,
      "n": 278336
    },
    "bkt": {
      "auc": 0.6775900256384527,
      "brier": 0.21784346571524096,
      "acc": null,
      "n": 278336
    },
    "running_mean": {
      "auc": 0.6932838664934053,
      "brier": 0.21546307082761787,
      "acc": null,
      "n": 278336
    }
  }
}
```

### persona_validation

```json
{
  "verdict": "pass",
  "n_personas": 5,
  "completed": {
    "hint_reliant": true,
    "misconception": true,
    "overconfident": true,
    "proficient": true,
    "struggling": true
  },
  "n_turns": {
    "hint_reliant": 17,
    "misconception": 35,
    "overconfident": 24,
    "proficient": 15,
    "struggling": 35
  },
  "max_collapse_score": 0.934161,
  "missing_branches": [],
  "findings": []
}
```

### grounding_relevance

```json
{
  "verdict": "relevant",
  "n_evidenced_scenes": 4,
  "mean_best_relevance": 0.08078973938284849,
  "relevance_grade": 0.5,
  "threshold": 0.06
}
```

### bea_tutor

```json
{
  "n_moves": 27,
  "reveal_rate": 0.0,
  "actionability_rate": 0.4444444444444444,
  "summative_safe_rate": 1.0
}
```

### reasoning_depth

```json
{
  "verdict": {
    "anti_offloading_ok": true,
    "eliciting_depth": false,
    "contingent": false
  },
  "n_signals": 0,
  "depth_slope": null,
  "signal_entropy": 0.0,
  "n_moves": 0,
  "reveal_violations": 0
}
```

