# Spec — Active-learning scene types: `spot_the_flaw` & `explain_back`

Status: **implemented** (M-active-learning, 2026-06-26)
Author path: hand-authored bundle (`fixtures/atomistique-l1`) + runtime; planner-side
plan/workflow schemas are out of scope (these scenes are runtime-authored, not yet
planner-generated — see Non-goals).

## 1. Motivation

A faculty co-design board (UCA / DS4H, "Méta-cognition — aide à l'apprentissage")
surfaced, repeatedly and with the most votes, two learner-as-active-agent patterns
that Studium did not yet model as first-class scenes:

- **« Proposer un cours "biaisé" et demander aux étudiants de relever ces biais et de
  proposer un cours "amélioré" en justifiant »** (C. Risso) — error-hunting + correction.
- **« Étudiant devient prof → au lieu d'évaluer l'acquisition, on évalue les notions lors
  d'un exercice de transmission »** (M. Ciussi) — teach-back / Feynman.

Both train the critical-evaluation skill that E. Boncompagni names as the whole point of
an "IA souveraine comme tuteur, pas solution magique" — *savoir analyser les retours d'une
IA, les comprendre, voire les reformuler.*

This spec adds two scene types that realise those patterns while reusing Studium's existing
grading, mastery, telemetry, and privacy machinery.

## 2. Scene types

### 2.1 `spot_the_flaw` — find the planted errors, then see the fix

The learner is shown a deliberately-flawed mini-lesson (`flawed_content`), must identify what
is wrong (free text), is scored on how many planted flaws they caught, and the authored
`model_correction` ("cours amélioré") is the reference correction.

Schema (`SpotTheFlawSceneSchema`, extends `SceneBaseSchema`):

| field | type | role |
|---|---|---|
| `type` | `"spot_the_flaw"` | discriminator |
| `flawed_content` | string (md) | the deliberately-wrong lesson **shown to the learner** |
| `claims` | `Claim[]` (1–5) | the flawed assertions + `flaws_expected` keys — **answer key, never rendered** |
| `model_correction` | string (md) | the corrected version — **reveal, not shown pre-answer** |
| `rubric` | `AICritiqueRubric` | `{completeness, evidence_quality, tone}` (used by the live evaluator) |

Reuses `ClaimSchema` and `AICritiqueRubricSchema` verbatim, so the existing
`CritiqueEvaluator` port grades it unchanged.

### 2.2 `explain_back` — explain it in your own words

The learner is asked to explain a concept (`prompt`); the explanation is scored by how well
it covers the authored `key_points`; the authored `model_explanation` is the reference.

Schema (`ExplainBackSceneSchema`, extends `SceneBaseSchema`):

| field | type | role |
|---|---|---|
| `type` | `"explain_back"` | discriminator |
| `prompt` | string (md) | what to explain — **shown to the learner** |
| `key_points` | `KeyPoint[]` (1–6) | ideas a good explanation contains; each `{id, text, cues[]}` — **answer key, never rendered** |
| `model_explanation` | string (md) | reference explanation — **reveal, not shown pre-answer** |
| `rubric` | `AICritiqueRubric` | reused for the live evaluator contract |

`KeyPoint.cues` are the phrases the offline scorer matches against; the grader maps
`key_points → Claim[]` (`{id, text, flaws_expected: cues}`) so the **same** evaluator/matcher
scores coverage with no new port.

## 3. Runtime wiring (what changes, what doesn't)

**Changes** (additive only):

- `SceneTypeSchema` enum + `SceneSchema` union (TS) and `SceneType` + `SceneUnion` (Py).
- `ResponseInput` gains `{kind:"flaw_report", text}` and `{kind:"explanation", text}`
  (type in `lesson-session/src/types.ts`, zod in `lesson-session-host/src/response-input-schema.ts`).
