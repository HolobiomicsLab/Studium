// RT-2 (bounded): the learner-model additions of learner-state — effective mastery, the guess rate
// carried by an answer, and the optional per-bundle FSRS memory. The update rule itself (pseudo-count
// cap, correction for guessing) lives in adaptation-engine's beta-updater and is tested there.
import { describe, expect, it } from "vitest";
import {
  effectiveMastery, SignalSchema, LearnerStateSchema, defaultLearnerState,
} from "./index.js";

describe("effectiveMastery — posterior × FSRS retrievability", () => {
  it("is the product of the posterior and the retrievability", () => {
    expect(effectiveMastery(0.9, 0.5)).toBeCloseTo(0.45, 10);
    expect(effectiveMastery(0.8, 1)).toBeCloseTo(0.8, 10);
  });

  it("falls back to the posterior when there is no retention evidence (never reviewed ≠ forgotten)", () => {
    expect(effectiveMastery(0.9, undefined)).toBe(0.9);
    expect(effectiveMastery(0.9, null)).toBe(0.9);
    expect(effectiveMastery(0.9, Number.NaN)).toBe(0.9);
  });

  it("clamps both factors into [0, 1]", () => {
    expect(effectiveMastery(1.2, 0.5)).toBeCloseTo(0.5, 10);
    expect(effectiveMastery(0.8, 1.5)).toBeCloseTo(0.8, 10);
    expect(effectiveMastery(-0.1, 0.5)).toBe(0);
    expect(effectiveMastery(0.8, -1)).toBe(0);
  });
});

describe("schemas keep the learner-model fields through a durable round trip", () => {
  const answer = {
    kind: "answer_submitted", concept_id: "c", scene_id: "q", correct: false,
    time_ms: 4200, hint_count: 0, difficulty: 0.5, guess_rate: 0.25,
  } as const;

  it("an answer_submitted signal keeps its guess_rate (zod strips undeclared keys)", () => {
    const parsed = SignalSchema.parse(answer);
    expect(parsed).toMatchObject({ guess_rate: 0.25 });
  });

  it("a guess_rate outside [0, 1) is refused", () => {
    expect(SignalSchema.safeParse({ ...answer, guess_rate: 1 }).success).toBe(false);
    expect(SignalSchema.safeParse({ ...answer, guess_rate: -0.1 }).success).toBe(false);
  });

  it("a learner state keeps an optional per-concept FSRS memory, and parses without one", () => {
    const state = defaultLearnerState("L");
    expect(LearnerStateSchema.safeParse(state).success).toBe(true);
    const withMemory = {
      ...state,
      concept_memory: { c: { concept_id: "c", stability: 3, difficulty: 5, last_reviewed_at: 1_000, reps: 1, lapses: 0 } },
    };
    expect(LearnerStateSchema.parse(withMemory).concept_memory?.c?.stability).toBe(3);
  });
});
