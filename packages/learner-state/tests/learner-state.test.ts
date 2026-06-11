import { describe, it, expect } from "vitest";
import { LearnerStateSchema, SignalSchema, DecisionSchema, masteryOf, updateCalibration, defaultConceptState } from "../src/index";

describe("LearnerState", () => {
  it("default state parses", () => {
    const state = {
      lesson_id: "L1", schema_version: "1.0",
      concept_states: {}, scenes_completed: [],
      scenes_replayed: {}, history: [],
      session_started_at: "2026-05-08T10:00:00Z", last_decision: null,
    };
    expect(() => LearnerStateSchema.parse(state)).not.toThrow();
  });

  it("masteryOf computes alpha/(alpha+beta)", () => {
    expect(masteryOf({ concept_id: "c", alpha: 3, beta: 1,
      consecutive_errors: 0, total_attempts: 3, total_correct: 3,
      confidence_calibration: 0 })).toBeCloseTo(0.75, 2);
  });

  it("Signal answer_submitted parses", () => {
    const s = { kind: "answer_submitted", concept_id: "c", scene_id: "s",
      correct: true, time_ms: 5000, hint_count: 0, difficulty: 0.5 };
    expect(() => SignalSchema.parse(s)).not.toThrow();
  });

  it("Decision parses with rule_id null", () => {
    const d = { next_action: { kind: "advance_to_next_scene" },
      rule_id: null, explanation_short: null, modulator: null };
    expect(() => DecisionSchema.parse(d)).not.toThrow();
  });

  it("Signal confidence_declared parses with optional concept_id", () => {
    const withConcept = { kind: "confidence_declared", scene_id: "m", value: 4, concept_id: "c-lcms" };
    const withoutConcept = { kind: "confidence_declared", scene_id: "m", value: 1 };
    expect(() => SignalSchema.parse(withConcept)).not.toThrow();
    expect(() => SignalSchema.parse(withoutConcept)).not.toThrow();
  });
});

describe("updateCalibration", () => {
  // concept with mastery ~0.28 (alpha=1, beta ~2.6 — roughly the eval's c-04-summary-2)
  function lowMasteryConcept() {
    return { ...defaultConceptState("c"), alpha: 1, beta: 2.57, total_attempts: 3, total_correct: 0 };
  }

  it("OVERCONFIDENT: declared max (4→1.0) on a low-mastery concept → POSITIVE calibration ≥ 0.4", () => {
    const cs = lowMasteryConcept();
    const actual = masteryOf(cs); // ~0.28
    const out = updateCalibration(cs, 4);
    expect(out.confidence_calibration).toBeGreaterThan(0); // overconfident = positive
    expect(Math.abs(out.confidence_calibration)).toBeGreaterThanOrEqual(0.4); // must trip the M3 rule
    // signed gap = 1.0 - actual
    expect(out.confidence_calibration).toBeCloseTo(1.0 - actual, 2);
  });

  it("CALIBRATED-LOW: declared low (1→0.25) ≈ low actual mastery → near-zero, abs < 0.4", () => {
    const cs = lowMasteryConcept();
    const actual = masteryOf(cs); // ~0.28
    const out = updateCalibration(cs, 1);
    expect(Math.abs(out.confidence_calibration)).toBeLessThan(0.4); // does NOT trip the rule
    expect(out.confidence_calibration).toBeCloseTo(0.25 - actual, 2);
  });

  it("UNDERCONFIDENT: declared low on a high-mastery concept → NEGATIVE calibration", () => {
    const cs = { ...defaultConceptState("c"), alpha: 9, beta: 1, total_attempts: 3, total_correct: 3 };
    const out = updateCalibration(cs, 0); // declares 0 while mastery ~0.9
    expect(out.confidence_calibration).toBeLessThan(0);
  });

  it("clamps to [-1, 1]", () => {
    const certainWrong = { ...defaultConceptState("c"), alpha: 1, beta: 99, total_attempts: 3 };
    const out = updateCalibration(certainWrong, 4); // declared 1.0, actual ~0.01
    expect(out.confidence_calibration).toBeLessThanOrEqual(1);
    expect(out.confidence_calibration).toBeGreaterThanOrEqual(-1);
  });

  it("preserves all other concept-state fields (pure, only touches confidence_calibration)", () => {
    const cs = lowMasteryConcept();
    const out = updateCalibration(cs, 4);
    expect(out.alpha).toBe(cs.alpha);
    expect(out.beta).toBe(cs.beta);
    expect(out.total_attempts).toBe(cs.total_attempts);
    expect(out.total_correct).toBe(cs.total_correct);
    expect(out.consecutive_errors).toBe(cs.consecutive_errors);
  });
});
