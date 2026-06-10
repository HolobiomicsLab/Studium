import { describe, it, expect } from "vitest";
import { validateGraph, type LearningWorkflowGraph } from "./index";

const FIXTURE: LearningWorkflowGraph = {
  schema_version: "1.0",
  course_id: "signal-processing-101",
  nodes: [
    { id: "concept:fourier-basics", node_kind: "concept", title: "Fourier basics", bloom_level: "understand" },
    { id: "concept:fft", node_kind: "concept", title: "FFT", bloom_level: "apply" },
    { id: "task:quiz-fft", node_kind: "task", title: "FFT quiz", scene_type: "quiz", objective_refs: ["obj:fft-1"] },
  ],
  edges: [
    { id: "e1", relation: "prerequisite_for", source: "concept:fft", target: "concept:fourier-basics" },
    { id: "e2", relation: "assesses", source: "task:quiz-fft", target: "concept:fft", objective_id: "obj:fft-1", bloom_level: "apply" },
  ],
};

describe("validateGraph", () => {
  it("accepts a well-formed graph", () => {
    const r = validateGraph(FIXTURE);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an unknown edge relation", () => {
    const bad = { ...FIXTURE, edges: [{ id: "e3", relation: "causes", source: "a", target: "b" }] };
    const r = validateGraph(bad);
    expect(r.valid).toBe(false);
  });

  it("rejects a node with an unknown node_kind", () => {
    const bad = { ...FIXTURE, nodes: [{ id: "x", node_kind: "module", title: "X" }] };
    const r = validateGraph(bad);
    expect(r.valid).toBe(false);
  });
});
