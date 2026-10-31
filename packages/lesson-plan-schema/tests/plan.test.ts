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

  it("validates optional concept_refs and prerequisites as string arrays", () => {
    const plan = {
      ...samplePlan,
      concepts: [
        {
          id: "dependent",
          title: "Dependent",
          description: "Builds on a prerequisite",
          bloom_level_target: "apply",
          prerequisites: ["prerequisite"],
        },
      ],
      scene_outlines: [
        { ...samplePlan.scene_outlines[0], concept_refs: ["dependent"] },
      ],
    };
    expect(validatePlan(plan).valid).toBe(true);
    expect(validatePlan({
      ...plan,
      scene_outlines: [{ ...plan.scene_outlines[0], concept_refs: "dependent" }],
    }).valid).toBe(false);
    expect(validatePlan({
      ...plan,
      concepts: [{ ...plan.concepts[0], prerequisites: "prerequisite" }],
    }).valid).toBe(false);
  });
});

describe("loadSchema", () => {
  it("returns an object with $id", () => {
    const s = loadSchema() as Record<string, unknown>;
    expect(s["$id"]).toBe("https://studium.dev/schemas/lesson-plan/v1");
  });
});

describe("Evidence schema (ADR 014)", () => {
  const validRef = {
    perspicacite_doc_id: "doc-123",
    title: "Test paper",
    authors: ["Smith, J."],
    excerpt: "A relevant excerpt",
    relevance_score: 0.85,
    prov_derived_from: "urn:perspicacite:doc:123",
  };

  const validAsset = {
    asset_type: "spectrum_viewer_svg",
    payload_inline: "<svg></svg>",
    prov_derived_from: "urn:abs:rocrate:abc",
  };

  const validMetadata = {
    enricher_version: "1.0",
    perspicacite_mode_used: "advanced",
    timestamp: "2026-05-13T10:00:00Z",
    degraded: false,
  };

  it("accepts a fully populated Evidence", () => {
    const ev = {
      bibliographic_refs: [validRef],
      case_studies: [{ title: "Case A", summary: "Summary", source_refs: ["doc-123"] }],
      abs_asset: validAsset,
      enrichment_metadata: validMetadata,
    };
    const result = validatePlan({
      schema_version: "1.0",
      id: "plan-001",
      title: "Test",
      language: "en",
      target: "L3",
      duration_minutes: 45,
      learning_objectives: [{ id: "obj-1", description: "x", bloom_level: "understand" }],
      scene_outlines: [{ id: "s1", type: "concept", title: "Concept", objective_refs: [], evidence: ev }],
      corpus_refs: [],
      status: "draft",
    });
    expect(result.valid).toBe(true);
  });

  it("requires enrichment_metadata in Evidence", () => {
    const result = validatePlan({
      schema_version: "1.0",
      id: "plan-001",
      title: "Test",
      language: "en",
      target: "L3",
      duration_minutes: 45,
      learning_objectives: [{ id: "obj-1", description: "x", bloom_level: "understand" }],
      scene_outlines: [{ id: "s1", type: "concept", title: "Concept", objective_refs: [], evidence: {} }],
      corpus_refs: [],
      status: "draft",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects relevance_score out of [0,1]", () => {
    const ev = {
      bibliographic_refs: [{ ...validRef, relevance_score: 1.5 }],
      enrichment_metadata: validMetadata,
    };
    const result = validatePlan({
      schema_version: "1.0",
      id: "plan-001",
      title: "Test",
      language: "en",
      target: "L3",
      duration_minutes: 45,
      learning_objectives: [{ id: "obj-1", description: "x", bloom_level: "understand" }],
      scene_outlines: [{ id: "s1", type: "concept", title: "Concept", objective_refs: [], evidence: ev }],
      corpus_refs: [],
      status: "draft",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects unknown asset_type", () => {
    const ev = {
      abs_asset: { ...validAsset, asset_type: "unknown_type" },
      enrichment_metadata: validMetadata,
    };
    const result = validatePlan({
      schema_version: "1.0",
      id: "plan-001",
      title: "Test",
      language: "en",
      target: "L3",
      duration_minutes: 45,
      learning_objectives: [{ id: "obj-1", description: "x", bloom_level: "understand" }],
      scene_outlines: [{ id: "s1", type: "concept", title: "Concept", objective_refs: [], evidence: ev }],
      corpus_refs: [],
      status: "draft",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects unknown perspicacite_mode_used", () => {
    const ev = {
      enrichment_metadata: { ...validMetadata, perspicacite_mode_used: "bogus" },
    };
    const result = validatePlan({
      schema_version: "1.0",
      id: "plan-001",
      title: "Test",
      language: "en",
      target: "L3",
      duration_minutes: 45,
      learning_objectives: [{ id: "obj-1", description: "x", bloom_level: "understand" }],
      scene_outlines: [{ id: "s1", type: "concept", title: "Concept", objective_refs: [], evidence: ev }],
      corpus_refs: [],
      status: "draft",
    });
    expect(result.valid).toBe(false);
  });

  it("SceneOutline accepts optional evidence_override", () => {
    const result = validatePlan({
      schema_version: "1.0",
      id: "plan-001",
      title: "Test",
      language: "en",
      target: "L3",
      duration_minutes: 45,
      learning_objectives: [{ id: "obj-1", description: "x", bloom_level: "understand" }],
      scene_outlines: [{
        id: "s1",
        type: "concept",
        title: "Concept",
        objective_refs: [],
        evidence: { enrichment_metadata: { enricher_version: "1.0", perspicacite_mode_used: "advanced", timestamp: "2026-05-13T10:00:00Z", degraded: false } },
        evidence_override: "force",
      }],
      corpus_refs: [],
      status: "draft",
    });
    expect(result.valid).toBe(true);
  });
});
