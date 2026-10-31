# Spec — Active-learning scenes, wave 1: `comparison` · `summary_audit` · `prompt_practice`

Status: **implemented** (schema + grading) — 2026-06-26
Scope: schema (Zod + the two Pydantic mirrors), response-input kinds, graders, the
`critique_submitted` `scene_type` enum, the LWG `scene_type` enum, and authored
atomistique-l1 examples. UI affordances + planner generation are out of scope (same
posture as the original `active-learning-scenes.md` §8 non-goals).

## 1. Motivation

The faculty co-design board surfaced three more learner-as-active-agent patterns that map
one-to-one onto the existing active-learning machinery (the `CritiqueEvaluator` port +
`matchClaimsAgainstCritique`, offline-deterministic):

- **comparison** (Rapetti — *« cours IA vs cours enseignant — relever la valeur ajoutée »*):
  the learner is shown two artifacts and names the differences / added value.
- **summary_audit** (Fargier — *« résumé IA — apprécier ce qui est conservé / supprimé »*):
  the learner reads a source + an AI summary and audits the omissions / distortions.
- **prompt_practice** (Ciussi — *« exercices de prompt — analyse / affinage »*): the learner
  writes (or refines) a prompt and is scored on prompt-quality cues.

All three **reuse** the existing primitives — `FlawClaim` / `KeyPoint` / `AICritiqueRubric` —
and the existing graders' shapes (`flawGrader` for the auditor variant, `explainBackGrader` for
the coverage variants). No new grading port, no new matcher.

## 2. Scene types

Each extends `SceneBaseSchema`. Answer keys (`claims` / `key_points`) and the `model_*` reveals
are **never rendered pre-answer** — identical answer-leak discipline as `spot_the_flaw`.

### 2.1 `comparison`

| field | type | role |
|---|---|---|
| `type` | `"comparison"` | discriminator |
| `prompt` | string (md) | what to compare / what "added value" means — **shown** |
| `artifact_a` | string (md) | first artifact (e.g. the AI course) — **shown** |
| `artifact_b` | string (md) | second artifact (e.g. the teacher course) — **shown** |
| `key_points` | `KeyPoint[]` (≥1) | the differences / added value to identify — **answer key** |
| `model_answer` | string (md) | reference answer — **reveal** |
| `rubric` | `AICritiqueRubric` | live-evaluator contract |

Input kind `{kind:"comparison", text}`. Grader = `explainBackGrader`-style coverage over
`key_points` (mapped to claim-shape `{id, text, flaws_expected: cues}`). No `ai_audit_result`.

### 2.2 `summary_audit`

| field | type | role |
|---|---|---|
| `type` | `"summary_audit"` | discriminator |
| `source_content` | string (md) | the full source — **shown** |
| `ai_summary` | string (md) | the AI summary to audit — **shown** |
| `claims` | `FlawClaim[]` (1–5) | omissions / distortions to catch — **answer key** |
| `model_correction` | string (md) | reference correction — **reveal** |
| `rubric` | `AICritiqueRubric` | live-evaluator contract |

Input kind `{kind:"summary_audit", text}`. Grader = `flawGrader`-style (this is auditing an AI
output): emits `critique_submitted` **and** `ai_audit_result`, scored
`true_positives / planted_errors`.

### 2.3 `prompt_practice`

| field | type | role |
|---|---|---|
| `type` | `"prompt_practice"` | discriminator |
| `task` | string (md) | what to write a prompt for — **shown** |
| `starter_prompt` | string (optional) | a weak draft to refine — **shown** (NOT an answer key) |
| `key_points` | `KeyPoint[]` (≥1) | prompt-quality cues (clear instruction / context / constraints / format) — **answer key** |
| `model_prompt` | string (md) | reference prompt — **reveal** |
| `rubric` | `AICritiqueRubric` | live-evaluator contract |

Input kind `{kind:"prompt_submission", text}`. Grader = coverage over `key_points`. No
`ai_audit_result`. `starter_prompt` is the affordance the learner edits, so it is rendered.

## 3. Wiring (additive only)

- `SceneTypeSchema` enum + `SceneSchema` union (Zod) and `SceneType` + `SceneUnion` (both
  Pydantic mirrors: `scene_synth_schemas.py` and `lesson_bundle_schema/__init__.py`).
- `ResponseInput` gains `comparison` / `summary_audit` / `prompt_submission`
  (`lesson-session/src/types.ts` + `lesson-session-host/src/response-input-schema.ts`).
- `graders.ts`: `comparisonGrader`, `summaryAuditGrader`, `promptPracticeGrader`, registered
  in `GRADERS`; `DIFFICULTY` fallbacks (0.7 each, overridden by the concept's Bloom level).
- `critique_submitted` `scene_type` enum (telemetry-events Zod + Pydantic) gains the three
  values. The LWG `scene_type` enum (TS + Py) gains them too (task nodes `assesses` a concept).
- `bundler.validate_scene` accepts all three (it validates against the full `Scene` union, so
  no change was needed beyond the schema mirror).

**Offline default:** the `StubCritiqueEvaluator` → `matchClaimsAgainstCritique` path scores all
three deterministically (the matcher folds accents/superscripts), so the demo grades key-free.
`correct = score ≥ 0.6`.

## 4. Anti-offloading gating (collector posture)

`comparison` and `summary_audit` are AI-facing critique constructs; `prompt_practice` is a
prompt-craft construct. The `services/analytics-collector` anti-offloading gating belongs to a
parallel workflow — this spec only emits the `scene_type` tag so that gating can distinguish
them; it does not change the collector. (Mirrors how the original spec deferred the collector
amendment to RC-2.)

## 5. Atomistique examples (`fixtures/atomistique-l1`)

- **comparison** `s5c-compare-remplissage` on `c-remplissage`: AI vs teacher write-up of the
  filling order; the added value is the 4s/3d trap + the chromium counter-example + the "rule is
  a guide" nuance.
- **summary_audit** `s4b-audit-spectres` on `c-spectres`: an AI summary that drops quantification,
  the photon-energy relation, and the n=2/visible definition of Balmer.
- **prompt_practice** `s6b-prompt-configuration` on `c-configuration`: craft a prompt that makes
  an AI explain why copper is `[Ar]4s¹3d¹⁰`, hitting instruction / context / constraints / format.

All three are added as `task` nodes in the LWG (`assesses` their concept) and round-trip through
both Pydantic mirrors. The end-to-end `active_learning_check.mjs` drives all five active-learning
scene types to completion offline and asserts each feeds its concept's mastery non-decreasingly.

## 6. Non-goals (this pass)

Same as `active-learning-scenes.md` §8: reveal-after-submit UI, planner generation
(`lesson-plan-schema`), and the host-side `publicScene` projection that would strip answer-bearing
fields in transport (tracked repo-wide, out of scope here).
