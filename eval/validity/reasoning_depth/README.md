# reasoning_depth — hybrid scorecard: is the tutor eliciting reasoning, or offloading it?

An **additive validity tool** (EV-3c). It does not touch the eval harness, the
auditor, or the runtime — it reads a finished run dir's discussion telemetry
(`reasoning_signal` + `tutor_move` events) and reports a **3-axis vector**, never
a fused scalar, answering one question the auditor does not ask:

> Is the Socratic tutor **eliciting deeper learner reasoning over the turn**, and
> is each move **contingent on the learner's signal** — without ever **revealing
> the answer** (offloading the thinking)?

## The three axes (orthogonal — read together, never averaged)

1. **trajectory** (LEARNER axis, deterministic) — is deeper reasoning being
   elicited over time? Built from the `reasoning_signal` stream:
   - `signal_histogram` — counts per signal over the depth ladder
     `question < justification < hypothesis < counterexample < synthesis`.
   - `depth_slope` — OLS slope of `depth_rank` over `turn_index` (>0 = deepening;
     `None` with <2 points).
   - `signal_entropy` — Shannon entropy (bits) of the signal distribution
     (diversity, not collapse onto one move).
   - `target_coverage` — fraction of a discussion scene's `target_signals`
     actually elicited (`None` when the bundle declares no targets).
   The `DEPTH_RANK` ordering is **an assumption**, published beside the histogram
   so the raw counts remain auditable independent of the ladder.

2. **tutor_quality** (TUTOR axis) — folds the **EV-3b** authored-scaffolding
   `BeaCard` (`score_bundle`: reveal_rate, actionability_rate,
   summative_safe_rate) plus the **live** `reveal_rate` observed in telemetry.
   The EV-3b import is guarded — when `bea_tutor` or the bundle is absent the
   axis degrades to `authored_bea: null` rather than raising.

3. **contingency** (FUSION axis, deterministic) — did each tutor move *fit* the
   learner signal it replied to? A move is **contingent** iff it is NOT a reveal
   AND (`move_kind == IDEAL_MOVE[signal]` OR `move_kind == "scaffold_hint"`). The
   `IDEAL_MOVE` table **mirrors**
   `packages/lesson-session/src/socratic-tutor/contingency.ts` (`MOVE_FOR_SIGNAL`);
   `scaffold_hint` is always acceptable — it is the low-confidence fallback and
   the lowest-commitment, hardest-to-reveal move. Reports `n_moves`, `rate`,
   `reveal_violations`, and a `per_signal` breakdown.

## Reveal is a HARD VETO, not a summand

A tutor that **reveals the answer** can *spike* the learner trajectory — the
learner parrots the deeper signal back — so reveal looks like depth while it is
actually **offloading**. Fusing the axes into one number would let a high
trajectory hide a reveal. Instead the verdict keeps reveal as a **veto**:

- `anti_offloading_ok` — `True` iff `reveal_violations == 0`. **Any** reveal
  (`revealed` or `reveal_blocked`) flips it to `False`, regardless of how good the
  trajectory or contingency rate looks.
- `eliciting_depth` — `depth_slope > 0`.
- `contingent` — `contingency.rate >= 0.8`.

The CLI exit code follows the veto: `1` when `anti_offloading_ok` is `False`,
else `0`.

## Determinism & the EV-5 gate

- **trajectory** and **contingency** are **fully deterministic** (pure stdlib, no
  LLM, no network). **tutor_quality** folds EV-3b's `BeaCard`: its deterministic
  dimensions are summative-safe; its LLM-scored dimensions stay **formative until
  EV-5**.
- The scorecard is a **vector, never a fused scalar**, and no axis is promoted to
  a summative score — both blocked by **EV-5 / D16**.
- **In-session deepening is not learning.** This tool measures whether deeper
  reasoning was *elicited within the session*; durable efficacy needs a **Tier-3
  RCT**. The honest framing ships in the scorecard's `note`.
- `elicitation_gain` (a paired tutor-on/off causal term) is **deliberately
  omitted** — it needs paired runs and is reported absent rather than faked.

## Usage

```bash
PY=/Users/holobiomicslab/git/prototype-build/.venv/bin/python

# score a run dir's discussion telemetry (sessions/*/telemetry.jsonl)
$PY eval/validity/reasoning_depth/run_reasoning_depth.py \
    --run-dir eval/reports/01-deterministic-XXXX

# print only, skip the JSON report
$PY eval/validity/reasoning_depth/run_reasoning_depth.py \
    --run-dir eval/reports/01-deterministic-XXXX --no-report
```

Prints the 3-axis scorecard and (unless `--no-report`) writes a gitignored JSON
report under `reports/`. If a `*-bundle.zip` is present in the run dir it is
loaded for `target_coverage` and the EV-3b fold. The tool **degrades
gracefully**: a run with no discussion telemetry yields empty trajectory /
contingency, `anti_offloading_ok == True`, and exit `0`.

## Tests

```bash
/Users/holobiomicslab/git/prototype-build/.venv/bin/python \
  -m pytest eval/validity/reasoning_depth -q
```

Pure stdlib, no new dependencies. Touches only `eval/validity/reasoning_depth/`.
