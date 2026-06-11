import { z } from "zod";

export const ConceptStateSchema = z.object({
  concept_id: z.string(),
  alpha: z.number().positive(),
  beta: z.number().positive(),
  consecutive_errors: z.number().int().nonnegative(),
  total_attempts: z.number().int().nonnegative(),
  total_correct: z.number().int().nonnegative(),
  confidence_calibration: z.number().min(-1).max(1),
});

export type ConceptState = z.infer<typeof ConceptStateSchema>;

export const SignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer_submitted"),
    concept_id: z.string(), scene_id: z.string(),
    correct: z.boolean(), time_ms: z.number().nonnegative(),
    hint_count: z.number().int().nonnegative(),
    difficulty: z.number().min(0).max(1) }),
  z.object({ kind: z.literal("confidence_declared"),
    scene_id: z.string(), value: z.number().int().min(0).max(4),
    // M3: the concept this self-assessment is about. Optional for backward-compat —
    // when absent, the calibration loop is a no-op (no concept to attach the gap to).
    concept_id: z.string().optional() }),
  z.object({ kind: z.literal("scene_entered"), scene_id: z.string() }),
  z.object({ kind: z.literal("scene_completed"),
    scene_id: z.string(), duration_ms: z.number().nonnegative() }),
]);

export type Signal = z.infer<typeof SignalSchema>;

export const NextActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("advance_to_next_scene") }),
  z.object({ kind: z.literal("replay_current_scene"), reason: z.string() }),
  z.object({ kind: z.literal("skip_to_next_concept") }),
  z.object({ kind: z.literal("show_calibration_panel"), target_concept: z.string() }),
  z.object({ kind: z.literal("show_explanation_panel") }),
]);

export const DecisionSchema = z.object({
  next_action: NextActionSchema,
  rule_id: z.string().nullable(),
  explanation_short: z.string().nullable(),
  modulator: z.enum(["M1", "M2", "M3", "M6"]).nullable(),
});

export type Decision = z.infer<typeof DecisionSchema>;

export const HistoryEntrySchema = z.object({
  timestamp: z.string(),
  scene_id: z.string(),
  signal: SignalSchema,
  decision: DecisionSchema,
});

export const LearnerStateSchema = z.object({
  lesson_id: z.string(),
  schema_version: z.literal("1.0"),
  concept_states: z.record(z.string(), ConceptStateSchema),
  scenes_completed: z.array(z.string()),
  scenes_replayed: z.record(z.string(), z.number().int().nonnegative()),
  history: z.array(HistoryEntrySchema).max(50),
  session_started_at: z.string(),
  last_decision: DecisionSchema.nullable(),
});

export type LearnerState = z.infer<typeof LearnerStateSchema>;

export function masteryOf(s: ConceptState): number {
  return s.alpha / (s.alpha + s.beta);
}

/** M3 metacognitive calibration smoothing factor. λ=1.0 means a single meta_checkpoint
 * fully reflects the fresh declared-vs-actual gap (no Brier history needed for one checkpoint);
 * lower values blend with the prior. Kept at 1.0 so one observation produces a signal large
 * enough to trip the calibration rule (|gap|≥0.4 ⇒ |calibration|≥0.4). */
export const CALIBRATION_LAMBDA = 1.0;

/** M3: update a concept's confidence_calibration from a declared confidence (0..4) compared
 * against the concept's ACTUAL accumulated competence (masteryOf). Pure; touches only
 * confidence_calibration. Sign convention: POSITIVE = overconfident (declared > actual),
 * NEGATIVE = underconfident. EWMA-smoothed and clamped to [-1, 1]. */
export function updateCalibration(cs: ConceptState, declared0to4: number): ConceptState {
  const actual = masteryOf(cs);
  const declaredNorm = declared0to4 / 4;
  const signedError = declaredNorm - actual;
  const blended = (1 - CALIBRATION_LAMBDA) * cs.confidence_calibration + CALIBRATION_LAMBDA * signedError;
  const clamped = Math.max(-1, Math.min(1, blended));
  return { ...cs, confidence_calibration: clamped };
}

export function defaultConceptState(concept_id: string): ConceptState {
  return {
    concept_id, alpha: 1, beta: 1,
    consecutive_errors: 0, total_attempts: 0, total_correct: 0,
    confidence_calibration: 0,
  };
}

export function defaultLearnerState(lesson_id: string): LearnerState {
  return {
    lesson_id, schema_version: "1.0",
    concept_states: {}, scenes_completed: [],
    scenes_replayed: {}, history: [],
    session_started_at: new Date().toISOString(),
    last_decision: null,
  };
}
