# Studium modulators (M-series) — the reconciled vocabulary

**Canonical source:** `packages/lesson-bundle-schema/src/modulators.ts` (the registry).
This document is kept in sync with it by `packages/lesson-bundle-schema/src/modulators.guard.test.ts`.
Where earlier docs disagree with this table, **this table wins** (it is grounded in code).

## What a modulator is

A *modulator* labels the **pedagogical intent** of an adaptation rule. It is a **descriptive / provenance
tag**, not a behaviour switch: the engine matches rules on their `when`/`action` and simply copies
`rule.modulator` onto the emitted decision for explanation and telemetry — it never branches on the value
(`adaptation-engine/src/engine.ts`). So the vocabulary below is *documentation of why a rule exists*, not a
list of engine modes.

> **Why the count is not "M1–M8".** The concept vocabulary once spoke of up to eight modulators, but the
> running system only ever *uses* three. This table lists every id that has appeared, with an honest status,
> precisely so the principles section can say what is real. **Beware a naming collision:** elsewhere in the
> repo `M<n>` is also used for *project-milestone* labels (e.g. "démo M6", "M5.7" telemetry) — that is a
> different namespace and is **not** a modulator.

## The registry

| id | name | status | what it does (grounded in the rules that carry it) |
|----|------|--------|----------------------------------------------------|
| **M1** | mastery-adaptive pacing & routing | **active** | Routes on demonstrated competence — remediate (replay) on repeated same-concept errors; skip/accelerate past a concept once mastery is high; graph-skip already-mastered concepts. |
| **M2** | (unassigned) | **retired** | No behaviour. In the old enum but carried by zero rules — a ghost. |
| **M3** | metacognitive calibration | **active** | When declared confidence diverges from measured mastery, reveal the calibration panel so the learner confronts over-/under-confidence. |
| **M4** | (legacy) | **retired** | Declared only in the legacy `lesson-schema`; never implemented, never a rule tag. |
| **M5** | anti-offloading | **retired** (as a tag) | Hint use discounts mastery credit. The behaviour is **live** as a cross-cutting engine invariant, but it is *not* emitted as a modulator value. |
| **M6** | prerequisite-gated remediation routing | **active** | Gate a concept behind unmet prerequisites; after repeated remediation, escalate one-way to a more heavily-scaffolded "universe". |

M7 and M8 are intentionally absent — they were never defined as modulators in code.

**Runtime vocabulary = the active set `{M1, M3, M6}`.** A bundle can only tag a rule with one of these; the
schema rejects the rest, so the code and the docs can no longer drift apart silently.

## Open decisions for the authoring trio (Élise / Tao / Isabelle)

These are naming/scope choices the code does **not** settle — they belong to the pedagogy, not to me:

1. **M6's name.** The code's M6 is *prerequisite-gated remediation routing*. An earlier README called M6
   "explicability", which the code contradicts (explicability is a UI affordance, not an M6-tagged rule).
   Confirm the name.
2. **M5.** Keep "anti-offloading" as an engine invariant (current state), or promote it into the modulator
   tag vocabulary so it appears on the decisions it shapes.
3. **M2 / M4.** Leave retired, or assign them real interventions. Today they mean nothing.

## For the principles section (suggested framing)

> Studium's adaptations are annotated with a small vocabulary of *modulators* naming the pedagogical
> principle each embodies. Three are in force: **M1** (mastery-adaptive pacing and routing), **M3**
> (metacognitive calibration), and **M6** (prerequisite-gated remediation). A fourth principle,
> *anti-offloading* — hint use discounts mastery credit — is enforced as a cross-cutting invariant rather
> than a per-decision tag. Earlier drafts referred to additional modulators (M2, M4, M5, M7, M8); these are
> not part of the running system and are retained here only for provenance.
