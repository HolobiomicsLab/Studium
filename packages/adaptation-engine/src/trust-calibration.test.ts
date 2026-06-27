import { describe, it, expect } from "vitest";
import { AdaptationEngine } from "./engine.js";
import { defaultLearnerState, TRUST_WELL_BAND } from "@studium/learner-state";

const grounded = (audit: { planted: number; caught: number; false_positives: number }, over: Record<string, unknown> = {}) => ({
  kind: "answer_submitted" as const, concept_id: "c", scene_id: "s",
  correct: false, time_ms: 0, hint_count: 0, difficulty: 0.7,
  judgment_audit: { grounded: true as const, ...audit }, ...over,
});

describe("trust-calibration fold-in (engine)", () => {
  it("a grounded judgment audit folds into trust_calibration AND counts a sample", () => {
    const eng = new AdaptationEngine([], defaultLearnerState("l"));
    eng.onSignal(grounded({ planted: 2, caught: 0, false_positives: 0 })); // all flaws missed -> over-trust
    const cs = eng.getState().concept_states["c"]!;
    expect(cs.trust_calibration_samples).toBe(1);
    expect(cs.trust_calibration!).toBeGreaterThan(TRUST_WELL_BAND);
  });

  it("an answer WITHOUT a judgment_audit never touches trust_calibration", () => {
    const eng = new AdaptationEngine([], defaultLearnerState("l"));
    eng.onSignal({ kind: "answer_submitted", concept_id: "c", scene_id: "s", correct: true, time_ms: 0, hint_count: 0, difficulty: 0.5 });
    const cs = eng.getState().concept_states["c"]!;
    expect(cs.trust_calibration).toBeUndefined();
    expect(cs.trust_calibration_samples).toBeUndefined();
  });

  it("trust and confidence are INDEPENDENT dimensions — both fold in on one answer", () => {
    const eng = new AdaptationEngine([], defaultLearnerState("l"));
    eng.onSignal(grounded({ planted: 2, caught: 0, false_positives: 0 }, { confidence: 4 }));
    const cs = eng.getState().concept_states["c"]!;
    expect(cs.trust_calibration_samples).toBe(1);
    expect(cs.calibration_samples).toBe(1);             // confidence dimension untouched-and-separate
    expect(cs.trust_calibration!).toBeGreaterThan(TRUST_WELL_BAND);
  });
});
