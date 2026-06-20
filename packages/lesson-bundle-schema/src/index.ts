import { z } from "zod";
import { SceneSchema } from "./scenes";
import { AdaptationRuleSchema } from "./rules";
import { AssessmentBlueprintSchema } from "./blueprint";
import { LearningWorkflowGraphSchema } from "@studium/learning-workflow-schema";

export const SCHEMA_VERSION = "1.4";

export * from "./scenes";
export * from "./scene-assets";
export * from "./rules";
export * from "./blueprint";

export const BloomLevelSchema = z.enum([
  "remember", "understand", "apply", "analyze", "evaluate", "create",
]);
export type BloomLevel = z.infer<typeof BloomLevelSchema>;

export const ConceptSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  bloom_level_target: BloomLevelSchema,
});

export const BundleMetadataSchema = z.object({
  title: z.string(),
  target: z.string(),
  duration_minutes: z.number().int().positive(),
  language: z.string().min(2),
  discipline: z.string(),
});

export const UniverseVariantSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  decisions: z.record(z.string(), z.string()),   // decision_id -> option_id
});
export const UniversesSchema = z.object({
  variants: z.array(UniverseVariantSchema).min(1),
  active: z.string().min(1),
});
export type UniverseVariant = z.infer<typeof UniverseVariantSchema>;
export type Universes = z.infer<typeof UniversesSchema>;

export const LessonBundleSchema = z.object({
  schema_version: z.literal("1.4"),
  bundle_id: z.string(),
  source_plan_id: z.string(),
  metadata: BundleMetadataSchema,
  concepts: z.array(ConceptSchema).min(1),
  scenes: z.array(SceneSchema).min(1),
  rules: z.array(AdaptationRuleSchema),
  validated_by: z.string().min(3),
  validated_at: z.string().datetime(),
  assessment_blueprint: AssessmentBlueprintSchema.optional(),
  learning_workflow_graph: LearningWorkflowGraphSchema.nullish(),
  universes: UniversesSchema.nullish(),
});

export type LessonBundle = z.infer<typeof LessonBundleSchema>;
