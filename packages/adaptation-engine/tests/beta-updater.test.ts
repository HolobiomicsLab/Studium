import { describe, it, expect } from "vitest";
import { defaultConceptState } from "@studium/learner-state";
import { updateBeta } from "../src/beta-updater";
import type { ConceptState } from "@studium/learner-state";

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

function cs(): ConceptState {
  return { concept_id: "c", alpha: 1, beta: 1, consecutive_errors: 0, total_attempts: 0, total_correct: 0, confidence_calibration: 0 };
}
const sig = (correct: boolean, hint_count: number) =>
  ({ kind: "answer_submitted", concept_id: "c", scene_id: "s", correct, time_ms: 0, hint_count, difficulty: 0.5 }) as const;

describe("updateBeta — hint discount (anti-offloading)", () => {
  it("correct with 0 hints: full alpha credit (1.5)", () => {
    expect(updateBeta(cs(), sig(true, 0)).alpha).toBeCloseTo(1 + 1.5);     // 2.5
  });
  it("correct with 1 hint: half credit (0.75)", () => {
    expect(updateBeta(cs(), sig(true, 1)).alpha).toBeCloseTo(1 + 0.75);    // 1.75
  });
  it("correct with 2 hints: third credit (0.5)", () => {
    expect(updateBeta(cs(), sig(true, 2)).alpha).toBeCloseTo(1 + 0.5);     // 1.5
  });
  it("incorrect is unchanged by hint_count (full penalty)", () => {
    const a = updateBeta(cs(), sig(false, 0)).beta;
    const b = updateBeta(cs(), sig(false, 3)).beta;
    expect(a).toBeCloseTo(1 + 1.5);   // beta += w+1 = 1.5
    expect(b).toBeCloseTo(1 + 1.5);   // identical regardless of hints
  });
});
