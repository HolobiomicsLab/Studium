// packages/adaptation-engine/src/engine.memory.test.ts
//
// RT-3: the FSRS memory is first-class. The engine folds every GRADED answer into
// `state.concept_memory` as it happens, instead of the host replaying a history capped at 50 entries
// (a struggling learner's earliest answers were evicted, and the replay saw their concepts as never
// reviewed). An answer nobody graded is not a retrieval and leaves the memory alone.
import { describe, it, expect } from "vitest";
import { defaultLearnerState, type LearnerState, type Signal } from "@studium/learner-state";
import { AdaptationEngine } from "./engine";
import { defaultMemoryState, gradeFromAnswer, reviewMemory } from "./fsrs";

const T0 = Date.parse("2026-10-01T09:00:00Z");
const MINUTE = 60_000;

/** An engine whose clock returns T0, then T0 + 1 min, T0 + 2 min… one tick per read. */
function engineAt(initial: LearnerState = defaultLearnerState("l")) {
  let tick = 0;
  return new AdaptationEngine([], initial, () => new Date(T0 + MINUTE * tick++).toISOString());
}

const answer = (correct: boolean | undefined, hint_count = 0, concept_id = "c"): Signal => ({
  kind: "answer_submitted", concept_id, scene_id: "q", time_ms: 1000, hint_count, difficulty: 0.5,
  ...(correct === undefined ? {} : { correct }),
} as Signal);

describe("AdaptationEngine keeps the FSRS memory first-class (RT-3)", () => {
  it("folds a graded answer into concept_memory at the engine's clock", () => {
    const engine = engineAt();
    engine.onSignal(answer(true));
    const memory = engine.getState().concept_memory?.["c"];
    expect(memory).toEqual(reviewMemory(defaultMemoryState("c"), 3, T0));
    // the history entry of that answer carries the same instant
    expect(Date.parse(engine.getState().history[0]!.timestamp)).toBe(T0);
  });

  it("an ungraded answer, a confidence or a completed scene leaves the memory alone", () => {
    const engine = engineAt();
    engine.onSignal(answer(undefined));
    engine.onSignal({ kind: "confidence_declared", scene_id: "m", value: 3, concept_id: "c" } as Signal);
    engine.onSignal({ kind: "scene_completed", scene_id: "q", duration_ms: 10 } as Signal);
    expect(engine.getState().concept_memory?.["c"]).toBeUndefined();
  });

  it("a hinted right answer is a 'hard' review, a wrong one a lapse", () => {
    const engine = engineAt();
    engine.onSignal(answer(true, 2));
    engine.onSignal(answer(false, 0, "d"));
    const state = engine.getState();
    expect(state.concept_memory?.["c"]).toEqual(reviewMemory(defaultMemoryState("c"), gradeFromAnswer({ correct: true, hint_count: 2 }), T0));
    expect(state.concept_memory?.["d"]?.lapses).toBe(1);
  });

  it("counts every review past the 50-entry history cap", () => {
    const engine = engineAt();
    for (let i = 0; i < 60; i += 1) engine.onSignal(answer(i % 3 !== 0));
    const state = engine.getState();
    expect(state.history).toHaveLength(50);
    expect(state.concept_memory?.["c"]?.reps).toBe(60);
    expect(state.concept_memory?.["c"]?.lapses).toBe(20);
  });

  it("continues a memory carried in the initial state (a concept reviewed in another lesson)", () => {
    const prior = reviewMemory(reviewMemory(defaultMemoryState("c"), 3, T0 - 30 * 86_400_000), 3, T0 - 10 * 86_400_000);
    const initial = { ...defaultLearnerState("l"), concept_memory: { c: prior } };
    const engine = engineAt(initial);
    engine.onSignal(answer(true));
    const memory = engine.getState().concept_memory?.["c"];
    expect(memory).toEqual(reviewMemory(prior, 3, T0));
    expect(memory?.reps).toBe(3);
    // the initial state handed to the engine is not mutated
    expect(initial.concept_memory.c.reps).toBe(2);
  });
});
