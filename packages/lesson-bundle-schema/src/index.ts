import { z } from "zod";
import { SceneSchema } from "./scenes";
import { AdaptationRuleSchema } from "./rules";

export * from "./scenes";
export * from "./rules";

export const BloomLevelSchema = z.enum([
  "remember", "understand", "apply", "analyze", "evaluate", "create",
]);

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

export const LessonBundleSchema = z.object({
  schema_version: z.literal("1.0"),
  bundle_id: z.string(),
  source_plan_id: z.string(),
  metadata: BundleMetadataSchema,
  concepts: z.array(ConceptSchema).min(1),
  scenes: z.array(SceneSchema).min(1),
  rules: z.array(AdaptationRuleSchema),
  validated_by: z.string().min(3),
  validated_at: z.string().datetime(),
});

export type LessonBundle = z.infer<typeof LessonBundleSchema>;
