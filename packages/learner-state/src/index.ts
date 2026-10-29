import { z } from "zod";
import { computeSdt } from "./sdt.js";

export const ConceptStateSchema = z.object({
  concept_id: z.string(),
  alpha: z.number().positive(),
  beta: z.number().positive(),
  consecutive_errors: z.number().int().nonnegative(),
  total_attempts: z.number().int().nonnegative(),
  total_correct: z.number().int().nonnegative(),
  // Attempts on this concept whose correctness was never measured (INT-STUDIUM-035 candidate 2:
  // a free-text answer graded offline by the substring matcher). Deliberately NOT folded into
  // `total_attempts`, which is read as evidence — a rule keyed on `total_attempts >= n` must not
  // be satisfied by answers nobody graded. Published so the absence is countable rather than
  // invisible, the same reason the collector publishes `n_score_source_known` beside
  // `keyword_graded_rate`. Optional + back-compatible (absent ⇒ 0).
  ungraded_attempts: z.number().int().nonnegative().optional(),
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
  // BOTH directions are fed. OVER-TRUST needs no key (missed planted flaws, counted by the keyword matcher
  // OR the verdict deck). OVER-DISTRUST (false_positives>0) now comes from TWO paths: a live LLM AuditJudge
  // over free-text, OR — KEY-FREE — a VERDICT DECK (the learner marks each claim flawed/sound, so a flagged
  // SOUND claim is a counted false alarm; see grading/deck.ts + gradeFlawVerdicts). Only the plain free-text
  // keyword matcher leaves false_positives=0 (it can't tell a flagged sound claim from praise). See
  // [[trust_calibration]].
  trust_calibration: z.number().min(-1).max(1).optional(),
  trust_calibration_samples: z.number().int().nonnegative().optional(),
  // SIGNAL-DETECTION diagnostic of the SAME judgment audits, but SEPARATING competence from trust-bias
  // (the single signed trust_calibration conflates them). Fed ONLY by audits with a real SOUND class
  // (a verdict deck or a live judge; sound_total>0) so both response classes exist. NON-GATING: the
  // certification/skip gates key on trust_calibration, never on these. Pooled RAW counts per concept
  // (transformed once, never per-scene, never EWMA'd — unlike the gap fold). Optional + back-compatible.
  trust_sdt_counts: z.object({
    hits: z.number().int().nonnegative(),               // flawed claims flagged
    misses: z.number().int().nonnegative(),             // flawed claims missed  (over-trust)
    false_alarms: z.number().int().nonnegative(),       // sound claims wrongly flagged (over-distrust)
    correct_rejections: z.number().int().nonnegative(), // sound claims correctly left unflagged
  }).optional(),
  // A' (Grier) non-parametric discrimination in [0,1]: the trust-COMPETENCE headline (small-N-honest).
  trust_discrimination: z.number().min(0).max(1).optional(),
  // criterion c: signed trust-BIAS. >0 conservative (over-trust), <0 liberal (over-distrust).
  trust_bias_c: z.number().optional(),
});

export type ConceptState = z.infer<typeof ConceptStateSchema>;

