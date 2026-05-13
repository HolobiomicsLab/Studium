import { describe, it, expect } from "vitest";
import { LessonBundleSchema, IntroSceneSchema, QuizSceneSchema, AdaptationRuleSchema, DiscussionSceneSchema } from "../src/index";

const VALID_BUNDLE = {
  schema_version: "1.2",
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
});
