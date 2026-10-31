import { describe, it, expect } from "vitest";
import { AdaptationEngine } from "./engine.js";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";
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

// A deck/judge audit (sound_total>0) also feeds the SEPARATE signal-detection diagnostic, so the
// engine records A' (competence) + criterion c (bias) alongside the signed gap. The offline keyword
// path (no sound_total) folds only the gap.
const groundedDeck = (a: { planted: number; caught: number; false_positives: number; sound_total: number }) => ({
  kind: "answer_submitted" as const, concept_id: "c", scene_id: "s",
  correct: false, time_ms: 0, hint_count: 0, difficulty: 0.7,
  judgment_audit: { grounded: true as const, ...a },
});

describe("SDT diagnostic fold-in (engine)", () => {
  it("a deck audit (sound_total>0) populates trust_sdt_counts + A' + c ALONGSIDE the gap", () => {
    const eng = new AdaptationEngine([], defaultLearnerState("l"));
    eng.onSignal(groundedDeck({ planted: 3, caught: 3, false_positives: 0, sound_total: 3 }));
    const cs = eng.getState().concept_states["c"]!;
    expect(cs.trust_sdt_counts).toEqual({ hits: 3, misses: 0, false_alarms: 0, correct_rejections: 3 });
    expect(cs.trust_discrimination!).toBeGreaterThan(0.5);
    expect(typeof cs.trust_bias_c).toBe("number");
    expect(cs.trust_calibration_samples).toBe(1); // the signed gap still folds too
  });

  it("the offline keyword path (no sound_total) folds the gap but NOT the SDT", () => {
    const eng = new AdaptationEngine([], defaultLearnerState("l"));
    eng.onSignal(grounded({ planted: 2, caught: 1, false_positives: 0 }));
    const cs = eng.getState().concept_states["c"]!;
    expect(cs.trust_calibration_samples).toBe(1);
    expect(cs.trust_sdt_counts).toBeUndefined();
  });
});

// INT-STUDIUM-029 (the residue INT-STUDIUM-006's rejection deliberately left where its class
// belongs): the rule context published `cs.trust_calibration ?? 0`, so a learner whose trust had
// never been audited reached a bundle rule as PERFECTLY CALIBRATED. That is not a theoretical
// collision — a single audit that catches every planted flaw and raises no false positive really
// does measure 0, so `0` meant two opposite things and the rule could not tell them apart.
//
// `learner-state` already draws this line: `isTrustWellCalibrated` and its two siblings require
// `trust_calibration_samples >= 1` before reading the number (index.ts:281-295), and the engine's
// own comment on the CONFIDENCE axis says the sample count exists "so a calibration GATE can tell
// measured-and-calibrated from never-measured". The context was the one place that dropped it.
const trustRule = (id: string, when: Record<string, string>): AdaptationRule => ({
  id, when,
  action: { kind: "skip_to_next_concept" },
  modulator: "M1",
  explanation_short: "confiance calibrée",
});

const plainAnswer = {
  kind: "answer_submitted" as const, concept_id: "c", scene_id: "s",
  correct: true, time_ms: 0, hint_count: 0, difficulty: 0.5,
};

