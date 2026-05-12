import { describe, it, expect } from "vitest";
import { defaultConceptState } from "@studium/learner-state";
import { updateBeta } from "../src/beta-updater";

describe("updateBeta", () => {
  it("correct easy answer (difficulty=0.2) → alpha increases by ~1.8", () => {
    const s = defaultConceptState("c");
    const next = updateBeta(s, { kind: "answer_submitted", concept_id: "c",
      scene_id: "s", correct: true, time_ms: 1000, hint_count: 0, difficulty: 0.2 });
    expect(next.alpha).toBeCloseTo(s.alpha + 0.8 + 1, 2);  // (1-0.2)+1
    expect(next.beta).toBe(s.beta);
    expect(next.total_correct).toBe(1);
    expect(next.consecutive_errors).toBe(0);
  });

  it("incorrect hard answer (difficulty=0.9) → beta increases by ~1.9", () => {
    const s = defaultConceptState("c");
    const next = updateBeta(s, { kind: "answer_submitted", concept_id: "c",
      scene_id: "s", correct: false, time_ms: 1000, hint_count: 0, difficulty: 0.9 });
    expect(next.beta).toBeCloseTo(s.beta + 0.9 + 1, 2);
    expect(next.consecutive_errors).toBe(1);
  });

  it("consecutive_errors resets on correct", () => {
    let s = defaultConceptState("c");
    s = { ...s, consecutive_errors: 2 };
    const next = updateBeta(s, { kind: "answer_submitted", concept_id: "c",
      scene_id: "s", correct: true, time_ms: 0, hint_count: 0, difficulty: 0.5 });
    expect(next.consecutive_errors).toBe(0);
  });

  it("total_attempts increments on each call", () => {
    let s = defaultConceptState("c");
    for (let i = 0; i < 3; i++) {
      s = updateBeta(s, { kind: "answer_submitted", concept_id: "c",
        scene_id: "s", correct: i % 2 === 0,
        time_ms: 0, hint_count: 0, difficulty: 0.5 });
    }
    expect(s.total_attempts).toBe(3);
  });

  it("converges toward 0.8+ mastery after 10 correct easy answers", () => {
    let s = defaultConceptState("c");
    for (let i = 0; i < 10; i++) {
      s = updateBeta(s, { kind: "answer_submitted", concept_id: "c",
        scene_id: "s", correct: true, time_ms: 0, hint_count: 0, difficulty: 0.2 });
    }
    expect(s.alpha / (s.alpha + s.beta)).toBeGreaterThanOrEqual(0.9);
  });
});
