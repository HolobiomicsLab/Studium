import { z } from "zod";
import { SceneSchema } from "./scenes";
import { AdaptationRuleSchema } from "./rules";
import { AssessmentBlueprintSchema } from "./blueprint";
import { LearningWorkflowGraphSchema } from "@studium/learning-workflow-schema";

export const SCHEMA_VERSION = "1.4";

export * from "./scenes";
export * from "./scene-assets";
export * from "./modulators";
export * from "./rules";
export * from "./blueprint";
export * from "./learner-item";
export * from "./course";

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

/**
 * Who wrote the bundle, so that every surface can say it honestly.
 * `teacher`: the ordinary route (a teacher drafts, reviews and validates).
 * `self_study`: the learner (or their agent) authored the lesson from references
 * they chose themselves; the answer keys of author-keyed scenes (quiz,
 * spot_the_flaw, …) were written by the person who will answer them.
 */
export const AuthoringModeSchema = z.enum(["teacher", "self_study"]);
export const BundleAuthoringSchema = z.object({
  mode: AuthoringModeSchema,
  author_is_learner: z.boolean().default(false),
  note: z.string().optional(),
});
export type AuthoringMode = z.infer<typeof AuthoringModeSchema>;
export type BundleAuthoring = z.infer<typeof BundleAuthoringSchema>;

export const BundleMetadataSchema = z.object({
  title: z.string(),
  target: z.string(),
  duration_minutes: z.number().int().positive(),
  language: z.string().min(2),
  discipline: z.string(),
  /** Absent on bundles built before 2026-10-30; readers treat absent as `teacher`. */
  authoring: BundleAuthoringSchema.optional(),
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
  /** For `prerequisite_for`, `source` is the dependent concept and `target` is its prerequisite.
   * This engine convention is consumed by `packages/lesson-session/src/graph-nav.ts`, so reverse an edge written in the relation name's natural reading. */
  learning_workflow_graph: LearningWorkflowGraphSchema.nullish(),
  universes: UniversesSchema.nullish(),
});

export type LessonBundle = z.infer<typeof LessonBundleSchema>;
