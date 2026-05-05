import { describe, it, expect } from "vitest";
import { validatePlan, loadSchema, type LessonPlan } from "../src/index";

const samplePlan: LessonPlan = {
  schema_version: "1.0",
  id: "plan-001",
  title: "Introduction à la métabolomique",
  language: "fr",
  target: "L3",
  duration_minutes: 45,
  learning_objectives: [
    { id: "obj-1", description: "Comprendre les bases de la métabolomique", bloom_level: "understand" }
  ],
  scene_outlines: [
    { id: "sc-1", type: "intro", title: "Présentation du domaine", objective_refs: ["obj-1"] },
    { id: "sc-2", type: "concept", title: "Techniques d'analyse", objective_refs: ["obj-1"] }
  ],
  corpus_refs: [
    { ref_id: "ref-1", ref_type: "doi", doi: "10.1073/pnas.1319030111", resolved: true }
  ],
  status: "draft",
  metadata: { subject: "Métabolomique", author: "Prof. Dupont", created: "2026-05-05" }
};

describe("validatePlan", () => {
  it("rejects empty object", () => {
    const result = validatePlan({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects plan missing required fields", () => {
    const result = validatePlan({ schema_version: "1.0", id: "x" });
    expect(result.valid).toBe(false);
  });

  it("accepts a valid sample plan", () => {
    const result = validatePlan(samplePlan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects plan with invalid bloom_level", () => {
    const bad = { ...samplePlan, learning_objectives: [{ id: "o1", description: "x", bloom_level: "unknown" }] };
    const result = validatePlan(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects plan with invalid status", () => {
    const bad = { ...samplePlan, status: "published" };
    const result = validatePlan(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects plan with invalid scene type", () => {
    const bad = {
      ...samplePlan,
      scene_outlines: [{ id: "sc-1", type: "unknown_type", title: "X", objective_refs: [] }]
    };
    const result = validatePlan(bad);
    expect(result.valid).toBe(false);
  });
});

describe("loadSchema", () => {
  it("returns an object with $id", () => {
    const s = loadSchema() as Record<string, unknown>;
    expect(s["$id"]).toBe("https://studium.dev/schemas/lesson-plan/v1");
  });
});
