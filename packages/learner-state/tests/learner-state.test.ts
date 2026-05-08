import { describe, it, expect } from "vitest";
import { LearnerStateSchema, SignalSchema, DecisionSchema, masteryOf } from "../src/index";

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
});
