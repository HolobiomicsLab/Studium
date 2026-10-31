English · [Français](README.fr.md)

# @studium/learner-state

The data model of what Studium knows about a learner, as Zod schemas and pure functions: per-concept state (a Beta posterior over mastery, attempts, confidence and trust calibration), the signals a session emits, the decisions the engine returns, the FSRS memory of each concept, and the cross-lesson learner profile. No I/O. See the [learner model](../../docs/concepts/learner-model.md) for the ideas behind the numbers.

## Where it sits

At the bottom of the TypeScript stack: [`@studium/adaptation-engine`](../adaptation-engine/README.md) updates these records, [`@studium/lesson-session`](../lesson-session/README.md) stores them, [`@studium/lesson-session-host`](../lesson-session-host/README.md) carries the profile across lessons. See [architecture](../../docs/develop/architecture.md).

## Public API

From [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `ConceptStateSchema`, `defaultConceptState` | One concept for one learner; the default is the uniform prior (alpha = beta = 1). |
| `SignalSchema` | `answer_submitted`, `confidence_declared`, `scene_entered`, `scene_completed`. |
| `DecisionSchema`, `NextActionSchema` | Engine output: advance, replay, skip, show the calibration panel, show the explanation panel. |
| `LearnerStateSchema`, `defaultLearnerState` | One learner in one lesson; history keeps the last 50 entries. |
| `ConceptMemoryStateSchema` | FSRS memory record (stability in days, difficulty, last review, reps, lapses). |
| `LearnerProfileSchema`, `defaultLearnerProfile`, `recordCompletedLesson`, `seedConceptStatesFromProfile`, `mergeConceptStatesIntoProfile`, `mergeConceptMemoryIntoProfile` | The cross-lesson profile, keyed by pseudonym. |
| `masteryOf`, `effectiveMastery` | Posterior mean; posterior times FSRS retrievability when a memory exists. |
| `recordConfidenceSample`, `updateCalibration`, `isCalibrated`, `isMiscalibrated`, `isOverconfident` | Confidence calibration (declared confidence against actual mastery). |
| `recordJudgmentAudit`, `recordJudgmentSdt`, `isTrustCalibrated`, `isTrustMiscalibrated`, `isOverTrusting` | Trust calibration from audits of flawed AI output. |
| `CALIBRATION_LAMBDA`, `CALIBRATION_ANSWER_LAMBDA`, `CALIBRATION_WELL_BAND`, `TRUST_CALIBRATION_LAMBDA`, `TRUST_WELL_BAND` | Smoothing factors and tolerance bands. |

## Example

```ts
import { defaultConceptState, masteryOf, recordConfidenceSample, isCalibrated, effectiveMastery } from "@studium/learner-state";

let c = defaultConceptState("c1");
masteryOf(c);                    // 0.5
isCalibrated(c);                 // false: never measured
c = recordConfidenceSample(c, 2); // declared 2 on a 0..4 scale
isCalibrated(c);                 // true: 2/4 matches 0.5
effectiveMastery(masteryOf(c), 0.7); // 0.35
```

## Invariants

- Unmeasured is not zero. A calibration counts only after at least one sample; `effectiveMastery(p, undefined)` returns `p`, because a concept never reviewed is not a forgotten one.
- Calibration sign: positive means overconfident (or over-trusting), negative means underconfident (or over-distrusting).
- Profile functions are pure and never mutate their input. On warm start the lesson's own state wins over the profile; merging FSRS memory skips entries never reviewed (`reps === 0`).
- The profile is keyed by a pseudonym, never by a name (see [privacy and limits](../../docs/concepts/privacy-and-limits.md)).

## Test

```bash
pnpm --filter @studium/learner-state test
```

## Depends on / used by

- Depends on: `zod`.
- Used by: `@studium/adaptation-engine`, `@studium/lesson-session`, `@studium/lesson-session-host`, `@studium/typed-graph-lens`, `apps/student-runtime`.

## Status

Active. Private workspace package, not published to npm.
