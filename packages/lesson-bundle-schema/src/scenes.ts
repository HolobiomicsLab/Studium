import { z } from "zod";

// ADR 014 — Evidence schemas (Zod local copy ; lesson-plan-schema uses AJV, incompatible direct import)

export const BibliographicRefSchema = z.object({
  perspicacite_doc_id: z.string().min(1),
  doi: z.string().optional(),
  title: z.string().min(1),
  authors: z.array(z.string()),
  year: z.number().int().optional(),
  excerpt: z.string().max(500),
  relevance_score: z.number().min(0).max(1),
  prov_derived_from: z.string().min(1),
});

export const CaseStudySchema = z.object({
  title: z.string().min(1),
  summary: z.string().max(1000),
  source_refs: z.array(z.string()),
});

export const ABSAssetSchema = z.object({
  asset_type: z.enum([
    "spectrum_viewer_svg",
    "code_snippet",
    "data_csv",
    "protocol_card_md",
    "script_snippet",
    // interactive / first-class rich types (rendered client-side):
    "plot_spec",       // payload_inline = a Vega-Lite or Plotly JSON spec (zoom/hover)
    "equation_latex",  // payload_inline = a LaTeX string, rendered with KaTeX/MathJax
  ]),
  payload_inline: z.string().optional(),
  payload_path: z.string().optional(),
  abs_task_card_id: z.string().optional(),
  prov_derived_from: z.string().min(1),
});

export const EnrichmentMetadataSchema = z.object({
  enricher_version: z.string().min(1),
  perspicacite_mode_used: z.enum(["basic", "advanced", "profound", "agentic", "passages"]),
  timestamp: z.string().min(1),
  degraded: z.boolean(),
});

export const EvidenceSchema = z.object({
  bibliographic_refs: z.array(BibliographicRefSchema).optional(),
  case_studies: z.array(CaseStudySchema).optional(),
  abs_asset: ABSAssetSchema.optional(),
  enrichment_metadata: EnrichmentMetadataSchema,
});

export const SceneTypeSchema = z.enum([
  "intro", "concept", "quiz", "meta_checkpoint",
  "reproduction", "ai_critique", "discussion",
]);

export const ReasoningSignalEnum = z.enum([
  "justification", "hypothesis", "question", "counterexample", "synthesis",
]);

export const SceneBaseSchema = z.object({
  id: z.string().min(1),
  type: SceneTypeSchema,
  title: z.string().min(1),
  objective_refs: z.array(z.string()),
  concept_refs: z.array(z.string()),
  estimated_seconds: z.number().int().nonnegative(),
  adaptation_hooks: z.array(z.string()),
});

// ADR 010 — flat shape : champs métier à la racine, pas d'enveloppe `content`.

export const IntroSceneSchema = SceneBaseSchema.extend({
  type: z.literal("intro"),
  markdown: z.string(),
  evidence: EvidenceSchema.optional(),
});

export const ConceptSceneSchema = SceneBaseSchema.extend({
  type: z.literal("concept"),
  markdown: z.string(),
  image_path: z.string().optional(),
  evidence: EvidenceSchema.optional(),
});

const ChoiceSchema = z.object({
  id: z.string(), text: z.string(), correct: z.boolean(),
});

export const QuizSceneSchema = SceneBaseSchema.extend({
  type: z.literal("quiz"),
  question: z.string(),
  choices: z.array(ChoiceSchema).min(2).max(6),
  feedback_correct: z.string(),
  feedback_incorrect: z.string(),
  hints: z.array(z.string()),
});

export const MetaCheckpointSceneSchema = SceneBaseSchema.extend({
  type: z.literal("meta_checkpoint"),
  pre_question: z.string(),
  post_question: z.string(),
  scale_labels: z.array(z.string()).length(5),
});

export const ReproductionStepSchema = z.object({
  step_id: z.string(),
  instruction: z.string(),
  expected_input_schema: z.record(z.unknown()),
  expected_output: z.union([z.string(), z.record(z.unknown())]),
});

// The result of executing the capsule once at author time (the "reference run"), so a learner
// sees a real, graded analysis rather than only step text. Populated by tools/capsule_runner.py;
// absent when the capsule is heavy/deferred or type-checked-only.
export const ReferenceRunSchema = z.object({
  ran: z.boolean(),
  passed: z.boolean(),
  landmark: z.string().nullable(),
  figure_path: z.string().nullable(),
  checks: z.array(z.object({ check: z.string(), passed: z.boolean() })),
  provenance: z.object({
    capsule_doi: z.string().nullable(),
    cmd: z.array(z.string()),
    env: z.string(),
  }),
});

export const ReproductionSceneSchema = SceneBaseSchema.extend({
  type: z.literal("reproduction"),
  task_card_id: z.string(),
  steps: z.array(ReproductionStepSchema).min(1),
  prov_derived_from: z.string().url().optional(),
  image_path: z.string().optional(),         // rendered figure from the reference run
  reference_result: ReferenceRunSchema.optional(),
  evidence: EvidenceSchema.optional(),
});

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  flaws_expected: z.array(z.string()),
});

export const AICritiqueRubricSchema = z.object({
  completeness: z.number().min(0).max(1),
  evidence_quality: z.number().min(0).max(1),
  tone: z.number().min(0).max(1),
});

export const AICritiqueSceneSchema = SceneBaseSchema.extend({
  type: z.literal("ai_critique"),
  claims: z.array(ClaimSchema).min(1).max(3),
  rubric: AICritiqueRubricSchema,
});

export const DiscussionSceneSchema = SceneBaseSchema.extend({
  type: z.literal("discussion"),
  topic: z.string().min(1),
  seed_claim: z.string().min(1),
  target_signals: z.array(ReasoningSignalEnum).min(1),
  max_turns: z.number().int().positive().max(50),
});

export const SceneSchema = z.discriminatedUnion("type", [
  IntroSceneSchema,
  ConceptSceneSchema,
  QuizSceneSchema,
  MetaCheckpointSceneSchema,
  ReproductionSceneSchema,
  AICritiqueSceneSchema,
  DiscussionSceneSchema,
]);

export type Scene = z.infer<typeof SceneSchema>;
