import { z } from "zod";

const BaseEventSchema = z.object({
  event_id: z.string().uuid(),
  learner_pseudonym: z.string().min(1),
  lesson_id: z.string().min(1),
  bundle_version: z.string().min(1),
  client_timestamp: z.string().datetime({ offset: true }),
});

export const LessonStartedSchema = BaseEventSchema.extend({
  type: z.literal("lesson_started"),
  bundle_uri: z.string(),
});

export const SceneEnteredSchema = BaseEventSchema.extend({
  type: z.literal("scene_entered"),
  scene_id: z.string(),
  scene_type: z.string(),
});

export const SceneCompletedSchema = BaseEventSchema.extend({
  type: z.literal("scene_completed"),
  scene_id: z.string(),
  duration_ms: z.number().int().nonnegative(),
  success: z.boolean(),
});

export const QuizAnsweredSchema = BaseEventSchema.extend({
  type: z.literal("quiz_answered"),
  scene_id: z.string(),
  item_id: z.string(),
  correct: z.boolean(),
  response_time_ms: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
});

export const AdaptationAppliedSchema = BaseEventSchema.extend({
  type: z.literal("adaptation_applied"),
  rule_id: z.string(),
  signal: z.string(),
  modulator: z.string(),
  value: z.number(),
});

export const CritiqueSubmittedSchema = BaseEventSchema.extend({
  type: z.literal("critique_submitted"),
  scene_id: z.string(),
  llm_score: z.number().min(0).max(1),
  completion_rate: z.number().min(0).max(1),
});

export const LessonCompletedSchema = BaseEventSchema.extend({
  type: z.literal("lesson_completed"),
  total_duration_ms: z.number().int().nonnegative(),
  autonomy_ratio: z.number().min(0).max(1),
});

export const ConsentGrantedSchema = BaseEventSchema.extend({
  type: z.literal("consent_granted"),
  scope: z.enum(["A", "B", "C"]),
});

export const ForgetRequestedSchema = BaseEventSchema.extend({
  type: z.literal("forget_requested"),
});

export const TelemetryEventSchema = z.discriminatedUnion("type", [
  LessonStartedSchema,
  SceneEnteredSchema,
  SceneCompletedSchema,
  QuizAnsweredSchema,
  AdaptationAppliedSchema,
  CritiqueSubmittedSchema,
  LessonCompletedSchema,
  ConsentGrantedSchema,
  ForgetRequestedSchema,
]);

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
