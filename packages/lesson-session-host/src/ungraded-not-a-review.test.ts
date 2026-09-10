// packages/lesson-session-host/src/ungraded-not-a-review.test.ts
//
// INT-STUDIUM-035 candidate 2, FSRS side. `memoryFromHistory` replays a concept's
// `answer_submitted` history through the scheduler, and `fsrsGradeFromAnswer` reads `correct`
// FIRST: `if (!a.correct) return 1` — grade 1 is "again", the hardest failure. So an answer with no
// `correct` field would be replayed as a failed retrieval, which is the exact inversion this
// decision exists to stop, arriving through the scheduler instead of through the posterior.
//
// A spaced-repetition system schedules RETRIEVALS. An attempt nobody graded is not a retrieval with
// an outcome: it is not evidence of recall and not evidence of forgetting, so it does not belong in
// the replay at all. A concept whose ONLY answers are ungraded has `reps = 0` and stays on the
// prerequisite-gated path, which is where an unmeasured concept already belongs.
import { describe, it, expect } from "vitest";
import {
  defaultLearnerState, defaultConceptState,
  type LearnerState, type Signal, type Decision,
} from "@studium/learner-state";
import { reviewQueueFromState } from "./host.js";

const NOOP_DECISION: Decision = {
  next_action: { kind: "advance_to_next_scene" }, rule_id: null,
  explanation_short: null, modulator: null,
};

/** A history of answers for one concept; `correct: undefined` means the answer was never graded. */
function stateWithAnswers(
  concept_id: string,
  answers: Array<{ correct?: boolean; atMs: number }>,
): LearnerState {
  const s = defaultLearnerState("lesson-x");
  s.concept_states[concept_id] = defaultConceptState(concept_id);
  for (const a of answers) {
    const signal = {
      kind: "answer_submitted", concept_id, scene_id: "scn",
      ...(a.correct === undefined ? {} : { correct: a.correct }),
      time_ms: 1000, hint_count: 0, difficulty: 0.5,
    } as Signal;
    s.history.push({ timestamp: new Date(a.atMs).toISOString(), scene_id: "scn", signal, decision: NOOP_DECISION });
  }
  return s;
}

const T0 = Date.parse("2026-09-10T10:00:00Z");
const DAY = 86_400_000;

describe("an ungraded answer is not a retrieval", () => {
  it("a concept answered only on the keyword path never enters the review queue", () => {
    const s = stateWithAnswers("c1", [{ atMs: T0 }, { atMs: T0 + DAY }, { atMs: T0 + 2 * DAY }]);
    expect(reviewQueueFromState(s, T0 + 30 * DAY)).toEqual([]);
  });

  it("it is not replayed as a FAILED retrieval — the grade-1 door stays shut", () => {
    // The regression this pins: `!a.correct` is true for `undefined`, so before the fix three
    // ungraded answers produced three "again" reviews and a decayed, urgently-due concept.
    const s = stateWithAnswers("c1", [{ atMs: T0 }, { atMs: T0 + DAY }]);
    expect(reviewQueueFromState(s, T0 + 30 * DAY).some((i) => i.due)).toBe(false);
  });

  it("graded answers in the SAME history still schedule normally", () => {
    const s = stateWithAnswers("c1", [
      { atMs: T0 }, { correct: true, atMs: T0 + DAY }, { atMs: T0 + 2 * DAY },
    ]);
    const q = reviewQueueFromState(s, T0 + 30 * DAY);
    expect(q).toHaveLength(1);
    // exactly one review folded — the graded one, not the two beside it
    expect(q[0]!.reps).toBe(1);
  });

  it("a wrong graded answer is still a failed retrieval — this removes an inference, not a grade", () => {
    const s = stateWithAnswers("c1", [{ correct: false, atMs: T0 }]);
    const q = reviewQueueFromState(s, T0 + 30 * DAY);
    expect(q).toHaveLength(1);
    expect(q[0]!.due).toBe(true);
  });
});
