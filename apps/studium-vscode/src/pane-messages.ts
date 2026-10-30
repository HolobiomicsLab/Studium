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