- `graders.ts`: `flawGrader` + `explainBackGrader`, registered in `GRADERS`; `DIFFICULTY`
  fallbacks (0.7 each, overridden by the concept's Bloom level via `difficultyForBloom`).
- Front-end: `artifact-pane.js` + `notebook.ts` render the body + a textarea (mirrors
  `ai_critique`).
- `tools/class_report.py`: folds `critique_submitted` into per-concept accuracy.

**Untouched** (by design): the adaptation engine (`beta-updater`, `graph-router`),
`telemetry-events`, `ports.ts`, and the MCP layer — both new scenes ride the existing
`answer_submitted` signal and `critique_submitted` / `ai_audit_result` events, and the MCP
`submit_response` tool is scene-type-agnostic.

## 4. Scoring

Both graders return the standard `answer_submitted` signal `{concept_id, correct, hint_count,
difficulty}` → the Beta posterior updates exactly like a quiz/critique. `correct = score ≥ 0.6`.

- **Offline / no API key** (the demo default): `StubCritiqueEvaluator` →
  `matchClaimsAgainstCritique` → `score = true_positives / planted_errors` (deterministic
  keyword coverage). For `explain_back`, the "planted errors" are the key-point cues, so the
  score is the fraction of key points covered. **The self-contained demo grades with no keys.**
- **Live**: `HttpCritiqueEvaluator` POSTs to `:8002/scenes/critique-eval`; falls back to the
  offline score on any error (spec §8.3 graceful degradation).

## 5. Privacy (ADR-006)

- The learner's free text (flaw report / explanation) is **never** put in telemetry — only
  scalars travel: `critique_submitted {scene_id, llm_score, completion_rate}` and (for
  `spot_the_flaw`) `ai_audit_result {planted_errors, true_positives, false_positives, missed}`.
- The answer keys (`claims`/`flaws_expected`, `key_points`/`cues`) and the `model_*` reveals
  are **never DOM-rendered before the learner responds** — same answer-leak discipline as the
  `showMastery`-off default. **Caveat (not a regression):** the full scene object *is* transmitted
  to the client (the MCP `get_scene` / extension post the whole validated scene), exactly as quiz
  scenes already ship their choices' `correct` flags. A determined learner inspecting the transport
  could read the keys. Closing this requires a host-side `publicScene` projection that strips
  answer-bearing fields for *all* scene types (quiz `correct`, claims, cues, `model_*`) — tracked as
  a repo-wide follow-up, out of scope here because it is not specific to these two scenes.

## 6. Teacher analytics

`class_report.py` now rolls `critique_submitted` into the per-concept accuracy table
(`llm_score ≥ 0.6` ⇒ correct). All three scored free-response scene types — `ai_critique`,
`spot_the_flaw`, `explain_back` — therefore appear in the k-anonymous class report (this also
fixes the pre-existing gap where `ai_critique` was invisible to teachers). The fold-in is
**calibration-neutral** (these items have no self-rated confidence, so `conf_sum` gets the binary
pass, not the raw score) and does not dilute `mean_time_s` (divided by *timed* quiz attempts only).

**Known limitation (deferred — RC-2):** because the new scenes reuse the `critique_submitted` event
with no scene-type discriminator, the `services/analytics-collector` aggregates `autonomy_ratio` and
the AI-literacy index — which were defined as *AI-critique* (anti-offloading) signals — now also count
`explain_back` (teach-back) and `spot_the_flaw`. The per-concept class report above is unaffected;
only those collector aggregates conflate the three. Proper fix = add a `kind`/`scene_type` tag to the
event and gate `compute_autonomy` to `ai_critique`. Tracked separately.

## 7. Atomistique examples (`fixtures/atomistique-l1`)

- **`spot_the_flaw`** on `c-remplissage`: a statement claiming nitrogen (Z=7) is
  `1s² 2s² 2p⁴` with paired 2p electrons — violates Hund's rule and the electron count;
  `model_correction` = `1s² 2s² 2p³`, one electron per 2p orbital, parallel spins.
- **`explain_back`** on `c-orbitales-formes`: explain why a 2p orbital has two lobes of
  opposite sign separated by a nodal plane (cues: wavefunction, sign, nodal plane, probability).

Both are added as `task` nodes in the LWG (`assesses` their concept) so they show in the
graph view and teacher report.

## 8. Non-goals (this pass)

- **Reveal-after-submit UI** for `model_correction` / `model_explanation`: the runtime
  advances on submit and there is no transition-feedback surface today (quiz feedback is also
  not yet rendered). The reveals are authored + validated + available to the live evaluator;
  surfacing them is a fast follow.
- **Planner generation**: `lesson-plan-schema` / `learning-workflow-schema` (author-pipeline)
  are not extended — these scenes are runtime-authored. When the planner learns to emit them,
  add the literals there.
- **Peer evaluation** (Ciussi "évaluer les prompts entre eux") needs a multi-learner substrate
  Studium does not have — tracked separately on the roadmap.
