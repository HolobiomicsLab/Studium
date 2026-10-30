English · [Français](README.fr.md)

# @studium/adaptation-engine

Decides what a lesson does after each learner signal, and when a concept is due for review. It applies the adaptation rules of a lesson bundle, folds graded answers into a per-concept mastery estimate (a Beta posterior), routes through prerequisites, and schedules spaced reviews with FSRS-4.5. Pure TypeScript: no I/O, no clock unless you inject one. Terms are explained in the [glossary](../../docs/concepts/glossary.md) and the [learner model](../../docs/concepts/learner-model.md).

## Where it sits

[`@studium/lesson-session`](../lesson-session/README.md) drives one `AdaptationEngine` per session; the state it updates is defined in [`@studium/learner-state`](../learner-state/README.md). See [architecture](../../docs/develop/architecture.md).

## Public API

From [src/index.ts](src/index.ts):

| Export | Purpose |
|---|---|
| `AdaptationEngine` | `onSignal(signal)` updates the state and returns a `Decision` (next action, rule id, short explanation, modulator); `getState()`, `explain()`. |
| `updateBeta` | Folds one graded answer into a concept's posterior, with a guessing correction for choice items. |
| `matchesCondition` | Evaluates a rule's `when` clause (`>=`, `<=`, `>`, `<`, `==`, `!=`) against a context. |
| `isAvailable`, `availableConcepts`, `lockedConcepts`, `nextConcept`, `remediationTarget`, `DEFAULT_THETA` | Prerequisite routing over a learning workflow graph; a concept unlocks when its prerequisites reach `DEFAULT_THETA` (0.8). |
| `defaultMemoryState`, `reviewMemory`, `retrievability`, `intervalDays`, `dueAt`, `isDue` | FSRS-4.5 memory of one concept. |
| `gradeFromAnswer`, `gradeFromSelfRating`, `SELF_RATING_GRADES` | Map a graded answer, or an again / hard / good / easy self-rating, to an FSRS grade 1 to 4. |
| `dueForReinforcement`, `nextReinforcement`, `reinforcementPriority` | Rank mastered concepts whose recall is fading. |

## Example

```ts
import { AdaptationEngine, defaultMemoryState, reviewMemory, gradeFromSelfRating, isDue } from "@studium/adaptation-engine";
import { defaultLearnerState } from "@studium/learner-state";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";

const rules: AdaptationRule[] = [{
  id: "replay_after_two_errors",
  when: { consecutive_errors_same_concept: ">=2" },
  action: { kind: "replay_current_scene", reason: "errors_threshold" },
  modulator: "M1",
  explanation_short: "Two errors in a row on this concept.",
}];

const engine = new AdaptationEngine(rules, defaultLearnerState("lesson-1"));
const decision = engine.onSignal({
  kind: "answer_submitted", concept_id: "c1", scene_id: "q1",
  correct: false, time_ms: 12_000, hint_count: 0, difficulty: 0.5,
});
decision.next_action.kind; // "advance_to_next_scene" until the rule fires

const now = Date.now();
const memory = reviewMemory(defaultMemoryState("c1"), gradeFromSelfRating("good"), now);
isDue(memory, now + 7 * 86_400_000); // true: predicted recall has fallen below 90 %
```

## Invariants

- An answer whose `correct` is absent is unmeasured: it moves neither the posterior nor `total_attempts`; only `ungraded_attempts` grows, and no rule keyed on `answer_correct` fires.
- A key absent from the context never matches. Calibration keys are published only once measured, so an unmeasured learner is never treated as perfectly calibrated.
- `alpha + beta` is capped at 20, so old evidence cannot freeze the estimate.
- A `prerequisite_for` edge points from the dependent concept (`source`) to its prerequisite (`target`).
- The constructor deep-copies the initial state; the third argument injects the clock used for history and FSRS stamps.
- A self-rating only yields an FSRS grade. Mastery moves on graded evidence alone (enforced in `lesson-session`).

## Test

```bash
pnpm --filter @studium/adaptation-engine test
```

## Depends on / used by

- Depends on: `@studium/learner-state`, `@studium/lesson-bundle-schema`, `@studium/learning-workflow-schema`.
- Used by: `@studium/lesson-session`, `@studium/lesson-session-host`, `@studium/typed-graph-lens`, `apps/student-runtime`.

## Status

Active. Private workspace package, not published to npm.
