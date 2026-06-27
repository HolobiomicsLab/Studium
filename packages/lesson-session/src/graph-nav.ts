import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";
import { isAvailable, remediationTarget, DEFAULT_THETA, type Mastery } from "@studium/adaptation-engine";
import { masteryOf, isMiscalibrated, isTrustMiscalibrated, type ConceptState } from "@studium/learner-state";

/** Minimum total_attempts a concept must accumulate before its mastery can count as MASTERED.
 * Without this floor, mastery is trivially cheap: 2 correct quiz answers push alpha/(alpha+beta)
 * to 0.8 (= default theta), so prereq-gating, nextConcept and demonstrates_mastery_of Claims all
 * fire on just 2 answers. Below the floor a concept is treated as not-mastered (locked / no claim). */
export const MIN_MASTERY_ATTEMPTS = 3;

/** Build a GraphRouter mastery map from learner concept_states.
 * concept_states keys are grading concept_ids == objective ids (post concept-id alignment);
 * LWG concept node ids are `concept:<objective id>` — so we re-prefix.
 * A concept is included ONLY once it has been attempted at least `minAttempts` times; below the
 * floor it is OMITTED so GraphRouter treats it as not-mastered/locked (minimum-attempts floor). */
export function buildLwgMastery(
  conceptStates: Record<string, ConceptState>,
  minAttempts: number = MIN_MASTERY_ATTEMPTS,
): Mastery {
  const m: Mastery = {};
  for (const [cid, cs] of Object.entries(conceptStates)) {
    if (cs.total_attempts < minAttempts) continue; // below the floor -> not yet masterable -> omit
    m[`concept:${cid}`] = masteryOf(cs);
  }
  return m;
}

/** Build a calibration GATE map for the skip path: a concept node id maps to `false` iff its mastery
 * is MEASURED-miscalibrated on EITHER calibration axis — confidence (declared-vs-competence) OR trust
 * (judgment-over-artifact: did the learner correctly distrust a flawed AI reading of a real result) —
 * so skip-on-mastery will NOT skip past it (the learner does the scene to recalibrate). Calibrated or
 * unmeasured concepts are omitted (no gate). Keyed `concept:<id>` to match the LWG node ids and the
 * mastery map. SYMMETRIC (either direction) by design — a recalibration replay is a low-cost nudge for
 * an over- OR under-calibrated learner. (Distinct from the CERTIFICATION gate in mastery-claims, which
 * is over-confidence/over-trust-only so it never withholds a proven master's claim.)
 * (Trust's over-DIStrust direction is symmetric here by construction but unfed in production today —
 * the flaw matcher reports no false positives yet; see learner-state trust_calibration honesty boundary.) */
export function buildLwgCalibration(conceptStates: Record<string, ConceptState>): Record<string, boolean> {
  const g: Record<string, boolean> = {};
  for (const [cid, cs] of Object.entries(conceptStates)) {
    if (isMiscalibrated(cs) || isTrustMiscalibrated(cs)) g[`concept:${cid}`] = false;
  }
  return g;
}

/** The LWG concept node id a scene teaches/assesses (its first concept_ref), or null. */
// multi-ref scenes gate on the first concept_ref only (simplification; deferred).
export function sceneConceptId(scene: { concept_refs?: string[] }): string | null {
  const ref = scene.concept_refs?.[0];
  return ref ? `concept:${ref}` : null;
}

/** Index of the first scene whose LWG concept == conceptId, or -1. */
export function firstSceneForConcept(scenes: { concept_refs?: string[] }[], conceptId: string): number {
  return scenes.findIndex((s) => sceneConceptId(s) === conceptId);
}

/** Scene types whose grading emits an answer_submitted signal (updates per-concept mastery).
 * Routing remediation to any other type cannot improve mastery -> would loop, so it's excluded. */
const ANSWER_GRADED_TYPES = new Set(["quiz", "ai_critique"]);

/** Index of the first ANSWER-GRADED scene for the concept (one that can move mastery), or -1. */
export function firstAnswerGradedSceneForConcept(
  scenes: { concept_refs?: string[]; type?: string }[],
  conceptId: string,
): number {
  return scenes.findIndex((s) => sceneConceptId(s) === conceptId && ANSWER_GRADED_TYPES.has(s.type ?? ""));
}

/** Index of the first ANSWER-GRADED scene for `conceptId` whose id is NOT in `seen`, or -1. */
export function firstUnseenAnswerGradedSceneForConcept(
  scenes: { id?: string; concept_refs?: string[]; type?: string }[],
  conceptId: string,
  seen: Set<string>,
): number {
  return scenes.findIndex(
    (s) => sceneConceptId(s) === conceptId && ANSWER_GRADED_TYPES.has(s.type ?? "") && !seen.has(s.id ?? ""),
  );
}

export type GraphNavReason = "advance" | "remediate" | "skip_mastered";
export interface GraphNavResult {
  index: number | null; // null => no scene to advance to (caller completes)
  reason: GraphNavReason;
}

/** Choose the next scene (graph-aware). Used only when the bundle carries an LWG.
 * - skipMastered (pacing=skip_on_mastery): skip forward over scenes whose concept is already
 *   mastered (>= theta), stopping at the first concept-less or unmastered scene.
 * - landed candidate available (or concept-less) => advance there.
 * - landed candidate LOCKED => remediate to an answer-graded scene for the weakest unmet prereq
 *   (mastery rises on replay -> converges); if none exists, advance to the candidate (no loop). */
export function graphAwareNextIndex(
  scenes: { concept_refs?: string[]; type?: string }[],
  currentIdx: number,
  lwg: LearningWorkflowGraph,
  mastery: Mastery,
  theta: number = DEFAULT_THETA,
  skipMastered = false,
  calibrated: Record<string, boolean> = {},
): GraphNavResult {
  let candidate = currentIdx + 1;
  let skipped = false;
  if (skipMastered) {
    while (candidate < scenes.length) {
      const c = sceneConceptId(scenes[candidate]!);
      // stop at: concept-less, unmastered, OR mastered-but-MISCALIBRATED (calibration gate — don't
      // skip a concept the learner's self-assessment is out of band on; let them do the scene).
      if (c === null || (mastery[c] ?? 0) < theta || calibrated[c] === false) break;
      candidate += 1;
      skipped = true;
    }
  }
  if (candidate >= scenes.length) return { index: null, reason: "advance" };
  const cid = sceneConceptId(scenes[candidate]!);
  if (cid === null || isAvailable(lwg, cid, mastery, theta)) {
    return { index: candidate, reason: skipped ? "skip_mastered" : "advance" };
  }
  const remedial = remediationTarget(lwg, cid, mastery, theta);
  if (remedial) {
    const ri = firstAnswerGradedSceneForConcept(scenes, remedial);
    if (ri >= 0) return { index: ri, reason: "remediate" };
  }
  return { index: candidate, reason: skipped ? "skip_mastered" : "advance" };
}