describe("trust calibration in the rule context — measured vs never measured", () => {
  it("a rule on trust does not fire for a learner whose trust was never audited", () => {
    const eng = new AdaptationEngine(
      [trustRule("r_trust_ok", { trust_calibration_abs: "<=0.15" })],
      defaultLearnerState("l"),
    );

    const decision = eng.onSignal(plainAnswer);

    expect(eng.getState().concept_states["c"]!.trust_calibration).toBeUndefined();
    expect(decision.rule_id).toBeNull();
    expect(decision.next_action.kind).toBe("advance_to_next_scene");
  });

  it("the same rule fires once an audit has measured a calibration of zero", () => {
    const eng = new AdaptationEngine(
      [trustRule("r_trust_ok", { trust_calibration_abs: "<=0.15" })],
      defaultLearnerState("l"),
    );

    // Every planted flaw caught, no false positive: a real measurement whose value is 0.
    const decision = eng.onSignal(grounded({ planted: 2, caught: 2, false_positives: 0 }));

    const cs = eng.getState().concept_states["c"]!;
    expect(cs.trust_calibration_samples).toBe(1);
    expect(Math.abs(cs.trust_calibration!)).toBeLessThanOrEqual(0.15);
    expect(decision.rule_id).toBe("r_trust_ok");
  });

  it("exposes the sample count, so a bundle can ask the question itself", () => {
    const eng = new AdaptationEngine(
      [trustRule("r_never_audited", { trust_calibration_samples: "==0" })],
      defaultLearnerState("l"),
    );

    expect(eng.onSignal(plainAnswer).rule_id).toBe("r_never_audited");
  });

  it("a rule on the signed value is likewise inert until trust is measured", () => {
    // `>= -1` is true of every value the schema allows, so if the key were published as 0 this
    // would fire on absence — the direction the `?? 0` default was most likely to be wrong in.
    const eng = new AdaptationEngine(
      [trustRule("r_any_trust", { trust_calibration: ">=-1" })],
      defaultLearnerState("l"),
    );

    expect(eng.onSignal(plainAnswer).rule_id).toBeNull();
  });
});

// The CONFIDENCE axis published the same fiction one line earlier, by a different route:
// `confidence_calibration` is not optional, `defaultConceptState` sets it to 0, and the context read
// it unconditionally. Repairing trust alone would have left the identical conflation next to it —
// and `isCalibrated`/`isMiscalibrated` (index.ts:179-189) already gate on `calibration_samples >= 1`
// exactly as their trust siblings do. The pair is safe to gate: `recordConfidenceSample` is the only
// writer of the number and it increments the count in the same return, and the cross-lesson profile
// carries whole concept states by spread, so a measured gap never travels without its sample count.
describe("confidence calibration in the rule context — measured vs never measured", () => {
  // `>= 0` is true of every |gap| there is, so it separates "measured" from "absent" and nothing
  // else — no dependence on what the EWMA happens to produce for a given answer.
  const anyMeasured = { confidence_calibration_abs: ">=0" };

  it("a rule on calibration does not fire before the learner has self-assessed", () => {
    const eng = new AdaptationEngine(
      [trustRule("r_any_calibration", anyMeasured)],
      defaultLearnerState("l"),
    );

    const decision = eng.onSignal(plainAnswer);

    expect(eng.getState().concept_states["c"]!.calibration_samples).toBeUndefined();
    expect(decision.rule_id).toBeNull();
  });

  it("the same rule fires on the answer that carries a confidence rating", () => {
    const eng = new AdaptationEngine(
      [trustRule("r_any_calibration", anyMeasured)],
      defaultLearnerState("l"),
    );

    const decision = eng.onSignal({ ...plainAnswer, confidence: 3 });

    expect(eng.getState().concept_states["c"]!.calibration_samples).toBe(1);
    expect(decision.rule_id).toBe("r_any_calibration");
  });

  it("exposes the confidence sample count too, on both signal kinds", () => {
    const eng = new AdaptationEngine(
      [trustRule("r_never_asked", { calibration_samples: "==0" })],
      defaultLearnerState("l"),
    );

    expect(eng.onSignal(plainAnswer).rule_id).toBe("r_never_asked");

    // `confidence_declared` records the sample before the context is built, so the count it
    // publishes is 1 — the same key, answering the same question, on the other signal kind.
    const declared = new AdaptationEngine(
      [trustRule("r_never_asked", { calibration_samples: "==0" })],
      defaultLearnerState("l"),
    );
    expect(
      declared.onSignal({ kind: "confidence_declared", value: 3, concept_id: "c", scene_id: "s" })
        .rule_id,
    ).toBeNull();
  });
});
