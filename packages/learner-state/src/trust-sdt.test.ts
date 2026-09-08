import { describe, it, expect } from "vitest";
import { defaultConceptState, recordJudgmentSdt, type ConceptState } from "./index.js";

const cs = (over: Partial<ConceptState> = {}): ConceptState => ({ ...defaultConceptState("c"), ...over });

// recordJudgmentSdt pools the SAME grounded audits into a per-concept signal-detection diagnostic
// (A' competence + criterion c bias), SEPARATE from and non-interfering with the signed gap fold.
describe("recordJudgmentSdt — pooled per-concept SDT diagnostic", () => {
  it("the offline keyword path (sound_total 0) is a NO-OP — no noise trials, SDT undefined", () => {
    const c1 = recordJudgmentSdt(cs(), { planted: 3, caught: 1, false_positives: 0, sound_total: 0 });
    expect(c1.trust_sdt_counts).toBeUndefined();
    expect(c1.trust_discrimination).toBeUndefined();
    // a back-compat audit with no sound_total field behaves identically
    const c2 = recordJudgmentSdt(cs(), { planted: 3, caught: 1, false_positives: 0 });
    expect(c2.trust_sdt_counts).toBeUndefined();
  });

  it("a deck audit records the full 2x2 and populates A' + c", () => {
    const c1 = recordJudgmentSdt(cs(), { planted: 4, caught: 3, false_positives: 1, sound_total: 4 });
    expect(c1.trust_sdt_counts).toEqual({ hits: 3, misses: 1, false_alarms: 1, correct_rejections: 3 });
    expect(c1.trust_discrimination).toBeGreaterThan(0.5); // discriminates above chance
    expect(typeof c1.trust_bias_c).toBe("number");
  });

  it("pools RAW counts across audits (accumulation, not replacement)", () => {
    const c1 = recordJudgmentSdt(cs(), { planted: 4, caught: 3, false_positives: 1, sound_total: 4 });
    const c2 = recordJudgmentSdt(c1, { planted: 4, caught: 4, false_positives: 0, sound_total: 4 });
    expect(c2.trust_sdt_counts).toEqual({ hits: 7, misses: 1, false_alarms: 1, correct_rejections: 7 });
  });

  it("systematic OVER-TRUST (misses flaws, never false-alarms) -> conservative c > 0", () => {
    const c1 = recordJudgmentSdt(cs(), { planted: 8, caught: 1, false_positives: 0, sound_total: 8 });
    expect(c1.trust_bias_c).toBeGreaterThan(0);
  });

  it("systematic OVER-DISTRUST (flags sound claims) -> liberal c < 0", () => {
    const c1 = recordJudgmentSdt(cs(), { planted: 8, caught: 8, false_positives: 7, sound_total: 8 });
    expect(c1.trust_bias_c).toBeLessThan(0);
  });

  it("clamps impossible inputs (caught>planted, fa>sound_total) instead of trusting them", () => {
    const c1 = recordJudgmentSdt(cs(), { planted: 2, caught: 9, false_positives: 9, sound_total: 2 });
    expect(c1.trust_sdt_counts).toEqual({ hits: 2, misses: 0, false_alarms: 2, correct_rejections: 0 });
  });

  it("does NOT touch the signed-gap fields (the two accounts are independent)", () => {
    const c1 = recordJudgmentSdt(cs(), { planted: 4, caught: 2, false_positives: 1, sound_total: 4 });
    expect(c1.trust_calibration).toBeUndefined();
    expect(c1.trust_calibration_samples).toBeUndefined();
  });
});
