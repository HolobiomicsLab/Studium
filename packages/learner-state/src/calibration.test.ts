import { describe, it, expect } from "vitest";
import {
  defaultConceptState, recordConfidenceSample,
  isCalibrated, isMiscalibrated, isOverconfident, CALIBRATION_WELL_BAND, type ConceptState,
} from "./index.js";

const cs = (over: Partial<ConceptState> = {}): ConceptState => ({ ...defaultConceptState("c"), ...over });

describe("calibration samples + gate predicates", () => {
  it("recordConfidenceSample updates the gap AND counts the sample", () => {
    const c0 = cs({ alpha: 1, beta: 1 });               // mastery 0.5
    expect(c0.calibration_samples).toBeUndefined();      // fresh = unmeasured
    const c1 = recordConfidenceSample(c0, 4);            // declared 1.0 vs actual 0.5 -> +0.5 overconfident
    expect(c1.calibration_samples).toBe(1);
    expect(c1.confidence_calibration).toBeCloseTo(0.5, 5);
    expect(recordConfidenceSample(c1, 4).calibration_samples).toBe(2);
  });

  it("isCalibrated requires a measurement AND a small gap", () => {
    expect(isCalibrated(cs())).toBe(false);                                              // unmeasured
    expect(isCalibrated(cs({ calibration_samples: 1, confidence_calibration: 0.1 }))).toBe(true);
    expect(isCalibrated(cs({ calibration_samples: 1, confidence_calibration: 0.5 }))).toBe(false); // out of band
  });

  it("isMiscalibrated is true ONLY when measured AND out of band (either direction)", () => {
    expect(isMiscalibrated(cs())).toBe(false);                                            // unmeasured -> never penalized
    expect(isMiscalibrated(cs({ calibration_samples: 1, confidence_calibration: 0.1 }))).toBe(false); // in band
    expect(isMiscalibrated(cs({ calibration_samples: 1, confidence_calibration: 0.5 }))).toBe(true);  // overconfident
    expect(isMiscalibrated(cs({ calibration_samples: 1, confidence_calibration: -0.5 }))).toBe(true); // underconfident
  });

  it("isOverconfident is true ONLY when measured AND over the band (the certification-gate direction)", () => {
    expect(isOverconfident(cs())).toBe(false);                                            // unmeasured
    expect(isOverconfident(cs({ calibration_samples: 1, confidence_calibration: 0.5 }))).toBe(true);  // overconfident
    expect(isOverconfident(cs({ calibration_samples: 1, confidence_calibration: -0.5 }))).toBe(false); // underconfident -> NOT
    expect(isOverconfident(cs({ calibration_samples: 1, confidence_calibration: 0.1 }))).toBe(false);  // in band
  });

  it("confidence_calibration is last-write-wins (lambda=1.0): the stored gap is the LATEST sample's", () => {
    // first sample: declared 4 (1.0) vs actual 0.5 -> +0.5 ; second: declared 2 (0.5) vs actual 0.5 -> 0.0
    const c1 = recordConfidenceSample(cs({ alpha: 1, beta: 1 }), 4);
    const c2 = recordConfidenceSample(c1, 2);
    expect(c2.calibration_samples).toBe(2);            // samples accumulate (a measured-count flag)
    expect(c2.confidence_calibration).toBeCloseTo(0, 5); // ...but the gap reflects only the LATEST sample
  });

  it("an unmeasured concept is NEITHER calibrated nor miscalibrated (no trivial gate bypass)", () => {
    const fresh = cs({ confidence_calibration: 0 });     // default 0 gap, but never measured
    expect(isCalibrated(fresh)).toBe(false);
    expect(isMiscalibrated(fresh)).toBe(false);
  });

  it("band constant mirrors the host verdict band", () => {
    expect(CALIBRATION_WELL_BAND).toBe(0.4);
  });
});
