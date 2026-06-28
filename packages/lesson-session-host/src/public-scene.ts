// packages/lesson-session-host/src/public-scene.ts
//
// CLIENT-boundary transport redaction (Wave2-A4 / spec §5).
//
// Today the FULL validated scene is shipped to the client (MCP get_scene / present / respond /
// get_scene_artifacts). That scene carries the ANSWER KEY: quiz choices expose their `correct`
// flag, and the active-learning scenes carry `claims` / `key_points` (the matcher cues) plus the
// `model_*` reveals. The webview only DOM-hides these, so a determined learner can read them off the
// transport. `publicScene` returns a client-safe PROJECTION with those fields removed — generically,
// over the whole Scene union — while keeping everything the learner needs to attempt the scene
// (question + choice text, flawed_content, prompt, artifacts/render_assets, scenario fields, hints).
//
// The SERVER keeps the full scene (the graders read claims/key_points/correct) — only this client
// projection is redacted. Centralized field list ⇒ a future scene type that reuses these field names
// is covered automatically; a future answer-bearing field is a one-line addition here.

import type { Scene } from "@studium/lesson-bundle-schema";
import type { Presentation, Transition } from "@studium/lesson-session";

// A client-safe projection of a Scene: structurally a Scene with the answer-bearing fields removed
// (see PublicScene in @studium/lesson-session/types — kept un-re-exported there to avoid touching a
// parallel-owned barrel; the contract is identical). The learner-facing fields the webview renders
// are a subset of Scene, so a partial Scene types it without enumerating each variant.
export type PublicScene = Partial<Scene>;

/**
 * Top-level scene fields that carry the answer key / reference reveal across EVERY scene type:
 *   - `claims`           (ai_critique / spot_the_flaw / summary_audit answer key + flaws_expected)
 *   - `key_points`       (explain_back / comparison / prompt_practice key-point cues)
 *   - `model_correction` (spot_the_flaw / summary_audit reveal)
 *   - `model_explanation`(explain_back reveal)
 *   - `model_answer`     (comparison reveal)
 *   - `model_prompt`     (prompt_practice reveal)
 *   - `model_response`   (communication_sim reveal)
 * Add a new field name here when a future scene type introduces another answer-bearing reveal.
 */
export const REDACTED_SCENE_FIELDS = [
  "claims",
  "key_points",
  "model_correction",
  "model_explanation",
  "model_answer",
  "model_prompt",
  "model_response",
] as const;

/**
 * Return a client-safe copy of `scene`: the answer-bearing top-level fields in
 * REDACTED_SCENE_FIELDS are removed, and every quiz choice loses its `correct` flag (choice `id`
 * + `text` are kept so the learner can still pick). Pure + non-mutating — the input scene (the
 * server's full copy) is untouched. Unknown/future scene types pass through, losing only the
 * centralized fields if present.
 */
export function publicScene(scene: Scene): PublicScene {
  const src = scene as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if ((REDACTED_SCENE_FIELDS as readonly string[]).includes(key)) continue;
    // Withhold the AUTHOR's executed run on a LEARNER-TIME RUN scene (run_manifest present): the learner
    // must produce a FRESH result by running it — surfacing the author landmark would let them echo it.
    if (key === "reference_result" && "run_manifest" in src) continue;
    if (key === "choices" && Array.isArray(value)) {
      out[key] = value.map((c) => stripChoice(c));
      continue;
    }
    out[key] = value;
  }
  return out as PublicScene;
}

/** Drop the `correct` flag from a quiz choice while preserving id + text (+ any other display field). */
function stripChoice(choice: unknown): unknown {
  if (!choice || typeof choice !== "object") return choice;
  const { correct: _correct, ...rest } = choice as Record<string, unknown>;
  return rest;
}

/** Redact the scene embedded in a Presentation (the shape get_current_scene / start return). */
export function publicPresentation(p: Presentation): Presentation {
  return { ...p, scene: publicScene(p.scene) as unknown as Scene };
}

/** Redact the scene embedded in a Transition's presentation (submit_response return). The `complete`
 * transition carries no presentation, so it is returned unchanged. */
export function publicTransition(t: Transition): Transition {
  if ("presentation" in t && t.presentation) {
    return { ...t, presentation: publicPresentation(t.presentation) };
  }
  return t;
}
