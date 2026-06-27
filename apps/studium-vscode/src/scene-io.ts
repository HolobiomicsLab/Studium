// scene-io.ts — the single source of truth for "what ResponseInput does a scene of type T expect".
//
// Both extension surfaces must agree with the server-side graders (packages/lesson-session/src/
// grading/graders.ts), which dispatch by scene.type and THROW on a mismatched input kind. The
// notebook directive parser (notebook.ts) imports freeTextInput()/FREE_TEXT_KIND from here; the
// webview pane (media/artifact-pane.js) is browser JS and cannot import this module, so it mirrors
// the same kinds by hand — scene-io.driver.ts guards that parity by asserting each kind appears in
// artifact-pane.js. Keep this list and the grader's GRADERS map in lock-step.

// `confidence?` (0..4) is the optional per-answer self-rating — the per-answer calibration capture
// (mirrors the host ResponseInputSchema); the engine folds it into confidence_calibration that turn.
export type ResponseInput =
  | { kind: "ack" }
  | { kind: "quiz_choice"; choiceId: string; confidence?: 0 | 1 | 2 | 3 | 4 }
  | { kind: "confidence"; value: 0 | 1 | 2 | 3 | 4 }
  | { kind: "critique"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }            // ai_critique
  | { kind: "flaw_report"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }         // spot_the_flaw
  | { kind: "explanation"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }         // explain_back
  | { kind: "comparison"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }          // comparison
  | { kind: "summary_audit"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }       // summary_audit
  | { kind: "prompt_submission"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }   // prompt_practice
  | { kind: "communication"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 };      // communication_sim

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

/**
 * Pull an OPTIONAL trailing confidence token (0..4) off a free-text / quiz cell — the per-answer
 * calibration tap for the (text-only) notebook surface. Canonical form: end the cell with `conf:N`
 * (also accepts `conf=N`, `conf N`, `confidence:N`). A bare digit is NOT a token (so a meta_checkpoint's
 * `3` is untouched). Returns the parsed confidence + the answer text with the token removed; no token ⇒
 * { confidence: undefined, rest: raw }.
 */
export function extractConfidence(raw: string): { confidence?: 0 | 1 | 2 | 3 | 4; rest: string } {
  const m = raw.match(/[\s.;,]*\b(?:confidence|conf)\b\s*[:=]?\s*([0-4])\s*$/i);
  if (!m) return { confidence: undefined, rest: raw };
  return { confidence: Number(m[1]) as 0 | 1 | 2 | 3 | 4, rest: raw.slice(0, m.index).trimEnd() };
}
