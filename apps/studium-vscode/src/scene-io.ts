// scene-io.ts — the single source of truth for "what ResponseInput does a scene of type T expect".
//
// Both extension surfaces must agree with the server-side graders (packages/lesson-session/src/
// grading/graders.ts), which dispatch by scene.type and THROW on a mismatched input kind. The
// notebook directive parser (notebook.ts) imports freeTextInput()/FREE_TEXT_KIND from here; the
// webview pane (media/artifact-pane.js) is browser JS and cannot import this module, so it mirrors
// the same kinds by hand — scene-io.driver.ts guards that parity by asserting each kind appears in
// artifact-pane.js. Keep this list and the grader's GRADERS map in lock-step.

export type ResponseInput =
  | { kind: "ack" }
  | { kind: "quiz_choice"; choiceId: string }
  | { kind: "confidence"; value: 0 | 1 | 2 | 3 | 4 }
  | { kind: "critique"; text: string }            // ai_critique
  | { kind: "flaw_report"; text: string }         // spot_the_flaw
  | { kind: "explanation"; text: string }         // explain_back
  | { kind: "comparison"; text: string }          // comparison
  | { kind: "summary_audit"; text: string }       // summary_audit
  | { kind: "prompt_submission"; text: string }   // prompt_practice
  | { kind: "communication"; text: string };      // communication_sim

export type FreeTextKind =
  | "critique" | "flaw_report" | "explanation"
  | "comparison" | "summary_audit" | "prompt_submission" | "communication";

/**
 * Scene types that collect a SINGLE free-text answer, mapped to the ResponseInput kind their grader
 * requires. quiz (needs a choice id) and meta_checkpoint (needs a 0-4 value) are NOT here — they need
 * scene-specific data and are handled by the caller; intro/concept/reproduction/discussion are
 * ack-graded (no free-text answer) and so are also absent.
 */
export const FREE_TEXT_KIND: Record<string, FreeTextKind> = {
  ai_critique: "critique",
  spot_the_flaw: "flaw_report",
  explain_back: "explanation",
  comparison: "comparison",
  summary_audit: "summary_audit",
  prompt_practice: "prompt_submission",
  communication_sim: "communication",
};

/** discussion is the only multi-turn scene: the learner submits turns via the submit_turn MCP tool
 *  (scored reasoning + Socratic reply) and then advances with an ack — it is NOT a single-submit
 *  free-text scene, so it is deliberately excluded from FREE_TEXT_KIND. */
export const DISCUSSION_TYPE = "discussion";

/**
 * The ResponseInput for a free-text active-learning scene, or null when `sceneType` is not one of
 * them (the caller then handles quiz/meta itself or falls back to ack). Empty text is preserved as
 * the caller's placeholder so the grader still receives a valid payload (coverage simply scores 0).
 */
export function freeTextInput(sceneType: string, text: string): ResponseInput | null {
  const kind = FREE_TEXT_KIND[sceneType];
  if (!kind) return null;
  return { kind, text } as ResponseInput;
}