export const SignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("answer_submitted"),
    concept_id: z.string(), scene_id: z.string(),
    // CORRECTNESS IS OPTIONAL, and its absence means UNMEASURED — never `false`. An answer graded
    // by `matchClaimsAgainstCritique` is graded on whether an authored cue string appears in the
    // text, which is a statement about vocabulary; INT-STUDIUM-035 measured it against a teacher on
    // the real atomistique-l1 bundle and 11 of 12 answers came back inverted. On the owner's
    // decision (candidate 2, 2026-09-10) that path still publishes its score as a COVERAGE HINT
    // (`critique_submitted.llm_score` / `completion_rate`) but no longer certifies: it emits this
    // signal with no `correct`, so the Beta posterior, FSRS and the concept gates receive nothing.
    // `false` would be the same defect pointing the other way — the learner may well have been
    // right. Readers must branch on presence, following INT-STUDIUM-029: `matchesCondition` already
    // treats an absent context key as a first-class answer, so no adaptation rule fires on it.
    // Still certified: `quiz` (a marked choice), the verdict deck (marks scored against the key by
    // identity) and a live evaluator (`source: "llm"`).
    correct: z.boolean().optional(), time_ms: z.number().nonnegative(),
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
    // COUNTS ARE CLAIM-GRANULAR: `planted` = number of planted flaw CLAIMS, `caught` = distinct flaw
    // claims the critique identified (over-trust = missed/planted). `false_positives` = SOUND claims the
    // critique WRONGLY flagged and `sound_total` = how many sound claims were on offer (over-distrust =
    // false_positives/sound_total). These are nonzero via a live AuditJudge OR a KEY-FREE verdict deck;
    // only the plain free-text keyword matcher leaves them 0 (it can't tell a flagged sound claim from praise).
    judgment_audit: z.object({
      grounded: z.literal(true),
      planted: z.number().int().nonnegative(),
      caught: z.number().int().nonnegative(),
      false_positives: z.number().int().nonnegative(),
      // count of sound claims the auditor COULD have wrongly flagged (the over-distrust denominator).
      // Optional + back-compatible: absent ⇒ 0 ⇒ over-distrust unmeasured (the offline boundary).
      sound_total: z.number().int().nonnegative().optional(),
    }).optional() }),
  z.object({ kind: z.literal("confidence_declared"),
    scene_id: z.string(), value: z.number().int().min(0).max(4),
    // M3: the concept this self-assessment is about. Optional for backward-compat —
    // when absent, the calibration loop is a no-op (no concept to attach the gap to).
    concept_id: z.string().optional(),
    // Paired checkpoint (pre_question/post_question): the two declarations and their delta. `value`
    // stays the post declaration (what the calibration loop compares). Optional: a single-question
    // checkpoint carries none. Declared here so a durable store (FileStateStore parses on load)
    // keeps them — a zod object strips unknown keys, which silently dropped them before.
    pre: z.number().int().min(0).max(4).optional(),
    post: z.number().int().min(0).max(4).optional(),
    confidence_delta: z.number().int().min(-4).max(4).optional() }),
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
  // Active modulator set — mirrors the registry in @studium/lesson-bundle-schema/src/modulators.ts
  // (kept literal here to avoid a cross-package dep; modulators.guard.test.ts pins it to the registry).
  modulator: z.enum(["M1", "M3", "M6"]).nullable(),
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

export interface JudgmentAudit {
  planted: number; caught: number; false_positives: number;
  /** count of sound claims the auditor could have wrongly flagged — the over-distrust denominator.
   * Optional + back-compatible: absent/undefined ⇒ 0 ⇒ over-distrust unmeasured. */
  sound_total?: number | undefined;
}

/** Fold ONE grounded-judgment audit into trust_calibration (+ count the sample). Each direction is a
 * PROPER RATE over its OWN population, so the gap subtracts two commensurable rates in [0,1]:
 *   over_trust    = missed / planted                      (missed real flaws ⇒ too credulous, +)
 *   over_distrust = min(false_positives, sound_total) / sound_total   (flagged sound claims ⇒ skeptical, −)
 *   gap = over_trust − over_distrust ∈ [-1, 1]
 * `planted` is the CLAIM count of planted flaws; `sound_total` the count of sound claims on offer. When
 * `sound_total` is 0 (no sound claims / offline keyword path), over_distrust is 0 (unmeasured), so the
 * gap collapses to over_trust — the documented offline behavior. Blended by `lambda` (EWMA; undefined
 * prior treated as 0) and clamped to [-1, 1]. A degenerate audit with no planted flaws is a no-op. Pure.
 * NOTE: a single grounded audit is ONE (possibly noisy) LLM judgment on the over-distrust side; the λ
 * blend (0.5) means one sample only moves the signal halfway, and the trust gates require a measured
 * sample to persist — repeated audits smooth it. Multi-vote judging is a future hardening. */
