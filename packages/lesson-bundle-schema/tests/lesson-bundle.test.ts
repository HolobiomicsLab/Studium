import { describe, it, expect } from "vitest";
import { LessonBundleSchema, IntroSceneSchema, QuizSceneSchema, AdaptationRuleSchema, DiscussionSceneSchema, ConceptSceneSchema, ReproductionSceneSchema, SpotTheFlawSceneSchema, ExplainBackSceneSchema, ComparisonSceneSchema, SummaryAuditSceneSchema, PromptPracticeSceneSchema, CommunicationSimSceneSchema, SCHEMA_VERSION } from "../src/index";

function _minimalBundle() {
  return {
    schema_version: "1.4",
    bundle_id: "b-min",
    source_plan_id: "p-min",
    metadata: { title: "Min", target: "L3", duration_minutes: 10, language: "fr", discipline: "test" },
    concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
    scenes: [{ id: "s1", type: "intro", title: "S1", objective_refs: [], concept_refs: [], estimated_seconds: 30, adaptation_hooks: [], markdown: "hi" }],
    rules: [],
    validated_by: "tst",
    validated_at: "2026-06-11T00:00:00Z",
  };
}

const _LWG = { schema_version: "1.0", course_id: "c1",
  nodes: [{ id: "concept:a", node_kind: "concept", title: "A", bloom_level: "understand" }], edges: [] };

