// The TRUST-calibration gates (north-star destination): a learner who systematically OVER-TRUSTS
// flawed AI readings of real executed results is held back — certification withheld + not skipped —
// even when competent. Over-DIStrust (skepticism) is the safe direction: not withheld from
// certification, but still nudged via the symmetric skip gate.
import { describe, it, expect } from "vitest";
import { defaultConceptState, type ConceptState, type LearnerState } from "@studium/learner-state";
import { buildMasteryClaims } from "./mastery-claims.js";
import { buildLwgCalibration } from "./graph-nav.js";

const mastered = (over: Partial<ConceptState>): ConceptState => ({
  ...defaultConceptState("c1"), alpha: 9, beta: 1, total_attempts: 5, total_correct: 5, ...over,
});

const stateWith = (cs: ConceptState): LearnerState => ({
  lesson_id: "l", schema_version: "1.0", concept_states: { [cs.concept_id]: cs },
  scenes_completed: [], scenes_replayed: {}, history: [],
  session_started_at: "2026-06-27T00:00:00Z", last_decision: null,
});

const opts = { pseudonym: "p", sessionId: "s", bundleId: "b", activeUniverseId: "", threshold: 0.8 };
const hasClaim = (doc: { "@graph": Array<Record<string, unknown>> }) =>
  doc["@graph"].some((n) => n["@type"] === "asb:Claim");

describe("certification gate — over-trust withholds the mastery claim", () => {
  it("a mastered BUT measured-over-trusting concept is NOT certified", () => {
    const doc = buildMasteryClaims(stateWith(mastered({ trust_calibration: 0.6, trust_calibration_samples: 1 })), opts);
    expect(hasClaim(doc)).toBe(false);
  });

  it("a mastered + well-trust-calibrated concept IS certified", () => {
    const doc = buildMasteryClaims(stateWith(mastered({ trust_calibration: 0.1, trust_calibration_samples: 1 })), opts);
    expect(hasClaim(doc)).toBe(true);
  });

  it("OVER-DISTRUST (skepticism) is NOT withheld — only over-trust is the gated direction", () => {
    const doc = buildMasteryClaims(stateWith(mastered({ trust_calibration: -0.6, trust_calibration_samples: 1 })), opts);
    expect(hasClaim(doc)).toBe(true);
  });

  it("UNMEASURED trust never gates (a concept never judged is not withheld)", () => {
    const doc = buildMasteryClaims(stateWith(mastered({ trust_calibration: 0.9 /* but no samples */ })), opts);
    expect(hasClaim(doc)).toBe(true);
  });
});

describe("skip gate — trust-miscalibration marks a concept do-not-skip (either direction)", () => {
  it("over-trust → concept gated false", () => {
    const g = buildLwgCalibration({ c1: mastered({ trust_calibration: 0.6, trust_calibration_samples: 1 }) });
    expect(g["concept:c1"]).toBe(false);
  });
  it("over-distrust → concept gated false (symmetric recalibration nudge)", () => {
    const g = buildLwgCalibration({ c1: mastered({ trust_calibration: -0.6, trust_calibration_samples: 1 }) });
    expect(g["concept:c1"]).toBe(false);
  });
  it("a well-trust-calibrated + confidence-calibrated concept is NOT gated", () => {
    const g = buildLwgCalibration({
      c1: mastered({ trust_calibration: 0.1, trust_calibration_samples: 1, confidence_calibration: 0, calibration_samples: 1 }),
    });
    expect(g["concept:c1"]).toBeUndefined();
  });
});
