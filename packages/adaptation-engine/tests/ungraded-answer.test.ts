// packages/adaptation-engine/tests/ungraded-answer.test.ts
//
// INT-STUDIUM-035 candidate 2, engine side: an `answer_submitted` with NO `correct` field is an
// attempt whose correctness was never measured. It must move nothing that means "the learner knows
// this" — not the Beta posterior, not the attempt/correct counters, not the error streak — and it
// must not be readable as a failure by an adaptation rule.
//
// The trap this guards against is the one recorded on the withheld counts of INT-STUDIUM-030: a
// number removed from one channel comes back through the channel beside it. Stopping the Beta
// update while leaving `answer_correct: false` in the rule context would move the false claim, not
// remove it — the learner would be sent into remediation for an answer nobody graded.
//
// It is COUNTED, though. An invisible attempt is its own defect (INT-STUDIUM-029: an unmeasured
// axis publishes no value but always publishes its sample count), so `ungraded_attempts` is
// available to a bundle that wants to route on "attempted, ungradeable here".
import { describe, it, expect } from "vitest";
import { AdaptationEngine } from "../src/engine";
import { updateBeta } from "../src/beta-updater";
import { defaultLearnerState, defaultConceptState, type LearnerState, type Signal } from "@studium/learner-state";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";

function stateWith(concept_id: string): LearnerState {
  const s = defaultLearnerState("lesson-x");
  s.concept_states[concept_id] = defaultConceptState(concept_id);
  return s;
}

const ungraded: Signal = {
  kind: "answer_submitted", concept_id: "c1", scene_id: "s1",
  time_ms: 1000, hint_count: 0, difficulty: 0.5,
};
const gradedWrong: Signal = { ...ungraded, correct: false };
const gradedRight: Signal = { ...ungraded, correct: true };

const RULES: AdaptationRule[] = [
  {
    id: "r-wrong", when: { answer_correct: "==false" },
    action: { kind: "replay_current_scene" }, explanation_short: "raté",
  } as unknown as AdaptationRule,
  {
    id: "r-right", when: { answer_correct: "==true" },
    action: { kind: "advance_to_next_scene" }, explanation_short: "juste",
  } as unknown as AdaptationRule,
];

describe("an ungraded answer moves nothing that means mastery", () => {
  it("leaves alpha and beta exactly where they were", () => {
    const e = new AdaptationEngine([], stateWith("c1"));
    e.onSignal(ungraded);
    const cs = e.getState().concept_states.c1!;
    expect(cs.alpha).toBe(1);
    expect(cs.beta).toBe(1);
  });

  it("leaves total_attempts and total_correct alone — an unmeasured attempt is not evidence", () => {
    const e = new AdaptationEngine([], stateWith("c1"));
    e.onSignal(ungraded);
    e.onSignal(ungraded);
    const cs = e.getState().concept_states.c1!;
    expect(cs.total_attempts).toBe(0);
    expect(cs.total_correct).toBe(0);
  });

  it("does not extend the error streak — not grading an answer is not the learner failing", () => {
    const e = new AdaptationEngine([], stateWith("c1"));
    e.onSignal(gradedWrong);
    expect(e.getState().concept_states.c1!.consecutive_errors).toBe(1);
    e.onSignal(ungraded);
    expect(e.getState().concept_states.c1!.consecutive_errors).toBe(1);
  });

  it("does not RESET the error streak either — it says nothing in either direction", () => {
    const e = new AdaptationEngine([], stateWith("c1"));
    e.onSignal(gradedWrong);
    e.onSignal(ungraded);
    e.onSignal(ungraded);
    expect(e.getState().concept_states.c1!.consecutive_errors).toBe(1);
  });

  it("twenty ungraded answers certify nothing: mastery stays at the prior", () => {
    const e = new AdaptationEngine([], stateWith("c1"));
    for (let i = 0; i < 20; i++) e.onSignal(ungraded);
    const cs = e.getState().concept_states.c1!;
    expect(cs.alpha / (cs.alpha + cs.beta)).toBe(0.5);
  });
});

describe("the attempt is counted, not hidden", () => {
  it("ungraded_attempts accumulates", () => {
    const e = new AdaptationEngine([], stateWith("c1"));
    e.onSignal(ungraded);
    e.onSignal(ungraded);
    expect(e.getState().concept_states.c1!.ungraded_attempts).toBe(2);
  });

  it("a graded answer does not inflate it", () => {
    const e = new AdaptationEngine([], stateWith("c1"));
    e.onSignal(gradedRight);
    expect(e.getState().concept_states.c1!.ungraded_attempts ?? 0).toBe(0);
  });
});

describe("absence is not falsehood — no rule fires on an ungraded answer", () => {
  it("the wrong-answer rule does NOT fire", () => {
    const e = new AdaptationEngine(RULES, stateWith("c1"));
    expect(e.onSignal(ungraded).rule_id).toBeNull();
  });

  it("the right-answer rule does not fire either", () => {
    const e = new AdaptationEngine(RULES, stateWith("c1"));
    expect(e.onSignal(ungraded).rule_id).toBeNull();
  });

  it("and both still fire on a GRADED answer — this removes a claim, not a feature", () => {
    expect(new AdaptationEngine(RULES, stateWith("c1")).onSignal(gradedWrong).rule_id).toBe("r-wrong");
    expect(new AdaptationEngine(RULES, stateWith("c1")).onSignal(gradedRight).rule_id).toBe("r-right");
  });
});

describe("the graded path is untouched", () => {
  it("updateBeta on a graded answer behaves exactly as before", () => {
    const right = updateBeta(defaultConceptState("c1"), gradedRight as never);
    expect(right).toMatchObject({ total_attempts: 1, total_correct: 1, consecutive_errors: 0 });
    expect(right.alpha).toBeGreaterThan(1);
    const wrong = updateBeta(defaultConceptState("c1"), gradedWrong as never);
    expect(wrong).toMatchObject({ total_attempts: 1, total_correct: 0, consecutive_errors: 1 });
    expect(wrong.beta).toBeGreaterThan(1);
  });
});
