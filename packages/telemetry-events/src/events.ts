import { z } from "zod";

const BaseEventSchema = z.object({
  event_id: z.string().uuid(),
  learner_pseudonym: z.string().min(1),
  lesson_id: z.string().min(1),
  // bundle_version (M5.7) — convention : `<schema_version>:<bundle_id>@<validated_at>`.
  // Exemple : `"1.1:demo-metabolomics-001@2026-05-08T10:00:00Z"`.
  // Optionnel et rétro-compatible : les events ingérés sans bundle_version
  // sont bucketed sous `"unversioned"` côté collector.
  bundle_version: z.string().min(1).default("unversioned"),
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

// ADR 006 amendment v1.1 — reasoning_signal emitted during M5.9 discussion scenes.
// Strict: aucun texte libre transmis. Le payload ne contient qu'un label de
// classification (signal) et des scalaires (confidence, turn_index).
export const ReasoningSignalSchema = BaseEventSchema.extend({
  type: z.literal("reasoning_signal"),
  scene_id: z.string(),
  signal: z.enum([
    "justification",
    "hypothesis",
    "question",
    "counterexample",
    "synthesis",
  ]),
  confidence: z.number().min(0).max(1),
  turn_index: z.number().int().nonnegative(),
});

// ADR 006 amendment v1.1 — ai_audit_result emitted at the end of an
// ai_audit/ai_critique scene. Strict: aucun texte libre transmis, uniquement
// des compteurs (planted_errors, true_positives, false_positives, missed).
export const AIAuditResultSchema = BaseEventSchema.extend({
  type: z.literal("ai_audit_result"),
  scene_id: z.string(),
  planted_errors: z.number().int().nonnegative(),
  true_positives: z.number().int().nonnegative(),
  false_positives: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
});

// ADR 006 amendment v1.3 — journal_entry_submitted emitted when a learner
// submits a journal entry (reflective writing). Strict: aucun texte libre
// transmis — uniquement la longueur (compteur) et des métadonnées de révision.
export const JournalEntrySubmittedSchema = BaseEventSchema.extend({
  type: z.literal("journal_entry_submitted"),
  scene_id: z.string(),
  entry_length: z.number().int().nonnegative(),
  revision_count: z.number().int().nonnegative(),
  is_revision: z.boolean(),
});

// ADR 006 amendment v1.3 — cooperative_vote emitted per individual vote
// during a cooperative scene. Strict: aucun contenu de vote ni identité
// individuelle — uniquement question_id, taille de groupe et flag
// aggregate_only (v1 = true ; anti-attribution individuelle).
export const CooperativeVoteSchema = BaseEventSchema.extend({
  type: z.literal("cooperative_vote"),
  question_id: z.string(),
  group_size: z.number().int().min(2).max(6),
  aggregate_only: z.boolean(),
});

// ADR 006 amendment v1.3 — cooperative_convergence emitted at the end of a
// cooperative synthesis. Strict: aucun texte transmis — uniquement la
// distribution de confiance agrégée (histogramme à 5 bins) et la couverture
// des rôles (ratio).
export const CooperativeConvergenceSchema = BaseEventSchema.extend({
  type: z.literal("cooperative_convergence"),
  synthesis_id: z.string(),
  group_size: z.number().int().min(2).max(6),
  confidence_distribution_aggregated: z
    .array(z.number().int().nonnegative())
    .length(5),
  role_coverage: z.number().min(0).max(1),
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
  ReasoningSignalSchema,
  AIAuditResultSchema,
  JournalEntrySubmittedSchema,
  CooperativeVoteSchema,
  CooperativeConvergenceSchema,
]);

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
