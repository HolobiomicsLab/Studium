// pane-messages.ts — validation of the messages the lesson pane posts to the extension host, kept pure so
// a driver can test them. The host never trusts a webview message: it checks the shape before it reaches a tool.

/** The learner's self-rating of a recall (C4); it feeds spaced review only, never mastery. */
export const RECALL_GRADES = ["again", "hard", "good", "easy"] as const;
export type RecallGrade = (typeof RECALL_GRADES)[number];

/** `{type:'rateRecall', sceneId, grade}` → its validated fields, or null when anything is off. */
export function parseRateRecall(msg: unknown): { sceneId: string; grade: RecallGrade } | null {
  if (!msg || typeof msg !== "object") return null;
  const { sceneId, grade } = msg as { sceneId?: unknown; grade?: unknown };
  if (typeof sceneId !== "string" || sceneId.length === 0) return null;
  if (typeof grade !== "string" || !(RECALL_GRADES as readonly string[]).includes(grade)) return null;
  return { sceneId, grade: grade as RecallGrade };
}

/** UX-03: what a review session (start_review_session) tells the pane about the lessons its scenes come from: the
 * title of each reviewed concept (review.items[].concept) and, when the host names it, the lesson each scene was
 * taken from (review.items[].bundle_ref), so labels and images resolve against that lesson, not the one the pane
 * was opened on. */
export interface ReviewContext { titles: Record<string, string>; origins: Record<string, string> }

export function reviewContext(reply: unknown): ReviewContext {
  const items = (reply as { review?: { items?: unknown } } | null)?.review?.items;
  const titles: Record<string, string> = {};
  const origins: Record<string, string> = {};
  for (const item of Array.isArray(items) ? items : []) {
    const i = item as { concept_id?: unknown; concept?: unknown; scene_id?: unknown; bundle_ref?: unknown } | null;
    if (typeof i?.concept_id === "string" && typeof i.concept === "string" && i.concept.trim()) titles[i.concept_id] = i.concept;
    if (typeof i?.scene_id === "string" && typeof i.bundle_ref === "string" && i.bundle_ref.trim()) origins[i.scene_id] = i.bundle_ref;
  }
  return { titles, origins };
}

/** The lesson an asset of `sceneId` resolves against: the asset's own bundle_ref when the host sends one, else
 * the review's origin of that scene, else the lesson the pane was opened on. */
export function assetBundleRef(asset: { bundle_ref?: unknown }, sceneId: string | undefined, review: ReviewContext | null, fallback: string): string {
  if (typeof asset.bundle_ref === "string" && asset.bundle_ref.trim()) return asset.bundle_ref;
  return (sceneId && review?.origins[sceneId]) || fallback;
}
