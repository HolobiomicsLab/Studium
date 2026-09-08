import { describe, it, expect } from "vitest";
import { defaultConceptState, type ConceptState, type LearnerState } from "@studium/learner-state";
import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";
import { buildMasteryClaims } from "./mastery-claims.js";
import { buildLwgCalibration, graphAwareNextIndex } from "./graph-nav.js";

// a MASTERED concept (alpha high -> mastery 0.9 >= theta) above the attempts floor.
const mastered = (over: Partial<ConceptState> = {}): ConceptState => ({
  ...defaultConceptState("c"), alpha: 9, beta: 1, total_attempts: 5, total_correct: 5, ...over,
});

function stateWith(concept_states: Record<string, ConceptState>): LearnerState {
  return {
    lesson_id: "l", schema_version: "1.0", concept_states,
    scenes_completed: [], scenes_replayed: {}, history: [],
    session_started_at: "2026-06-27T00:00:00Z", last_decision: null,
  };
}
const OPTS = { pseudonym: "p", sessionId: "s", bundleId: "b", activeUniverseId: "", threshold: 0.8 };
const certified = (doc: ReturnType<typeof buildMasteryClaims>) =>
  doc["@graph"].filter((n) => n["@type"] === "asb:Claim").map((n) => n.object as string).sort();

describe("calibration CERTIFICATION gate (mastery-claims, OVERCONFIDENCE-only)", () => {
  it("certifies a mastered concept that is calibrated, unmeasured, OR underconfident", () => {
    const doc = buildMasteryClaims(stateWith({
      cal: mastered({ concept_id: "cal", calibration_samples: 2, confidence_calibration: 0.1 }),
      unm: mastered({ concept_id: "unm" }),                                                         // unmeasured -> not penalized
      under: mastered({ concept_id: "under", calibration_samples: 2, confidence_calibration: -0.6 }), // underconfident MASTER -> still certified, never punished
    }), OPTS);
    expect(certified(doc)).toEqual(["cal", "under", "unm"]);
  });

  it("WITHHOLDS only a measured-OVERconfident mastered concept (the dangerous direction)", () => {
    const doc = buildMasteryClaims(stateWith({
      over: mastered({ concept_id: "over", calibration_samples: 2, confidence_calibration: 0.6 }),
    }), OPTS);
    expect(certified(doc)).toEqual([]); // mastery the learner is overconfident about -> not certifiable
  });
});

const LWG: LearningWorkflowGraph = {
  schema_version: "1.0", course_id: "c",
  nodes: [
    { id: "concept:fourier", node_kind: "concept", title: "Fourier", bloom_level: "understand" },
    { id: "concept:fft", node_kind: "concept", title: "FFT", bloom_level: "apply" },
  ],
  edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:fft", target: "concept:fourier" }],
};
const scenes = [
  { id: "s0", type: "intro", concept_refs: [] },
  { id: "s1", type: "concept", concept_refs: ["fourier"] },
  { id: "s2", type: "quiz", concept_refs: ["fft"] },
] as { id: string; type: string; concept_refs: string[] }[];

describe("calibration SKIP gate (graph-nav)", () => {
  it("buildLwgCalibration marks ONLY measured-miscalibrated concepts false", () => {
    const g = buildLwgCalibration({
      a: mastered({ concept_id: "a", calibration_samples: 1, confidence_calibration: 0.6 }), // over
      b: mastered({ concept_id: "b", calibration_samples: 1, confidence_calibration: 0.1 }), // calibrated
      c: mastered({ concept_id: "c" }),                                                       // unmeasured
    });
    expect(g).toEqual({ "concept:a": false });
  });

  it("skip-on-mastery does NOT skip a mastered-but-miscalibrated concept", () => {
    // fourier is mastered (0.9). Without the gate, skip-on-mastery skips it -> lands on fft (s2).
    const ungated = graphAwareNextIndex(scenes, 0, LWG, { "concept:fourier": 0.9 }, 0.8, true, {});
    expect(ungated.index).toBe(2);
    expect(ungated.reason).toBe("skip_mastered");
    // WITH the gate (fourier miscalibrated), the skip stops AT fourier (s1) — the learner does it.
    const gated = graphAwareNextIndex(scenes, 0, LWG, { "concept:fourier": 0.9 }, 0.8, true, { "concept:fourier": false });
    expect(gated.index).toBe(1);
    expect(gated.reason).toBe("advance");
  });
});
