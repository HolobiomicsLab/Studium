import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";

/** mastery: concept node id -> mastery in [0,1]. Missing id => treated as 0 (not mastered). */
export type Mastery = Record<string, number>;

export const DEFAULT_THETA = 0.8;

function conceptIds(lwg: LearningWorkflowGraph): string[] {
  return lwg.nodes.filter((n) => n.node_kind === "concept").map((n) => n.id);
}

/** The prerequisite concept ids of `conceptId` (targets of its prerequisite_for edges). */
function prereqsOf(lwg: LearningWorkflowGraph, conceptId: string): string[] {
  return lwg.edges
    .filter((e) => e.relation === "prerequisite_for" && e.source === conceptId)
    .map((e) => e.target);
}

/** A concept is available when every direct prerequisite has mastery >= theta. */
export function isAvailable(
  lwg: LearningWorkflowGraph,
  conceptId: string,
  mastery: Mastery,
  theta: number = DEFAULT_THETA,
): boolean {
  return prereqsOf(lwg, conceptId).every((p) => (mastery[p] ?? 0) >= theta);
}

export function availableConcepts(lwg: LearningWorkflowGraph, mastery: Mastery, theta: number = DEFAULT_THETA): string[] {
  return conceptIds(lwg).filter((id) => isAvailable(lwg, id, mastery, theta));
}

export function lockedConcepts(lwg: LearningWorkflowGraph, mastery: Mastery, theta: number = DEFAULT_THETA): string[] {
  return conceptIds(lwg).filter((id) => !isAvailable(lwg, id, mastery, theta));
}

/** First concept (in graph order) that is available, not yet mastered, and not completed. */
export function nextConcept(
  lwg: LearningWorkflowGraph,
  mastery: Mastery,
  theta: number = DEFAULT_THETA,
  completed: string[] = [],
): string | null {
  const done = new Set(completed);
  for (const id of conceptIds(lwg)) {
    if (done.has(id)) continue;
    if ((mastery[id] ?? 0) >= theta) continue;
    if (isAvailable(lwg, id, mastery, theta)) return id;
  }
  return null;
}

/** The weakest (lowest-mastery) unmet prerequisite of `conceptId`, or null if all prereqs met / none. */
export function remediationTarget(
  lwg: LearningWorkflowGraph,
  conceptId: string,
  mastery: Mastery,
  theta: number = DEFAULT_THETA,
): string | null {
  const unmet = prereqsOf(lwg, conceptId).filter((p) => (mastery[p] ?? 0) < theta);
  if (unmet.length === 0) return null;
  return unmet.reduce((lo, p) => ((mastery[p] ?? 0) < (mastery[lo] ?? 0) ? p : lo), unmet[0]!);
}
