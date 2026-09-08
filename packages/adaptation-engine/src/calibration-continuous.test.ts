import { describe, it, expect } from "vitest";
import { AdaptationEngine } from "./engine.js";
import { defaultLearnerState } from "@studium/learner-state";

const answer = (over: Record<string, unknown> = {}) => ({
  kind: "answer_submitted" as const, concept_id: "c", scene_id: "s",
  correct: true, time_ms: 0, hint_count: 0, difficulty: 0.5, ...over,
});

describe("continuous per-answer calibration capture (engine)", () => {
  it("an answer carrying a confidence folds it into calibration AND counts a sample", () => {
    const eng = new AdaptationEngine([], defaultLearnerState("l"));
    // correct answer nudges mastery up modestly; declaring max confidence (4) is overconfident.
    eng.onSignal(answer({ confidence: 4 }));
    const cs = eng.getState().concept_states["c"]!;
    expect(cs.calibration_samples).toBe(1);
    expect(cs.confidence_calibration).toBeGreaterThan(0); // declared high vs modest actual -> overconfident
  });

  it("accrues continuously across answers (not just at meta-checkpoints)", () => {
    const eng = new AdaptationEngine([], defaultLearnerState("l"));
    eng.onSignal(answer({ confidence: 4 }));
    eng.onSignal(answer({ confidence: 4 }));
    expect(eng.getState().concept_states["c"]!.calibration_samples).toBe(2);
  });

  it("an answer WITHOUT a confidence records no calibration sample (unmeasured)", () => {
    const eng = new AdaptationEngine([], defaultLearnerState("l"));
    eng.onSignal(answer());
    expect(eng.getState().concept_states["c"]!.calibration_samples).toBeUndefined();
  });
});