export function recordJudgmentAudit(
  cs: ConceptState, audit: JudgmentAudit, lambda: number = TRUST_CALIBRATION_LAMBDA,
): ConceptState {
  const planted = Math.max(0, Math.floor(audit.planted));
  if (planted === 0) return cs; // no real flaws ⇒ trust is unmeasurable here
  const missed = Math.max(0, planted - Math.max(0, audit.caught));
  const overTrust = missed / planted;
  // over_distrust normalizes the wrongly-flagged-SOUND count by the SOUND population (not the flaw
  // count), so each direction is a rate over its own denominator. sound_total 0 ⇒ unmeasured ⇒ 0.
  const soundTotal = Math.max(0, Math.floor(audit.sound_total ?? 0));
  const overDistrust = soundTotal > 0 ? Math.min(Math.max(0, audit.false_positives), soundTotal) / soundTotal : 0;
  const gap = overTrust - overDistrust;
  const prior = cs.trust_calibration ?? 0;
  const blended = Math.max(-1, Math.min(1, (1 - lambda) * prior + lambda * gap));
  return { ...cs, trust_calibration: blended, trust_calibration_samples: (cs.trust_calibration_samples ?? 0) + 1 };
}

/** Accumulate ONE grounded judgment audit into the per-concept signal-detection diagnostic (A' + c),
 * SEPARATE from recordJudgmentAudit's signed gap and NON-GATING. Requires a real SOUND class
 * (`sound_total > 0`): the offline keyword path (sound_total 0) has no noise trials, so SDT is
 * undefined there and this is a no-op — the same over-distrust honesty boundary. Pools RAW counts on
 * the concept and recomputes A'/c ONCE from the running 2x2 with the loglinear correction (never
 * per-scene, never EWMA'd). Counts are clamped (caught<=planted, fa<=sound_total). Pure. */
