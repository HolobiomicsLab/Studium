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
// (question + choice text, flawed_content, prompt, artifacts/render_assets, scenario fields). Hints
// and quiz feedback are NOT part of it: they are metered (request_hint) or earned (verdict).
//
// The SERVER keeps the full scene (the graders read claims/key_points/correct) — only this client
// projection is redacted. Centralized field list ⇒ a future scene type that reuses these field names
// is covered automatically; a future answer-bearing field is a one-line addition here.

import type { Scene } from "@studium/lesson-bundle-schema";
import type { Presentation, Transition, CompletionSummary, PublicDeckItem } from "@studium/lesson-session";
import { verdictDeck, publicDeck } from "@studium/lesson-session";
import { keyClassOf } from "./key-class.js";

// A client-safe projection of a Scene: structurally a Scene with the answer-bearing fields removed
// (see PublicScene in @studium/lesson-session/types — kept un-re-exported there to avoid touching a
// parallel-owned barrel; the contract is identical). The learner-facing fields the webview renders
// are a subset of Scene, so a partial Scene types it without enumerating each variant.
export type PublicScene = Partial<Scene> & { deck?: PublicDeckItem[] };

/** Public mastery distinguishes an unmeasured concept from a measured score. */
export type PublicPresentation = Omit<Presentation, "learnerSnapshot"> & {
  learnerSnapshot: Omit<Presentation["learnerSnapshot"], "conceptMastery"> & {
    conceptMastery: Record<string, number | null>;
  };
};
export type PublicCompletionSummary = Omit<CompletionSummary, "mastery"> & { mastery: Record<string, number | null> };
export type PublicTransition<T extends Transition = Transition> = T extends { summary: CompletionSummary }
  ? Omit<T, "summary"> & { summary: PublicCompletionSummary }
  : T extends { presentation: Presentation }
    ? Omit<T, "presentation"> & { presentation: PublicPresentation }
    : T;

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
  "sound_claims",       // spot_the_flaw OVER-DISTRUST answer key (which AI-reading claims are actually sound)
  "key_points",
  "model_correction",
  "model_explanation",
  "model_answer",
  "model_prompt",
  "model_response",
  // Quiz: the two feedback texts restate the right answer ("Oui : α ≤ p-value, on ne rejette pas
  // H0…") and the hints lead to it — all three were readable BEFORE answering, over MCP and in
  // task.md. Observed on the 2026-10-29 web-cases trial by two independent harnesses. The matching
  // feedback now travels on the transition's `verdict` after the answer; hints stay behind
  // `request_hint`, which meters them (M5).
  "feedback_correct",
  "feedback_incorrect",
  "hints",
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
    if (key === "evidence" && citationsAnswerIt(scene.type)) {
      out[key] = withoutCitations(value);
      continue;
    }
    out[key] = value;
  }
  // VERDICT DECK: derive the client-safe deck (opaque tokens + text, labels stripped) from the answer-key
  // claims that were just redacted above. The `flawed`/`sound` truth stays server-side; the grader
  // re-derives the identical permutation from scene.id to score the returned verdicts.
  if (scene.type === "spot_the_flaw" && scene.verdict_deck) {
    out.deck = publicDeck(verdictDeck(scene.claims, scene.sound_claims ?? [], scene.id));
  }
  return out as PublicScene;
}

/** SL-5: on a graded scene the passages it cites can state the answer (a quiz built from a sentence
 * of the source quotes that sentence), so they wait for the verdict (`citedSources`). A reading, a
 * checkpoint and a reproduction keep them: there the passage is the material, not the key. An
 * unknown scene type is treated as graded. */
function citationsAnswerIt(type: string): boolean {
  const keyClass = keyClassOf(type);
  return keyClass === null || keyClass === "author_keyed" || keyClass === "production";
}

/** The evidence minus what quotes the source: the display asset and the enrichment record stay. */
function withoutCitations(evidence: unknown): unknown {
  if (!evidence || typeof evidence !== "object") return evidence;
  const { bibliographic_refs: _refs, case_studies: _cases, ...rest } = evidence as Record<string, unknown>;
  return rest;
}

/** A passage a scene cites, as the verdict releases it after the answer. */
export interface CitedSource { title: string; quote?: string; url?: string; license?: string }

const MAX_CITED_SOURCES = 5;

/** A reference a scene cites, as the bundle records it (the fields a learner-facing view may show). */
export interface CitedReference { title: string; excerpt?: string; prov_derived_from?: string; doi?: string; license?: string }

/** The references `scene` cites (its `evidence.bibliographic_refs`) that carry a title, at most
 * MAX_CITED_SOURCES, with blank fields dropped. */
export function citedReferences(scene: Scene): CitedReference[] {
  const refs = (scene as { evidence?: { bibliographic_refs?: unknown } }).evidence?.bibliographic_refs;
  if (!Array.isArray(refs)) return [];
  return refs.slice(0, MAX_CITED_SOURCES).flatMap((ref): CitedReference[] => {
    if (!ref || typeof ref !== "object") return [];
    const r = ref as { title?: unknown; excerpt?: unknown; prov_derived_from?: unknown; doi?: unknown; license?: unknown };
    if (typeof r.title !== "string") return [];
    const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    const reference: CitedReference = { title: r.title };
    const excerpt = text(r.excerpt), derived = text(r.prov_derived_from), doi = text(r.doi), license = text(r.license);
    if (excerpt) reference.excerpt = excerpt;
    if (derived) reference.prov_derived_from = derived;
    if (doi) reference.doi = doi;
    if (license) reference.license = license;
    return [reference];
  });
}

/** The web address of a reference: its `prov_derived_from` when that is one, else its DOI. */
export function referenceUrl(reference: CitedReference): string | undefined {
  if (reference.prov_derived_from && /^https?:\/\//.test(reference.prov_derived_from)) return reference.prov_derived_from;
  return reference.doi ? `https://doi.org/${reference.doi}` : undefined;
}

/** The passages `scene` cites (its `evidence.bibliographic_refs`): title, exact quote, and a link
 * when the record has a web address or a DOI. Released only after the learner answered. */
export function citedSources(scene: Scene): CitedSource[] {
  return citedReferences(scene).map((reference): CitedSource => {
    const source: CitedSource = { title: reference.title };
    if (reference.excerpt) source.quote = reference.excerpt;
    const url = referenceUrl(reference);
    if (url) source.url = url;
    if (reference.license) source.license = reference.license;
    return source;
  });
}

/** Drop the `correct` flag from a quiz choice while preserving id + text (+ any other display field). */
function stripChoice(choice: unknown): unknown {
  if (!choice || typeof choice !== "object") return choice;
  const { correct: _correct, ...rest } = choice as Record<string, unknown>;
  return rest;
}

/** Redact the scene embedded in a Presentation (the shape get_current_scene / start return). */
export function publicPresentation<P extends Pick<Presentation, "scene">>(p: P): P {
  return { ...p, scene: publicScene(p.scene) as unknown as Scene };
}

/** Redact the scene embedded in a Transition's presentation (submit_response return). The `complete`
 * transition carries no presentation, so it is returned unchanged. */
export function publicTransition<T extends { kind: string; presentation?: Pick<Presentation, "scene"> }>(t: T): T {
  if ("presentation" in t && t.presentation) {
    return { ...t, presentation: publicPresentation(t.presentation) };
  }
  return t;
}
