import { describe, it, expect } from "vitest";
import { buildLwgMastery, sceneConceptId, firstSceneForConcept, graphAwareNextIndex } from "./graph-nav";
import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";

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
] as any[];

function cs(alpha: number, beta: number) {
  return { concept_id: "x", alpha, beta, consecutive_errors: 0, total_attempts: 0, total_correct: 0, confidence_calibration: 0 };
}

describe("graph-nav helpers", () => {
  it("buildLwgMastery re-prefixes concept_states keys to LWG concept ids", () => {
    const m = buildLwgMastery({ fourier: cs(9, 1) });
    expect(m["concept:fourier"]).toBeCloseTo(0.9);
  });
  it("sceneConceptId prefixes concept_refs[0]; null when none", () => {
    expect(sceneConceptId(scenes[1])).toBe("concept:fourier");
    expect(sceneConceptId(scenes[0])).toBeNull();
  });
  it("firstSceneForConcept finds the scene index by LWG concept id", () => {
    expect(firstSceneForConcept(scenes, "concept:fourier")).toBe(1);
    expect(firstSceneForConcept(scenes, "concept:nope")).toBe(-1);
  });
  it("advances normally when the next scene's concept is available", () => {
    expect(graphAwareNextIndex(scenes, 1, LWG, { "concept:fourier": 0.9 }, 0.8)).toBe(2);
  });
  it("advances to a concept-less scene without gating", () => {
    expect(graphAwareNextIndex(scenes, -1, LWG, {}, 0.8)).toBe(0);
  });
  it("routes to the unmet prerequisite when the next concept is locked", () => {
    expect(graphAwareNextIndex(scenes, 1, LWG, { "concept:fourier": 0.3 }, 0.8)).toBe(1);
  });
  it("returns null at end of scenes", () => {
    expect(graphAwareNextIndex(scenes, 2, LWG, { "concept:fourier": 0.9 }, 0.8)).toBeNull();
  });
});
