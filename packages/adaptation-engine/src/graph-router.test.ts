import { describe, it, expect } from "vitest";
import { availableConcepts, lockedConcepts, isAvailable, nextConcept, remediationTarget } from "./graph-router";
import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";

const LWG: LearningWorkflowGraph = {
  schema_version: "1.0", course_id: "sp",
  nodes: [
    { id: "concept:fourier", node_kind: "concept", title: "Fourier", bloom_level: "understand" },
    { id: "concept:fft", node_kind: "concept", title: "FFT", bloom_level: "apply" },
    { id: "concept:spectral", node_kind: "concept", title: "Spectral", bloom_level: "analyze" },
    { id: "task:s1", node_kind: "task", title: "quiz", scene_type: "quiz" },
  ],
  edges: [
    { id: "e1", relation: "prerequisite_for", source: "concept:fft", target: "concept:fourier" },
    { id: "e2", relation: "prerequisite_for", source: "concept:spectral", target: "concept:fft" },
    { id: "e3", relation: "assesses", source: "task:s1", target: "concept:fft" },
  ],
};

describe("GraphRouter", () => {
  it("a concept with no prerequisites is always available", () => {
    expect(isAvailable(LWG, "concept:fourier", {}, 0.8)).toBe(true);
  });
  it("a concept is locked until its prerequisites reach theta", () => {
    expect(isAvailable(LWG, "concept:fft", { "concept:fourier": 0.5 }, 0.8)).toBe(false);
    expect(isAvailable(LWG, "concept:fft", { "concept:fourier": 0.8 }, 0.8)).toBe(true);
  });
  it("availableConcepts gates on direct prereq mastery", () => {
    const av = availableConcepts(LWG, { "concept:fourier": 0.9 }, 0.8);
    expect(av).toContain("concept:fourier");
    expect(av).toContain("concept:fft");
    expect(av).not.toContain("concept:spectral");
  });
  it("lockedConcepts is the complement over concept nodes", () => {
    expect(lockedConcepts(LWG, {}, 0.8)).toEqual(["concept:fft", "concept:spectral"]);
  });
  it("nextConcept returns the first available, not-mastered, not-completed concept", () => {
    expect(nextConcept(LWG, { "concept:fourier": 0.9 }, 0.8, ["concept:fourier"])).toBe("concept:fft");
    expect(nextConcept(LWG, { "concept:fourier": 0.9, "concept:fft": 0.9 }, 0.8, [])).toBe("concept:spectral");
  });
  it("remediationTarget returns the weakest unmet prerequisite", () => {
    expect(remediationTarget(LWG, "concept:fft", { "concept:fourier": 0.3 }, 0.8)).toBe("concept:fourier");
    expect(remediationTarget(LWG, "concept:fourier", {}, 0.8)).toBeNull();
  });
  it("ignores non-concept nodes", () => {
    expect(availableConcepts(LWG, {}, 0.8)).not.toContain("task:s1");
  });

  it("nextConcept returns null when every concept is mastered", () => {
    const allMastered = { "concept:fourier": 0.9, "concept:fft": 0.9, "concept:spectral": 0.9 };
    expect(nextConcept(LWG, allMastered, 0.8, [])).toBeNull();
  });

  it("remediationTarget picks the weakest among multiple unmet prerequisites", () => {
    // a concept requiring BOTH fourier and fft; both unmet, fourier weaker
    const g = {
      ...LWG,
      nodes: [...LWG.nodes, { id: "concept:adv", node_kind: "concept", title: "Adv", bloom_level: "evaluate" }],
      edges: [
        ...LWG.edges,
        { id: "e4", relation: "prerequisite_for", source: "concept:adv", target: "concept:fourier" },
        { id: "e5", relation: "prerequisite_for", source: "concept:adv", target: "concept:fft" },
      ],
    };
    const weakest = remediationTarget(g as typeof LWG, "concept:adv", { "concept:fourier": 0.2, "concept:fft": 0.5 }, 0.8);
    expect(weakest).toBe("concept:fourier"); // 0.2 < 0.5
  });
});
