import { z } from "zod";

export const ConceptStateSchema = z.object({
  concept_id: z.string(),
  alpha: z.number().positive(),
  beta: z.number().positive(),
  consecutive_errors: z.number().int().nonnegative(),
  total_attempts: z.number().int().nonnegative(),
  total_correct: z.number().int().nonnegative(),
  confidence_calibration: z.number().min(-1).max(1),
  // How many confidence observations have fed confidence_calibration. Optional + back-compatible
  // (absent ⇒ 0 ⇒ "never measured"). This is what lets a calibration GATE tell a well-calibrated
  // concept (gap small AND measured) apart from an unmeasured one (gap defaults to 0) — so a gate
  // cannot be passed trivially by never declaring confidence.
  calibration_samples: z.number().int().nonnegative().optional(),
  // JUDGMENT-OVER-ARTIFACT calibration (the north-star destination): how well the learner's TRUST in
  // a flawed AI reading of a REAL executed result tracks ground truth. Signed: POSITIVE = OVER-TRUST
  // (missed planted flaws ⇒ too credulous of a wrong reading), NEGATIVE = OVER-DISTRUST (false
  // positives ⇒ flagged sound claims). DISTINCT from confidence_calibration (trust-in-output, not
  // confidence-in-self). Fed ONLY by grounded spot_the_flaw scenes; optional + back-compatible
  // (absent ⇒ never measured). The samples count is the MEASURED flag the trust gates key on.
  // HONESTY BOUNDARY: only the OVER-TRUST direction is fed LIVE today — the offline flaw matcher
  // reports false_positives=0 (it carries the planted-flaw answer key, not the SOUND claims needed to
  // detect over-flagging), so in production trust_calibration only ever moves ≥0. The signed value +
  // symmetric gate are ready; over-distrust capture is pending a sound-claims signal from the matcher.
  trust_calibration: z.number().min(-1).max(1).optional(),
  trust_calibration_samples: z.number().int().nonnegative().optional(),
});

export type ConceptState = z.infer<typeof ConceptStateSchema>;

export const SignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer_submitted"),
    concept_id: z.string(), scene_id: z.string(),
    correct: z.boolean(), time_ms: z.number().nonnegative(),
    hint_count: z.number().int().nonnegative(),
    difficulty: z.number().min(0).max(1),
    // optional per-answer self-rated confidence (0..4) — the path toward CONTINUOUS calibration.
    // CAPTURE-READY but currently UNFED: no UI supplies per-answer confidence yet, so the only LIVE
    // calibration input today is the confidence_declared meta-checkpoint. When present, the engine
    // folds it into confidence_calibration on this answer + counts a sample.
    confidence: z.number().int().min(0).max(4).optional(),
    // JUDGMENT audit breakdown — set ONLY by the flawGrader when the spot_the_flaw scene is GROUNDED
    // in a real executed result (carries a reference_result). The engine folds it into
    // trust_calibration. `grounded` distinguishes a real-artifact judgment from an ungrounded one; a
    // non-grounded judgment scene never feeds trust_calibration (no real artifact to calibrate against).
    // `false_positives` is carried for the over-distrust direction but is 0 in production today (the
    // matcher cannot yet count over-flagging — see the trust_calibration honesty boundary above).
    judgment_audit: z.object({
      grounded: z.literal(true),
      planted: z.number().int().nonnegative(),
      caught: z.number().int().nonnegative(),
      false_positives: z.number().int().nonnegative(),
    }).optional() }),
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
 * enough to trip the calibration rule (|gap|≥0.4 ⇒ |calibration|≥0.4).
 *
 * The two capture paths use DIFFERENT λ: the deliberate meta_checkpoint keeps λ=1.0 (one self-assessment
 * = full signal, tripping the rule), while PER-ANSWER capture uses CALIBRATION_ANSWER_LAMBDA (<1) so its
 * accumulated samples form a genuine RUNNING AVERAGE — not last-write-wins. calibration_samples remains
 * the MEASURED/unmeasured flag the gates key on. */
export const CALIBRATION_LAMBDA = 1.0;

