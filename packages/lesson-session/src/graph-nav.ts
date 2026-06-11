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
export function sceneConceptId(scene: { concept_refs?: string[] }): string | null {
  const ref = scene.concept_refs?.[0];
  return ref ? `concept:${ref}` : null;
}

/** Index of the first scene whose LWG concept == conceptId, or -1. */
export function firstSceneForConcept(scenes: { concept_refs?: string[] }[], conceptId: string): number {
  return scenes.findIndex((s) => sceneConceptId(s) === conceptId);
}

/** Choose the next scene index (graph-aware). Used only when the bundle carries an LWG.
 * - candidate = currentIdx+1; beyond the end => null (caller completes).
 * - candidate has no concept, or its concept's prerequisites are all met (>= theta) => advance to it.
 * - candidate's concept is LOCKED => route to a scene teaching the weakest unmet prerequisite
 *   (remediation; may be an earlier scene — mastery improves on replay, so it converges); if no
 *   such scene exists, advance to the candidate anyway (graceful, never stall). */
export function graphAwareNextIndex(
  scenes: { concept_refs?: string[] }[],
  currentIdx: number,
  lwg: LearningWorkflowGraph,
  mastery: Mastery,
  theta: number = DEFAULT_THETA,
): number | null {
  const candidate = currentIdx + 1;
  if (candidate >= scenes.length) return null;
  const cid = sceneConceptId(scenes[candidate]!);
  if (cid === null || isAvailable(lwg, cid, mastery, theta)) return candidate;
  const remedial = remediationTarget(lwg, cid, mastery, theta);
  if (remedial) {
    const ri = firstSceneForConcept(scenes, remedial);
    if (ri >= 0) return ri;
  }
  return candidate;
}
