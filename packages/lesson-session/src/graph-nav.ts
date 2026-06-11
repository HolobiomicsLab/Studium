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

/** Choose the next scene index (graph-aware). Used only when the bundle carries an LWG.
 * - candidate = currentIdx+1; beyond the end => null (caller completes).
 * - candidate has no concept, or its concept's prerequisites are all met (>= theta) => advance to it.
 * - candidate's concept is LOCKED => route to an answer-graded scene teaching the weakest unmet
 *   prerequisite (remediation; mastery improves on replay, so it converges); if no answer-graded
 *   scene exists for that concept, advance to the candidate anyway (cannot improve mastery by
 *   remediation, so don't loop). */
export function graphAwareNextIndex(
  scenes: { concept_refs?: string[]; type?: string }[],
  currentIdx: number,
  lwg: LearningWorkflowGraph,
  mastery: Mastery,
  theta: number = DEFAULT_THETA,
): number | null {
  const candidate = currentIdx + 1;
  // at end of scenes -> complete, regardless of unmet prereqs.
  if (candidate >= scenes.length) return null;
  const cid = sceneConceptId(scenes[candidate]!);
  if (cid === null || isAvailable(lwg, cid, mastery, theta)) return candidate;
  const remedial = remediationTarget(lwg, cid, mastery, theta);
  if (remedial) {
    const ri = firstAnswerGradedSceneForConcept(scenes, remedial);
    if (ri >= 0) return ri;   // route to an assessed scene for the unmet prereq (mastery can rise -> converges)
  }
  return candidate; // no answer-graded remediation scene -> cannot remediate -> advance (no infinite loop)
}
