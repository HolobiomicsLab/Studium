// packages/lesson-session-host/src/key-class.ts
//
// Who holds the key that grades each scene type — the table of spec 2026-10-30 « apprenant
// autonome » (Contrat commun), which is its source. Two more copies live in tools/bundle_lint.mjs
// and tools/experience_packet.py; each copy has a test enumerating the 13 scene types.
import type { Scene } from "@studium/lesson-bundle-schema";

/** `ungraded`: nothing to grade. `author_keyed`: the bundle author wrote the key (open book when
 * the author is the learner). `production`: the learner writes a text, graded by authored keywords
 * or by a model judge. `externally_grounded`: graded against an attested run, not the author. */
export type KeyClass = "ungraded" | "author_keyed" | "production" | "externally_grounded";

/** The key class of every scene type, exhaustive over the SceneSchema discriminator. */
export const SCENE_KEY_CLASS: Readonly<Record<Scene["type"], KeyClass>> = Object.freeze({
  intro: "ungraded",
  concept: "ungraded",
  meta_checkpoint: "ungraded",
  quiz: "author_keyed",
  spot_the_flaw: "author_keyed",
  explain_back: "production",
  comparison: "production",
  summary_audit: "production",
  prompt_practice: "production",
  communication_sim: "production",
  discussion: "production",
  ai_critique: "production",
  reproduction: "externally_grounded",
});

/** The key class of `sceneType`, or null when it is not a scene type. */
export function keyClassOf(sceneType: string): KeyClass | null {
  return Object.hasOwn(SCENE_KEY_CLASS, sceneType) ? SCENE_KEY_CLASS[sceneType as Scene["type"]] : null;
}
