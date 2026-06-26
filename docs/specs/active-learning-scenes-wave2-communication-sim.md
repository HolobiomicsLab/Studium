# Spec — Active-learning scene, wave 2 (D2): `communication_sim`

Status: **implemented** (schema + grading) — 2026-06-26
Scope: schema (Zod + the two Pydantic mirrors), response-input kind, grader, the
`critique_submitted` `scene_type` enum, the LWG `scene_type` enum, and an authored
atomistique-l1 example. UI affordances + planner generation are out of scope (same
posture as `active-learning-scenes-wave1.md` §6).

## 1. Motivation

The faculty co-design board (Dubas — *« simuler des situations de communication
professionnelle »*) surfaced one more learner-as-active-agent pattern that maps
one-to-one onto the existing active-learning machinery (the `CritiqueEvaluator` port +
`matchClaimsAgainstCritique`, offline-deterministic):

- **communication_sim**: the learner is put in a **professional communication situation**
  (a role + an audience) and must communicate a target message effectively. The learner is
  scored on whether the response hits the **communication objectives** a good message should
  meet (clarity for a non-expert, addressing the audience, accuracy, actionability).

It **reuses** the existing primitives — `KeyPoint` / `AICritiqueRubric` — and the
explain_back-style coverage grader. No new grading port, no new matcher.

## 2. Scene type

Extends `SceneBaseSchema`. The answer key (`key_points`) and the `model_response` reveal
are **never rendered pre-answer** — identical answer-leak discipline as `explain_back`.

### 2.1 `communication_sim`

| field | type | role |
|---|---|---|
| `type` | `"communication_sim"` | discriminator |
| `scenario` | string (md) | the professional situation + the learner's role + the audience — **shown** |
| `prompt` | string (md) | what to communicate — **shown** |
| `key_points` | `KeyPoint[]` (≥1) | the communication objectives a good response must hit (clarity-for-non-expert / addresses-the-audience / accurate / actionable) — **answer key** |
| `model_response` | string (md) | reference response — **reveal** |
| `rubric` | `AICritiqueRubric` | live-evaluator contract |

Input kind `{kind:"communication", text}`. Grader = `explainBackGrader`-style coverage over
`key_points` (mapped to claim-shape `{id, text, flaws_expected: cues}` at grade time). No
`ai_audit_result` (nothing is "planted"). Emits `critique_submitted` with `scene_type`
`"communication_sim"`.

## 3. Wiring (additive only)

- `SceneTypeSchema` enum + `SceneSchema` union (Zod) and `SceneType` + `SceneUnion` (both
  Pydantic mirrors: `scene_synth_schemas.py` and `lesson_bundle_schema/__init__.py`).
- `ResponseInput` gains `communication`
  (`lesson-session/src/types.ts` + `lesson-session-host/src/response-input-schema.ts`).
- `graders.ts`: `communicationSimGrader`, registered in `GRADERS`; `DIFFICULTY` fallback
  (0.7, overridden by the concept's Bloom level).
- `critique_submitted` `scene_type` enum (telemetry-events Zod + Pydantic) gains the value.
  The LWG `scene_type` enum (TS + Py) gains it too (task nodes `assesses` a concept).
- `bundler.validate_scene` accepts it (it validates against the full `Scene` union, so no
  change beyond the schema mirror).

**Offline default:** the `StubCritiqueEvaluator` → `matchClaimsAgainstCritique` path scores
the scene deterministically (the matcher folds accents/superscripts), so the demo grades
key-free. `correct = score ≥ 0.6`.

## 4. Anti-offloading gating (collector posture)

`communication_sim` is a communication-craft construct (like `prompt_practice`). The
`services/analytics-collector` anti-offloading gating belongs to a parallel workflow — this
spec only emits the `scene_type` tag so that gating can distinguish it; it does not change
the collector.

## 5. Atomistique example (`fixtures/atomistique-l1`)

- **communication_sim** `s3d-communicate-2p` on `c-orbitales-formes`: « explique à un·e
  camarade de TD (non encore au point) **pourquoi la 2p a deux lobes**, **sans jargon** ».
  `key_points` = the content cues a good lay-explanation contains (no jargon / image of the
  two lobes / the plane between them is forbidden to the electron / a relatable analogy),
  accent-free and self-covering the `model_response`.

Added as a `task` node in the LWG (`assesses` its concept) and round-trips through both
Pydantic mirrors. The end-to-end `active_learning_check.mjs` drives the
`communication_sim` scene type to completion offline and asserts it feeds its concept's
mastery non-decreasingly.

## 6. Non-goals (this pass)

Same as `active-learning-scenes-wave1.md` §6: reveal-after-submit UI, planner generation
(`lesson-plan-schema`), and the host-side `publicScene` projection that would strip
answer-bearing fields in transport (a parallel Wave-2 A4 workflow owns that).
