import { z } from "zod";

export const SceneTypeSchema = z.enum([
  "intro", "concept", "quiz", "meta_checkpoint",
  "reproduction", "ai_critique",
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
});

export const ConceptSceneSchema = SceneBaseSchema.extend({
  type: z.literal("concept"),
  markdown: z.string(),
  image_path: z.string().optional(),
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

export const ReproductionSceneSchema = SceneBaseSchema.extend({
  type: z.literal("reproduction"),
  task_card_id: z.string(),
  steps: z.array(ReproductionStepSchema).min(1),
  prov_derived_from: z.string().url().optional(),
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

export const SceneSchema = z.discriminatedUnion("type", [
  IntroSceneSchema,
  ConceptSceneSchema,
  QuizSceneSchema,
  MetaCheckpointSceneSchema,
  ReproductionSceneSchema,
  AICritiqueSceneSchema,
]);

export type Scene = z.infer<typeof SceneSchema>;
