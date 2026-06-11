import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";
import { isAvailable, remediationTarget, DEFAULT_THETA, type Mastery } from "@studium/adaptation-engine";
import { masteryOf, type ConceptState } from "@studium/learner-state";

/** Build a GraphRouter mastery map from learner concept_states.
 * concept_states keys are grading concept_ids == objective ids (post concept-id alignment);
 * LWG concept node ids are `concept:<objective id>` — so we re-prefix. */
export function buildLwgMastery(conceptStates: Record<string, ConceptState>): Mastery {
  const m: Mastery = {};
  for (const [cid, cs] of Object.entries(conceptStates)) m[`concept:${cid}`] = masteryOf(cs);
  return m;
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
): GraphNavResult {
  let candidate = currentIdx + 1;
  let skipped = false;
  if (skipMastered) {
    while (candidate < scenes.length) {
      const c = sceneConceptId(scenes[candidate]!);
      if (c === null || (mastery[c] ?? 0) < theta) break; // stop at concept-less or unmastered
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
