import { describe, it, expect } from "vitest";
import { LessonBundleSchema, IntroSceneSchema, QuizSceneSchema, AdaptationRuleSchema, DiscussionSceneSchema, ConceptSceneSchema, ReproductionSceneSchema, SCHEMA_VERSION } from "../src/index";

const VALID_BUNDLE = {
  schema_version: "1.4",
  bundle_id: "b-001",
  source_plan_id: "p-001",
  metadata: {
    title: "Métabolomique LC-MS",
    target: "L3",
    duration_minutes: 30,
    language: "fr",
    discipline: "métabolomique",
  },
  concepts: [
    { id: "c-001", title: "LC-MS", description: "Liquid chromatography MS",
      bloom_level_target: "understand" },
  ],
  scenes: [
    { id: "s-1", type: "intro", title: "Bienvenue",
      objective_refs: [], concept_refs: ["c-001"],
      estimated_seconds: 60, adaptation_hooks: [],
      markdown: "# Bienvenue" },
  ],
  rules: [
    { id: "r-1", when: { mastery_c: ">=0.8" },
      action: { kind: "skip_to_next_concept" },
      modulator: "M1", explanation_short: "Maîtrisé." },
  ],
  validated_by: "prof.test@example.com",
  validated_at: "2026-05-08T10:00:00Z",
};

describe("LessonBundleSchema", () => {
  it("accepts a valid bundle", () => {
    expect(() => LessonBundleSchema.parse(VALID_BUNDLE)).not.toThrow();
  });

  it("rejects bundle without validated_by (rule 003)", () => {
    const { validated_by, ...invalid } = VALID_BUNDLE;
    expect(() => LessonBundleSchema.parse(invalid)).toThrow();
  });

  it("rejects unknown scene_type", () => {
    const invalid = { ...VALID_BUNDLE,
      scenes: [{ ...VALID_BUNDLE.scenes[0], type: "nonsense_scene_type" }] };
    expect(() => LessonBundleSchema.parse(invalid)).toThrow();
  });

  it("validates IntroScene markdown (ADR 010 flat)", () => {
    const scene = { id: "s-1", type: "intro", title: "x",
      objective_refs: [], concept_refs: [], estimated_seconds: 30,
      adaptation_hooks: [], markdown: "hello" };
    expect(() => IntroSceneSchema.parse(scene)).not.toThrow();
  });

  it("validates QuizScene with choices (ADR 010 flat)", () => {
    const scene = { id: "s-q", type: "quiz", title: "Q1",
      objective_refs: [], concept_refs: [], estimated_seconds: 60,
      adaptation_hooks: [],
      question: "?",
      choices: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }],
      feedback_correct: "ok", feedback_incorrect: "non", hints: [] };
    expect(() => QuizSceneSchema.parse(scene)).not.toThrow();
  });

  it("validates AdaptationRule", () => {
    const rule = { id: "r-1", when: { mastery_c: ">=0.8" },
      action: { kind: "skip_to_next_concept" },
      modulator: "M1", explanation_short: "x" };
    expect(() => AdaptationRuleSchema.parse(rule)).not.toThrow();
  });

  it("rejects legacy schema_version 1.0 (ADR 010 bump)", () => {
    const invalid = { ...VALID_BUNDLE, schema_version: "1.0" };
    expect(() => LessonBundleSchema.parse(invalid)).toThrow();
  });

  it("validates DiscussionScene (ADR 012 v1.2)", () => {
    const scene = {
      id: "s-disc-1",
      type: "discussion",
      title: "Débat LC-MS",
      objective_refs: [],
      concept_refs: [],
      estimated_seconds: 600,
      adaptation_hooks: [],
      topic: "La métabolomique remplacera-t-elle la protéomique ?",
      seed_claim: "La métabolomique est plus rapide donc supérieure.",
      target_signals: ["justification", "counterexample", "synthesis"],
      max_turns: 12,
    };
    expect(() => DiscussionSceneSchema.parse(scene)).not.toThrow();
  });

  it("rejects DiscussionScene with invalid target_signal", () => {
    const scene = {
      id: "s-disc-1",
      type: "discussion",
      title: "x",
      objective_refs: [],
      concept_refs: [],
      estimated_seconds: 60,
      adaptation_hooks: [],
      topic: "x",
      seed_claim: "y",
      target_signals: ["invalid_signal"],
      max_turns: 5,
    };
    expect(() => DiscussionSceneSchema.parse(scene)).toThrow();
  });

  it("rejects legacy schema_version 1.1 (ADR 012 bump)", () => {
    const invalid = { ...VALID_BUNDLE, schema_version: "1.1" };
    expect(() => LessonBundleSchema.parse(invalid)).toThrow();
  });

  it("accepts bundle with assessment_blueprint (ADR 013, schema 1.3)", () => {
    const valid = {
      ...VALID_BUNDLE,
      schema_version: "1.4",
      assessment_blueprint: {
        dimensions: [
          {
            id: "critical_thinking",
            label: "Pensée critique",
            weight: 0.5,
            metrics: [
              { endpoint: "ai_literacy", field: "value", weight_in_dimension: 1.0 },
            ],
          },
          {
            id: "metacognition",
            label: "Métacognition",
            weight: 0.5,
            metrics: [
              { endpoint: "calibration", field: "brier_score", weight_in_dimension: 1.0 },
            ],
          },
        ],
      },
    };
    expect(() => LessonBundleSchema.parse(valid)).not.toThrow();
  });

  it("rejects blueprint where dimensions weights do not sum to 1", () => {
    const invalid = {
      ...VALID_BUNDLE,
      schema_version: "1.4",
      assessment_blueprint: {
        dimensions: [
          { id: "d1", label: "D1", weight: 0.3, metrics: [{ endpoint: "progress", field: "completion_rate", weight_in_dimension: 1.0 }] },
          { id: "d2", label: "D2", weight: 0.3, metrics: [{ endpoint: "progress", field: "completion_rate", weight_in_dimension: 1.0 }] },
        ],
      },
    };
    expect(() => LessonBundleSchema.parse(invalid)).toThrow();
  });

  it("rejects blueprint with invalid endpoint", () => {
    const invalid = {
      ...VALID_BUNDLE,
      schema_version: "1.4",
      assessment_blueprint: {
        dimensions: [{ id: "d1", label: "D1", weight: 1.0, metrics: [{ endpoint: "garbage", field: "x", weight_in_dimension: 1.0 }] }],
      },
    };
    expect(() => LessonBundleSchema.parse(invalid)).toThrow();
  });

  it("rejects legacy schema_version 1.2", () => {
    const invalid = { ...VALID_BUNDLE, schema_version: "1.2" };
    expect(() => LessonBundleSchema.parse(invalid)).toThrow();
  });

  it("rejects legacy schema_version 1.3 (ADR 014 bump)", () => {
    const invalid = { ...VALID_BUNDLE, schema_version: "1.3" };
    expect(() => LessonBundleSchema.parse(invalid)).toThrow();
  });
});

