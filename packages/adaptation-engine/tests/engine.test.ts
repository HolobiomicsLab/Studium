import { describe, it, expect } from "vitest";
import { defaultLearnerState, defaultConceptState } from "@studium/learner-state";
import { AdaptationEngine } from "../src/engine";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";

const RULE_REPLAY: AdaptationRule = {
  id: "rule_2err_replay_concept",
  when: { consecutive_errors_same_concept: ">=2" },
  action: { kind: "replay_current_scene", reason: "errors_threshold" },
  modulator: "M1",
  explanation_short: "Tu as eu deux erreurs.",
};

const RULE_SKIP: AdaptationRule = {
  id: "rule_mastery_high_skip",
  when: { mastery_c: ">=0.8", total_attempts: ">=3" },
  action: { kind: "skip_to_next_concept" },
  modulator: "M1",
  explanation_short: "Tu maîtrises.",
};

const RULE_CALIB: AdaptationRule = {
  id: "rule_calibration_mismatch_show",
  when: { confidence_calibration_abs: ">=0.4", total_attempts: ">=3" },
  action: { kind: "show_calibration_panel" },
  modulator: "M3",
  explanation_short: "Compare ta confiance et ta réussite.",
};

describe("AdaptationEngine", () => {
  it("default decision is advance_to_next_scene with no rule", () => {
    const engine = new AdaptationEngine([], defaultLearnerState("L1"));
    const d = engine.onSignal({ kind: "scene_entered", scene_id: "s1" });
    expect(d.next_action.kind).toBe("advance_to_next_scene");
    expect(d.rule_id).toBeNull();
  });

  it("replay rule fires after 2 errors on same concept", () => {
    const state = defaultLearnerState("L1");
    const engine = new AdaptationEngine([RULE_REPLAY], state);
    engine.onSignal({ kind: "answer_submitted", concept_id: "c1",
      scene_id: "s1", correct: false, time_ms: 0, hint_count: 0, difficulty: 0.5 });
    const d = engine.onSignal({ kind: "answer_submitted", concept_id: "c1",
      scene_id: "s1", correct: false, time_ms: 0, hint_count: 0, difficulty: 0.5 });
    expect(d.next_action.kind).toBe("replay_current_scene");
    expect(d.rule_id).toBe("rule_2err_replay_concept");
    expect(d.modulator).toBe("M1");
  });

  it("skip rule fires after high mastery + 3+ attempts", () => {
    let state = defaultLearnerState("L1");
    state.concept_states["c1"] = { ...defaultConceptState("c1"),
      alpha: 9, beta: 1, total_attempts: 3, total_correct: 3 };
    const engine = new AdaptationEngine([RULE_SKIP], state);
    const d = engine.onSignal({ kind: "answer_submitted", concept_id: "c1",
      scene_id: "s1", correct: true, time_ms: 0, hint_count: 0, difficulty: 0.5 });
    expect(d.next_action.kind).toBe("skip_to_next_concept");
  });

  it("calibration rule shows panel with target_concept from signal", () => {
    let state = defaultLearnerState("L1");
    state.concept_states["c1"] = { ...defaultConceptState("c1"),
      alpha: 2, beta: 2, total_attempts: 4, total_correct: 1,
      confidence_calibration: 0.5 };
    const engine = new AdaptationEngine([RULE_CALIB], state);
    const d = engine.onSignal({ kind: "answer_submitted", concept_id: "c1",
      scene_id: "s1", correct: false, time_ms: 0, hint_count: 0, difficulty: 0.5 });
    expect(d.next_action.kind).toBe("show_calibration_panel");
    expect((d.next_action as any).target_concept).toBe("c1");
  });

  it("rule order matters — first match wins", () => {
    let state = defaultLearnerState("L1");
    state.concept_states["c1"] = { ...defaultConceptState("c1"),
      alpha: 9, beta: 1, total_attempts: 3, total_correct: 3,
      consecutive_errors: 2 };
    const engine = new AdaptationEngine([RULE_REPLAY, RULE_SKIP], state);
    const d = engine.onSignal({ kind: "answer_submitted", concept_id: "c1",
      scene_id: "s1", correct: false, time_ms: 0, hint_count: 0, difficulty: 0.5 });
    expect(d.next_action.kind).toBe("replay_current_scene");
  });

  it("getState returns current state", () => {
    const engine = new AdaptationEngine([], defaultLearnerState("L1"));
    engine.onSignal({ kind: "answer_submitted", concept_id: "c1",
      scene_id: "s1", correct: true, time_ms: 0, hint_count: 0, difficulty: 0.5 });
    const state = engine.getState();
    expect(state.concept_states["c1"].total_attempts).toBe(1);
  });

  it("explain returns last decision details when non-fallback", () => {
    let state = defaultLearnerState("L1");
    state.concept_states["c1"] = { ...defaultConceptState("c1"),
      consecutive_errors: 2 };
    const engine = new AdaptationEngine([RULE_REPLAY], state);
    engine.onSignal({ kind: "answer_submitted", concept_id: "c1",
      scene_id: "s1", correct: false, time_ms: 0, hint_count: 0, difficulty: 0.5 });
    const e = engine.explain();
    expect(e?.rule_id).toBe("rule_2err_replay_concept");
    expect(e?.modulator).toBe("M1");
  });
});