/** M3: update a concept's confidence_calibration from a declared confidence (0..4) compared
 * against the concept's ACTUAL accumulated competence (masteryOf). Pure; touches only
 * confidence_calibration. Sign convention: POSITIVE = overconfident (declared > actual),
 * NEGATIVE = underconfident. Blended by CALIBRATION_LAMBDA (currently 1.0 ⇒ last-write-wins: the
 * stored gap is the LATEST observation's, not a running average) and clamped to [-1, 1]. */
export function updateCalibration(cs: ConceptState, declared0to4: number, lambda: number = CALIBRATION_LAMBDA): ConceptState {
  const actual = masteryOf(cs);
  const declaredNorm = declared0to4 / 4;
  const signedError = declaredNorm - actual;
  const blended = (1 - lambda) * cs.confidence_calibration + lambda * signedError;
  const clamped = Math.max(-1, Math.min(1, blended));
  return { ...cs, confidence_calibration: clamped };
}

/** EWMA factor for PER-ANSWER (continuous) capture: <1 so accumulated per-answer samples form a genuine
 * RUNNING AVERAGE of the declared-vs-actual gap (not last-write-wins). Distinct from the meta-checkpoint
 * path, which stays λ=1.0 (a single deliberate self-assessment = full signal, tripping the 0.4 rule). */
export const CALIBRATION_ANSWER_LAMBDA = 0.4;

/** The calibration "well" band (mirrors host.ts calibrationVerdict): |confidence_calibration| within
 * this is well-calibrated; beyond it (in either direction) is miscalibrated. */
export const CALIBRATION_WELL_BAND = 0.4;

/** Record ONE confidence observation against a concept: update confidence_calibration (the signed
 * declared-vs-actual gap) AND increment calibration_samples. The sample count is what makes the
 * gates honest — see calibration_samples. Use this (not bare updateCalibration) wherever a confidence
 * is captured, so every gate can trust that "calibrated" means "measured AND in band". */
export function recordConfidenceSample(cs: ConceptState, declared0to4: number, lambda: number = CALIBRATION_LAMBDA): ConceptState {
  const updated = updateCalibration(cs, declared0to4, lambda);
  return { ...updated, calibration_samples: (cs.calibration_samples ?? 0) + 1 };
}

/** True once a concept has ≥1 confidence observation AND its gap is within the well band. A concept
 * with NO observation is NOT "calibrated" for gating — it is simply unmeasured. */
export function isCalibrated(cs: ConceptState, band: number = CALIBRATION_WELL_BAND): boolean {
  return (cs.calibration_samples ?? 0) >= 1 && Math.abs(cs.confidence_calibration) <= band;
}

/** True ONLY when calibration was MEASURED (≥1 sample) AND is out of the well band (EITHER direction).
 * Distinct from "not isCalibrated": an UNMEASURED concept is neither calibrated nor miscalibrated, so a
 * gate keyed on isMiscalibrated never penalizes a concept the learner was never asked to self-assess.
 * Used by the SKIP gate (a recalibration replay is a low-cost nudge in either direction). */
export function isMiscalibrated(cs: ConceptState, band: number = CALIBRATION_WELL_BAND): boolean {
  return (cs.calibration_samples ?? 0) >= 1 && Math.abs(cs.confidence_calibration) > band;
}

/** True ONLY when calibration was MEASURED (≥1 sample) AND the learner is OVERconfident beyond the band
 * (declared > actual). Used by the CERTIFICATION gate: withholding a mastery claim is reserved for the
 * DANGEROUS direction (overconfidence) — never for an underconfident-but-proven master, which would
 * turn a metacognition signal into a competence penalty. (For a genuinely-mastered concept, actual≥θ
 * caps the overconfident gap below the band, so this gate is by-design inert there and only bites a
 * non-mastered overconfident learner — i.e. it never withholds a real master's claim.) */
export function isOverconfident(cs: ConceptState, band: number = CALIBRATION_WELL_BAND): boolean {
  return (cs.calibration_samples ?? 0) >= 1 && cs.confidence_calibration > band;
}

// ---------------------------------------------------------------------------
// JUDGMENT-OVER-ARTIFACT (trust) calibration — the north-star destination dimension.
// Parallel to confidence_calibration but measuring TRUST-IN-OUTPUT vs ground truth, fed only by
// GROUNDED spot_the_flaw scenes (a flawed AI reading of a real executed result).
// ---------------------------------------------------------------------------