describe("LessonBundle learning_workflow_graph", () => {
  it("accepts a bundle WITHOUT an LWG", () => {
    expect(LessonBundleSchema.safeParse(_minimalBundle()).success).toBe(true);
  });
  it("accepts a bundle WITH a valid LWG", () => {
    expect(LessonBundleSchema.safeParse({ ..._minimalBundle(), learning_workflow_graph: _LWG }).success).toBe(true);
  });
  it("accepts learning_workflow_graph: null", () => {
    expect(LessonBundleSchema.safeParse({ ..._minimalBundle(), learning_workflow_graph: null }).success).toBe(true);
  });
  it("rejects a malformed LWG", () => {
    expect(LessonBundleSchema.safeParse({ ..._minimalBundle(), learning_workflow_graph: { nodes: "nope" } }).success).toBe(false);
  });
});

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

  it("validates SpotTheFlawScene (active-learning)", () => {
    const scene = {
      id: "s-spot-1", type: "spot_the_flaw", title: "Repère l'erreur",
      objective_refs: [], concept_refs: ["c-remplissage"], estimated_seconds: 120, adaptation_hooks: [],
      flawed_content: "L'azote est 1s² 2s² 2p⁴ avec des électrons appariés.",
      claims: [{ id: "f1", text: "config fausse", flaws_expected: ["hund", "2p3"] }],
      model_correction: "L'azote est 1s² 2s² 2p³ (règle de Hund).",
      rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
    };
    expect(() => SpotTheFlawSceneSchema.parse(scene)).not.toThrow();
    expect(() => LessonBundleSchema.parse({ ...VALID_BUNDLE, scenes: [VALID_BUNDLE.scenes[0], scene] })).not.toThrow();
  });

  it("validates ExplainBackScene (active-learning)", () => {
    const scene = {
      id: "s-exp-1", type: "explain_back", title: "Explique",
      objective_refs: [], concept_refs: ["c-orbitales-formes"], estimated_seconds: 180, adaptation_hooks: [],
      prompt: "Pourquoi la 2p a-t-elle deux lobes ?",
      key_points: [{ id: "kp1", text: "fonction d'onde", cues: ["fonction"] }],
      model_explanation: "La 2p change de signe : plan nodal.",
      rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
    };
    expect(() => ExplainBackSceneSchema.parse(scene)).not.toThrow();
    expect(() => LessonBundleSchema.parse({ ...VALID_BUNDLE, scenes: [VALID_BUNDLE.scenes[0], scene] })).not.toThrow();
  });

  it("rejects SpotTheFlawScene without claims", () => {
    const invalid = {
      id: "s-spot-2", type: "spot_the_flaw", title: "x",
      objective_refs: [], concept_refs: [], estimated_seconds: 60, adaptation_hooks: [],
      flawed_content: "x", claims: [], model_correction: "y",
      rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
    };
    expect(() => SpotTheFlawSceneSchema.parse(invalid)).toThrow();
  });

  it("rejects SpotTheFlawScene whose claim has empty flaws_expected (RC-1)", () => {
    const invalid = {
      id: "s-spot-3", type: "spot_the_flaw", title: "x",
      objective_refs: [], concept_refs: [], estimated_seconds: 60, adaptation_hooks: [],
      flawed_content: "x", claims: [{ id: "f", text: "t", flaws_expected: [] }], model_correction: "y",
      rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
    };
    expect(() => SpotTheFlawSceneSchema.parse(invalid)).toThrow();
  });

  it("rejects ExplainBackScene without key_points and with empty cues (RC-1)", () => {
    const base = {
      id: "s-exp-2", type: "explain_back", title: "x",
      objective_refs: [], concept_refs: [], estimated_seconds: 60, adaptation_hooks: [],
      prompt: "p", model_explanation: "m",
      rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
    };
    expect(() => ExplainBackSceneSchema.parse({ ...base, key_points: [] })).toThrow();
    expect(() => ExplainBackSceneSchema.parse({ ...base, key_points: [{ id: "k", text: "t", cues: [] }] })).toThrow();
  });

  it("validates ComparisonScene (active-learning wave-1)", () => {
    const scene = {
      id: "s-cmp-1", type: "comparison", title: "Cours IA vs cours enseignant",
      objective_refs: [], concept_refs: ["c-remplissage"], estimated_seconds: 180, adaptation_hooks: [],
      prompt: "Relève la valeur ajoutée du cours de l'enseignant.",
      artifact_a: "Cours rédigé par une IA…",
      artifact_b: "Cours rédigé par l'enseignant…",
      key_points: [{ id: "kp1", text: "exemple ancré", cues: ["exemple"] }],
      model_answer: "L'enseignant ajoute des exemples ancrés et un fil pédagogique.",
      rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
    };
    expect(() => ComparisonSceneSchema.parse(scene)).not.toThrow();
    expect(() => LessonBundleSchema.parse({ ...VALID_BUNDLE, scenes: [VALID_BUNDLE.scenes[0], scene] })).not.toThrow();
  });

  it("rejects ComparisonScene without key_points / with empty cues (RC-1)", () => {
    const base = {
      id: "s-cmp-2", type: "comparison", title: "x",
      objective_refs: [], concept_refs: [], estimated_seconds: 60, adaptation_hooks: [],
      prompt: "p", artifact_a: "a", artifact_b: "b", model_answer: "m",
      rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
    };
    expect(() => ComparisonSceneSchema.parse({ ...base, key_points: [] })).toThrow();
    expect(() => ComparisonSceneSchema.parse({ ...base, key_points: [{ id: "k", text: "t", cues: [] }] })).toThrow();
  });

  it("validates SummaryAuditScene (active-learning wave-1)", () => {
    const scene = {
      id: "s-aud-1", type: "summary_audit", title: "Audit du résumé IA",
      objective_refs: [], concept_refs: ["c-remplissage"], estimated_seconds: 180, adaptation_hooks: [],
      source_content: "Texte source complet…",
      ai_summary: "Résumé IA qui omet un point clé…",
      claims: [{ id: "o1", text: "omission de la règle de Hund", flaws_expected: ["hund"] }],
      model_correction: "Le résumé omet la règle de Hund.",
      rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
    };
    expect(() => SummaryAuditSceneSchema.parse(scene)).not.toThrow();
    expect(() => LessonBundleSchema.parse({ ...VALID_BUNDLE, scenes: [VALID_BUNDLE.scenes[0], scene] })).not.toThrow();
  });

  it("rejects SummaryAuditScene without claims / with empty flaws_expected (RC-1)", () => {
    const base = {
      id: "s-aud-2", type: "summary_audit", title: "x",
      objective_refs: [], concept_refs: [], estimated_seconds: 60, adaptation_hooks: [],
      source_content: "s", ai_summary: "a", model_correction: "m",
      rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
    };
    expect(() => SummaryAuditSceneSchema.parse({ ...base, claims: [] })).toThrow();
    expect(() => SummaryAuditSceneSchema.parse({ ...base, claims: [{ id: "f", text: "t", flaws_expected: [] }] })).toThrow();
  });

  it("validates PromptPracticeScene (active-learning wave-1); starter_prompt optional", () => {
    const scene = {
      id: "s-pp-1", type: "prompt_practice", title: "Affine ton prompt",
      objective_refs: [], concept_refs: ["c-remplissage"], estimated_seconds: 180, adaptation_hooks: [],
      task: "Rédige un prompt pour faire expliquer la règle de Hund.",
      key_points: [{ id: "kp1", text: "consigne claire", cues: ["consigne"] }],
      model_prompt: "Tu es un tuteur. Explique la règle de Hund avec un exemple…",
      rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
    };
    expect(() => PromptPracticeSceneSchema.parse(scene)).not.toThrow();
    expect(() => PromptPracticeSceneSchema.parse({ ...scene, starter_prompt: "Explique Hund." })).not.toThrow();
    expect(() => LessonBundleSchema.parse({ ...VALID_BUNDLE, scenes: [VALID_BUNDLE.scenes[0], scene] })).not.toThrow();
  });

  it("rejects PromptPracticeScene without key_points / with empty cues (RC-1)", () => {
    const base = {
      id: "s-pp-2", type: "prompt_practice", title: "x",
      objective_refs: [], concept_refs: [], estimated_seconds: 60, adaptation_hooks: [],
      task: "t", model_prompt: "m",
      rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
    };
    expect(() => PromptPracticeSceneSchema.parse({ ...base, key_points: [] })).toThrow();
    expect(() => PromptPracticeSceneSchema.parse({ ...base, key_points: [{ id: "k", text: "t", cues: [] }] })).toThrow();
  });

  it("validates CommunicationSimScene (active-learning wave-2 D2)", () => {
    const scene = {
      id: "s-com-1", type: "communication_sim", title: "Explique à un·e camarade, sans jargon",
      objective_refs: [], concept_refs: ["c-orbitales-formes"], estimated_seconds: 240, adaptation_hooks: [],
      scenario: "Fin du TD ; un·e camarade pas au point te demande de l'aide. Ton rôle : pair·e. Public : L1.",
      prompt: "Explique-lui pourquoi la 2p a deux lobes, sans jargon.",
      key_points: [{ id: "kp1", text: "deux zones simples", cues: ["deux zones"] }],
      model_response: "Imagine deux zones de chaque côté, séparées par un couloir vide.",
      rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
    };
    expect(() => CommunicationSimSceneSchema.parse(scene)).not.toThrow();
    expect(() => LessonBundleSchema.parse({ ...VALID_BUNDLE, scenes: [VALID_BUNDLE.scenes[0], scene] })).not.toThrow();
  });

  it("rejects CommunicationSimScene without key_points / with empty cues (RC-1)", () => {
    const base = {
      id: "s-com-2", type: "communication_sim", title: "x",
      objective_refs: [], concept_refs: [], estimated_seconds: 60, adaptation_hooks: [],
      scenario: "s", prompt: "p", model_response: "m",
      rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
    };
    expect(() => CommunicationSimSceneSchema.parse({ ...base, key_points: [] })).toThrow();
    expect(() => CommunicationSimSceneSchema.parse({ ...base, key_points: [{ id: "k", text: "t", cues: [] }] })).toThrow();
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

const _UNIV = {
  variants: [
    { id: "baseline", description: "d", decisions: { prereq_strictness: "standard", scaffolding: "standard", pacing: "standard" } },
    { id: "remedial", description: "d", decisions: { prereq_strictness: "lenient", scaffolding: "heavy", pacing: "standard" } },
  ],
  active: "baseline",
};
describe("LessonBundle universes", () => {
  it("accepts a bundle with a universes projection", () => {
    expect(LessonBundleSchema.safeParse({ ..._minimalBundle(), universes: _UNIV }).success).toBe(true);
  });
  it("accepts a bundle without universes (and null)", () => {
    expect(LessonBundleSchema.safeParse(_minimalBundle()).success).toBe(true);
    expect(LessonBundleSchema.safeParse({ ..._minimalBundle(), universes: null }).success).toBe(true);
  });
  it("rejects a universes projection missing active", () => {
    expect(LessonBundleSchema.safeParse({ ..._minimalBundle(), universes: { variants: _UNIV.variants } }).success).toBe(false);
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
