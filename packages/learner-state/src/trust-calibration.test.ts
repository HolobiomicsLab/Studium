import { describe, it, expect } from "vitest";
import {
  defaultConceptState, recordJudgmentAudit,
  isTrustCalibrated, isTrustMiscalibrated, isOverTrusting,
  TRUST_WELL_BAND, TRUST_CALIBRATION_LAMBDA,
  type ConceptState,
} from "./index.js";

const cs = (over: Partial<ConceptState> = {}): ConceptState => ({ ...defaultConceptState("c"), ...over });

// "trust calibration" = how well the learner's trust in a flawed AI reading of a REAL executed
// result tracks ground truth. missed planted flaws => OVER-TRUST (credulous, +); false positives
// (flagging sound claims) => OVER-DISTRUST (skeptical, -). Fed ONLY by grounded judgment scenes.
describe("trust calibration (judgment-over-artifact)", () => {
  it("a fresh concept is unmeasured: trust fields absent, predicates all false", () => {
    const c0 = cs();
    expect(c0.trust_calibration).toBeUndefined();
    expect(c0.trust_calibration_samples).toBeUndefined();
    expect(isTrustCalibrated(c0)).toBe(false);
    expect(isTrustMiscalibrated(c0)).toBe(false);
    expect(isOverTrusting(c0)).toBe(false);
  });

  it("a perfect audit (caught all, no false positives) is well-calibrated trust", () => {
    const c1 = recordJudgmentAudit(cs(), { planted: 2, caught: 2, false_positives: 0 });
    expect(c1.trust_calibration).toBeCloseTo(0, 5);
    expect(c1.trust_calibration_samples).toBe(1);
    expect(isTrustCalibrated(c1)).toBe(true);
    expect(isOverTrusting(c1)).toBe(false);
  });

  it("missing planted flaws is OVER-TRUST (positive) and trips isOverTrusting", () => {
    // planted 2, caught 0 -> over_trust = 2/2 = 1 -> gap +1 -> 0.5*1 = 0.5 (> band)
    const c1 = recordJudgmentAudit(cs(), { planted: 2, caught: 0, false_positives: 0 });
    expect(c1.trust_calibration).toBeCloseTo(0.5, 5);
    expect(isOverTrusting(c1)).toBe(true);
    expect(isTrustMiscalibrated(c1)).toBe(true);
    expect(isTrustCalibrated(c1)).toBe(false);
  });

  it("false positives are OVER-DISTRUST (negative) — miscalibrated but NOT over-trusting", () => {
    // planted 2, caught 2, fp 2 -> over_distrust = min(2,2)/2 = 1 -> gap -1 -> -0.5
    const c1 = recordJudgmentAudit(cs(), { planted: 2, caught: 2, false_positives: 2 });
    expect(c1.trust_calibration).toBeCloseTo(-0.5, 5);
    expect(isTrustMiscalibrated(c1)).toBe(true);
    expect(isOverTrusting(c1)).toBe(false);       // skepticism is not the certification-gate direction
  });

  it("false positives are capped at planted so over-distrust stays bounded in [-1,0]", () => {
    const c1 = recordJudgmentAudit(cs(), { planted: 2, caught: 2, false_positives: 9 });
    expect(c1.trust_calibration).toBeCloseTo(-0.5, 5); // min(9,2)/2 = 1, not 4.5
  });

  it("accumulated audits form a RUNNING AVERAGE (EWMA), not last-write-wins", () => {
    const c1 = recordJudgmentAudit(cs(), { planted: 2, caught: 0, false_positives: 0 }); // gap +1 -> 0.5
    const c2 = recordJudgmentAudit(c1, { planted: 2, caught: 2, false_positives: 0 });    // gap 0 -> 0.5*0.5 = 0.25
    expect(c2.trust_calibration).toBeCloseTo(0.25, 5);
    expect(c2.trust_calibration_samples).toBe(2);
  });

  it("isOverTrusting requires MEASURED + over the band (never an unmeasured concept)", () => {
    expect(isOverTrusting(cs({ trust_calibration: 0.9 }))).toBe(false);                       // unmeasured -> false
    expect(isOverTrusting(cs({ trust_calibration: 0.9, trust_calibration_samples: 1 }))).toBe(true);
    expect(isOverTrusting(cs({ trust_calibration: -0.9, trust_calibration_samples: 1 }))).toBe(false);
    expect(isOverTrusting(cs({ trust_calibration: 0.1, trust_calibration_samples: 1 }))).toBe(false);
  });

  it("band + lambda constants are the documented values", () => {
    expect(TRUST_WELL_BAND).toBe(0.4);
    expect(TRUST_CALIBRATION_LAMBDA).toBe(0.5);
  });
});