describe("Evidence on bundle scenes (ADR 014, schema 1.4)", () => {
  const validEvidence = {
    enrichment_metadata: {
      enricher_version: "1.0",
      perspicacite_mode_used: "advanced",
      timestamp: "2026-05-13T10:00:00Z",
      degraded: false,
    },
  };

  it("SCHEMA_VERSION is bumped to 1.4", () => {
    expect(SCHEMA_VERSION).toBe("1.4");
  });

  it("IntroScene accepts optional evidence", () => {
    const scene = {
      id: "s1",
      type: "intro",
      title: "Intro",
      objective_refs: [],
      concept_refs: [],
      estimated_seconds: 30,
      adaptation_hooks: [],
      markdown: "# Intro",
      evidence: validEvidence,
    };
    expect(() => IntroSceneSchema.parse(scene)).not.toThrow();
  });

  it("ConceptScene accepts optional evidence", () => {
    const scene = {
      id: "s2",
      type: "concept",
      title: "Concept",
      objective_refs: [],
      concept_refs: [],
      estimated_seconds: 60,
      adaptation_hooks: [],
      markdown: "## Concept",
      evidence: validEvidence,
    };
    expect(() => ConceptSceneSchema.parse(scene)).not.toThrow();
  });

  it("ReproductionScene accepts optional evidence", () => {
    const scene = {
      id: "s3",
      type: "reproduction",
      title: "Repro",
      objective_refs: [],
      concept_refs: [],
      estimated_seconds: 120,
      adaptation_hooks: [],
      task_card_id: "tc-001",
      steps: [{ step_id: "st1", instruction: "x", expected_input_schema: { type: "object" }, expected_output: "y" }],
      evidence: validEvidence,
    };
    expect(() => ReproductionSceneSchema.parse(scene)).not.toThrow();
  });
});
