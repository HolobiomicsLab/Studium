import { z } from "zod";

export const SceneTypeSchema = z.enum([
  "intro", "concept", "quiz", "meta_checkpoint",
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

export const IntroSceneSchema = SceneBaseSchema.extend({
  type: z.literal("intro"),
  content: z.object({ markdown: z.string() }),
});

export const ConceptSceneSchema = SceneBaseSchema.extend({
  type: z.literal("concept"),
  content: z.object({
    markdown: z.string(),
    image_path: z.string().optional(),
  }),
});

const ChoiceSchema = z.object({
  id: z.string(), text: z.string(), correct: z.boolean(),
});

export const QuizSceneSchema = SceneBaseSchema.extend({
  type: z.literal("quiz"),
  content: z.object({
    question: z.string(),
    choices: z.array(ChoiceSchema).min(2).max(6),
    feedback_correct: z.string(),
    feedback_incorrect: z.string(),
    hints: z.array(z.string()),
  }),
});

export const MetaCheckpointSceneSchema = SceneBaseSchema.extend({
  type: z.literal("meta_checkpoint"),
  content: z.object({
    pre_question: z.string(),
    post_question: z.string(),
    scale_labels: z.array(z.string()).length(5),
  }),
});

export const SceneSchema = z.discriminatedUnion("type", [
  IntroSceneSchema,
  ConceptSceneSchema,
  QuizSceneSchema,
  MetaCheckpointSceneSchema,
]);

export type Scene = z.infer<typeof SceneSchema>;