export function recordJudgmentSdt(cs: ConceptState, audit: JudgmentAudit): ConceptState {
  const soundTotal = Math.max(0, Math.floor(audit.sound_total ?? 0));
  if (soundTotal === 0) return cs; // no noise trials ⇒ over-distrust unmeasured ⇒ SDT undefined here
  const planted = Math.max(0, Math.floor(audit.planted));
  const hits = Math.min(Math.max(0, Math.floor(audit.caught)), planted);
  const falseAlarms = Math.min(Math.max(0, Math.floor(audit.false_positives)), soundTotal);
  const prior = cs.trust_sdt_counts ?? { hits: 0, misses: 0, false_alarms: 0, correct_rejections: 0 };
  const counts = {
    hits: prior.hits + hits,
    misses: prior.misses + (planted - hits),
    false_alarms: prior.false_alarms + falseAlarms,
    correct_rejections: prior.correct_rejections + (soundTotal - falseAlarms),
  };
  const sdt = computeSdt({
    hits: counts.hits, misses: counts.misses,
    falseAlarms: counts.false_alarms, correctRejections: counts.correct_rejections,
  });
  return { ...cs, trust_sdt_counts: counts, trust_discrimination: sdt.aPrime, trust_bias_c: sdt.c };
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

// ---------------------------------------------------------------------------
// CROSS-LESSON learner profile — a pseudonym-level (NOT per-bundle) aggregate of concept state, so a
// concept mastered in lesson A starts WARM in lesson B. Keyed by concept_id (the shared concept space:
// a concept with the same id across bundles is the same concept). The per-bundle LearnerState stays the
// session's working state; the profile is the longitudinal carry-forward seeded in / merged out by the host.
// ---------------------------------------------------------------------------

// FSRS per-concept memory, persisted on the cross-lesson profile (NOT on the per-bundle LearnerState,
// where it is derived by replaying answer history). Mirrors ConceptMemoryState in
// @studium/adaptation-engine/src/fsrs.ts — kept structurally identical (learner-state can't import the
// engine: the engine depends on learner-state, not the reverse). Persisting it here lets spaced-
// repetition routing see a concept reviewed in lesson A while the learner is in lesson B.
export const ConceptMemoryStateSchema = z.object({
  concept_id: z.string(),
  /** Memory stability in DAYS; 0 = unseen. */
  stability: z.number(),
  /** Item difficulty in [1,10]; 0 = unseen. */
  difficulty: z.number(),
  /** Epoch ms of the last review; null = unseen. */
  last_reviewed_at: z.number().nullable(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
});
export type ConceptMemoryState = z.infer<typeof ConceptMemoryStateSchema>;

export const LearnerProfileSchema = z.object({
  pseudonym: z.string(),
  schema_version: z.literal("1.0"),
  concept_states: z.record(z.string(), ConceptStateSchema),
  // lesson_ids (== bundle_ids) the learner has COMPLETED — the course spine routes the next lesson off
  // this. Optional + back-compatible (absent ⇒ none completed yet).
  completed_lessons: z.array(z.string()).optional(),
  // Cross-lesson FSRS memory per concept (the spaced-repetition retention state carried across lessons).
  // Optional + back-compatible (absent ⇒ no cross-lesson memory yet).
  concept_memory: z.record(z.string(), ConceptMemoryStateSchema).optional(),
  updated_at: z.string(),
});
export type LearnerProfile = z.infer<typeof LearnerProfileSchema>;

export function defaultLearnerProfile(pseudonym: string, nowIso: string): LearnerProfile {
  return { pseudonym, schema_version: "1.0", concept_states: {}, completed_lessons: [], updated_at: nowIso };
}

/** Record a COMPLETED lesson (deduped) on the learner profile — the course spine's next-lesson router
 * reads this. Pure, non-mutating. */
export function recordCompletedLesson(profile: LearnerProfile, lessonId: string): LearnerProfile {
  const done = profile.completed_lessons ?? [];
  if (done.includes(lessonId)) return profile;
  return { ...profile, completed_lessons: [...done, lessonId] };
}

/** WARM-START: copy the profile's concept_state into the bundle state for each conceptId the bundle uses
 * that the per-bundle state hasn't already seen — so a concept mastered in another lesson resumes here
 * (mastery/calibration/trust/attempts all carry). The per-bundle state TAKES PRECEDENCE (a concept the
 * learner has already worked in THIS bundle is never overwritten by the profile). Pure, non-mutating. */
export function seedConceptStatesFromProfile(
  state: LearnerState, profile: LearnerProfile, conceptIds: readonly string[],
): LearnerState {
  const seeded: Record<string, ConceptState> = { ...state.concept_states };
  let changed = false;
  for (const cid of conceptIds) {
    if (!seeded[cid] && profile.concept_states[cid]) { seeded[cid] = { ...profile.concept_states[cid] }; changed = true; }
  }
  return changed ? { ...state, concept_states: seeded } : state;
}

/** CARRY-FORWARD: fold the session's concept_states into the learner profile (latest-wins per concept).
 * Pure, non-mutating; `nowIso` stamps updated_at (the caller passes its clock). */
export function mergeConceptStatesIntoProfile(
  profile: LearnerProfile, state: LearnerState, nowIso: string,
): LearnerProfile {
  const merged: Record<string, ConceptState> = { ...profile.concept_states };
  for (const [cid, cs] of Object.entries(state.concept_states)) merged[cid] = { ...cs };
  return { ...profile, concept_states: merged, updated_at: nowIso };
}

/** CARRY-FORWARD the FSRS memory: fold a session's per-concept memory map (the host derives it by
 * replaying answer history) into the learner profile's `concept_memory`, latest-wins per concept — so a
 * concept reviewed in this lesson updates the cross-lesson retention state. Pure, non-mutating; `nowIso`
 * stamps updated_at. An empty map is a no-op on the memory (still re-stamps time).
 *
 * CRITICAL: an UNSEEN incoming entry (reps === 0) is SKIPPED — it must never overwrite a real memory
 * carried from an earlier lesson. (The host warm-seeds every concept a bundle DECLARES into the session
 * state; one the learner never answers in this lesson replays to a reps=0 default, which is identical to
 * "absent" for FSRS and would otherwise clobber the earlier lesson's genuine memory.) */
export function mergeConceptMemoryIntoProfile(
  profile: LearnerProfile, memory: Record<string, ConceptMemoryState>, nowIso: string,
): LearnerProfile {
  const merged: Record<string, ConceptMemoryState> = { ...(profile.concept_memory ?? {}) };
  for (const [cid, m] of Object.entries(memory)) {
    if (m.reps === 0) continue; // unseen this session ⇒ no real memory to carry; never regress the profile
    merged[cid] = { ...m };
  }
  return { ...profile, concept_memory: merged, updated_at: nowIso };
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
