English · [Français](modulators.fr.md)

# Modulators

A *modulator* names the pedagogical intent of an adaptation rule: why the rule exists. When a rule fires, its modulator is copied onto the decision, so `explain_last_adaptation`, the VS Code pane and telemetry can say not only what changed but why. Three modulators are in force: M1, M3 and M6. This page defines them, lists the retired ids, and shows how to use them in a lesson.

## A label, not a switch

The adaptation engine matches rules on their `when` condition and applies their `action`. It never branches on the modulator value; it only carries it. A modulator therefore documents a rule, it does not select a behaviour. The canonical list is the registry [`modulators.ts`](../../packages/lesson-bundle-schema/src/modulators.ts); a test keeps this page and the code in step.

Watch for a naming collision: elsewhere in the project, `M<n>` also labels project milestones (for example "M6 demo"). Those are not modulators.

## The registry

| Id | Name | Status | What it does |
|---|---|---|---|
| **M1** | mastery-adaptive pacing and routing | active | Routes on demonstrated competence: replays after repeated errors on the same concept, skips or accelerates past a concept once mastery is high, and skips already-mastered concepts in the graph. |
| **M2** | (unassigned) | retired | No behaviour. It was in an early enum but no rule ever carried it. |
| **M3** | metacognitive calibration | active | When declared confidence diverges from measured mastery, shows the calibration panel so the learner confronts over- or under-confidence. |
| **M4** | (legacy) | retired | Declared only in the legacy `lesson-schema` package; never implemented, never a rule tag. |
| **M5** | anti-offloading | retired as a tag | Hint use discounts mastery credit. The behaviour is live as an engine invariant for every answer, but it is not emitted as a modulator value. |
| **M6** | prerequisite-gated remediation routing | active | Holds a concept behind unmet prerequisites; after repeated remediation, moves the learner, one way, to a more scaffolded universe. |

M7 and M8 were never defined as modulators. Earlier documents spoke of up to eight; only the three above are part of the running system.

## Using modulators in a lesson

A bundle can tag a rule only with an active modulator, `M1`, `M3` or `M6`; the schema rejects any other value, so the code and the documentation cannot drift apart silently. A rule without a modulator is valid and reports `null`.

Rules you will meet in the example lessons and in the session's graph routing:

| Rule id | Where it comes from | Modulator | Effect |
|---|---|---|---|
| `rule_2err_replay_concept` | bundle rule | M1 | two errors on the concept: replay the scene with support |
| `rule_mastery_high_skip` | bundle rule | M1 | high mastery: skip to the next concept |
| `rule_calibration_mismatch_show` | bundle rule | M3 | confidence far from mastery: show the calibration panel |
| `graph_skip_mastered` | graph routing | M1 | skip a concept already mastered |
| `graph_prereq_gate` | graph routing | M6 | detour to an unmet prerequisite |
| `graph_universe_escalated` | graph routing | M6 | move to the more scaffolded universe after repeated remediation |

A scene can be replayed at most three times before the lesson moves on, so a replay rule cannot trap a learner.

`experience_packet.py bundle` adds the two-error replay rule by default; `--no-default-rules` leaves it out.

## Open decisions

The code does not settle these naming and scope choices; they belong to the authors of the pedagogy.

1. **M6's name.** In the code, M6 is prerequisite-gated remediation routing. An earlier text called it "explicability", which the code contradicts: explicability is an interface feature, not an M6-tagged rule.
2. **M5.** Keep anti-offloading as an engine invariant, as today, or make it a modulator tag so it appears on the decisions it shapes.
3. **M2 and M4.** Leave them retired, or assign them real interventions.

## In one paragraph

Studium's adaptations are annotated with a small vocabulary of modulators, each naming the principle a rule embodies. Three are in force: M1 (mastery-adaptive pacing and routing), M3 (metacognitive calibration) and M6 (prerequisite-gated remediation). A fourth principle, anti-offloading (hint use discounts mastery credit), is enforced everywhere rather than tagged per decision. See [Learner model](learner-model.md) and [Learning principles](learning-principles.md).