/** EWMA factor for accumulated grounded-judgment audits: <1 so repeated audits form a RUNNING
 * AVERAGE of the trust gap (not last-write-wins). One egregious audit (all flaws missed ⇒ gap +1)
 * already lands at λ (=0.5) > the band, so a single fully-credulous judgment trips the gate. */
export const TRUST_CALIBRATION_LAMBDA = 0.5;

/** The trust "well" band: |trust_calibration| within this is well-calibrated trust; beyond it (in
 * either direction) is mis-trust. Mirrors CALIBRATION_WELL_BAND. */
export const TRUST_WELL_BAND = 0.4;

export interface JudgmentAudit { planted: number; caught: number; false_positives: number; }

/** Fold ONE grounded-judgment audit into trust_calibration (+ count the sample). The trust gap is
 *   over_trust   = missed / planted               (failed to catch real flaws ⇒ too credulous, +)
 *   over_distrust = min(false_positives, planted) / planted   (flagged sound claims ⇒ too skeptical, -)
 *   gap = over_trust - over_distrust ∈ [-1, 1]
 * false_positives are capped at `planted` so over-distrust stays bounded and symmetric with
 * over-trust. Blended by `lambda` (EWMA; undefined prior treated as 0) and clamped to [-1, 1]. A
 * degenerate audit with no planted flaws is a no-op (nothing to calibrate against). Pure.
 * NOTE: the over-distrust term is exercised by unit tests but UNFED in production today — the flaw
 * matcher reports false_positives=0 (see [[trust_calibration]] honesty boundary), so live audits only
 * produce over_trust ≥ 0. The math is symmetric and ready the moment a false-positive count exists. */
export function recordJudgmentAudit(
  cs: ConceptState, audit: JudgmentAudit, lambda: number = TRUST_CALIBRATION_LAMBDA,
): ConceptState {
  const planted = Math.max(0, Math.floor(audit.planted));
  if (planted === 0) return cs; // no real flaws ⇒ trust is unmeasurable here
  const missed = Math.max(0, planted - Math.max(0, audit.caught));
  const overTrust = missed / planted;
  const overDistrust = Math.min(Math.max(0, audit.false_positives), planted) / planted;
  const gap = overTrust - overDistrust;
  const prior = cs.trust_calibration ?? 0;
  const blended = Math.max(-1, Math.min(1, (1 - lambda) * prior + lambda * gap));
  return { ...cs, trust_calibration: blended, trust_calibration_samples: (cs.trust_calibration_samples ?? 0) + 1 };
}

/** True once a concept has ≥1 grounded-judgment audit AND its trust gap is within the well band. An
 * unmeasured concept is NOT "trust-calibrated" for gating — it is simply unmeasured. */
export function isTrustCalibrated(cs: ConceptState, band: number = TRUST_WELL_BAND): boolean {
  return (cs.trust_calibration_samples ?? 0) >= 1 && Math.abs(cs.trust_calibration ?? 0) <= band;
}

/** True ONLY when trust was MEASURED (≥1 audit) AND out of the well band (EITHER direction). Used by
 * the SKIP gate (a recalibration replay is a low-cost nudge for over- OR under-trust). */
export function isTrustMiscalibrated(cs: ConceptState, band: number = TRUST_WELL_BAND): boolean {
  return (cs.trust_calibration_samples ?? 0) >= 1 && Math.abs(cs.trust_calibration ?? 0) > band;
}

/** True ONLY when trust was MEASURED (≥1 audit) AND the learner OVER-TRUSTS beyond the band (missed
 * real flaws in a flawed AI reading of a real result). The CERTIFICATION-gate direction: in an
 * AI-operated science world, credulity is the dangerous failure — over-DIStrust (skepticism) is not
 * withheld from certification. Mirrors isOverconfident (overconfidence-only). */
export function isOverTrusting(cs: ConceptState, band: number = TRUST_WELL_BAND): boolean {
  return (cs.trust_calibration_samples ?? 0) >= 1 && (cs.trust_calibration ?? 0) > band;
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
