// packages/lesson-session-host/src/review-session.ts
//
// start_review_session (HJ-1 point 2, SL-2): one ephemeral lesson made of a retrieval scene for each
// concept due, across every lesson the learner studied. It is graded like any lesson and its
// answers are written back into the learner's FSRS memory; it is never recorded as a completed
// lesson, and nothing of it is kept on disk except that memory and the concepts' mastery.
//
// Scene choice (L-8): a retrieval scene of the lesson the concept was learned in whose FIRST concept
// is that concept — the one the graders score; a scene that only mentions it would grade another
// concept, and the concept would stay due for ever (H1). Never a diagnostic (« what do you already
// know? »), which makes sense once, before the lesson. Without a judge model, an answer-graded scene
// (a quiz, a spot_the_flaw verdict deck) comes first, even the one answered last time: nothing else
// re-measures the concept (RFR-07, R-en-09). Otherwise one other than the scene answered last time, so
// a review is not always the same item. Scenes that only make sense inside their lesson are left out:
// a learner-time run, and a judgment grounded on the learner's own run.
import type { LessonBundle, Scene, AuthoringMode } from "@studium/lesson-bundle-schema";
import { draftedByOf, type DraftedBy } from "./authoring.js";
import { keyClassOf } from "./key-class.js";

/** Scene types that RE-TEST recall (active retrieval), preferred for reinforcement over a passive
 * intro/exposition — reinforcement is about retrieval practice, not re-reading. */
export const RETRIEVAL_SCENE_TYPES: ReadonlySet<string> = new Set([
  "quiz", "spot_the_flaw", "explain_back", "comparison", "summary_audit", "prompt_practice",
]);

export const REVIEW_BUNDLE_ID = "studium-review";

/** Reviews in one session unless the caller asks for fewer or more (start_review_session max_items). */
export const DEFAULT_REVIEW_ITEMS = 10;
export const MAX_REVIEW_ITEMS = 50;

/** Where a review scene comes from: its lesson, its id there, and the folder its assets resolve in. */
export interface ReviewOrigin {
  bundle_ref: string;
  bundle_id: string;
  scene_id: string;
  lesson_title: string;
  baseDir: string;
}

export interface ReviewSource {
  conceptId: string;
  bundleRef: string;
  bundle: LessonBundle;
  baseDir: string;
  /** C5: the lesson has an approval record bound to its exact file (absent reads as not approved). */
  approved?: boolean;
  /** The scene this concept was answered in last, if known. */
  lastSceneId: string | null;
}

export const playableOutsideItsLesson = (scene: Scene) => {
  const s = scene as { run_manifest?: unknown; reference_from_run?: unknown };
  return !s.run_manifest && !s.reference_from_run;
};
const diagnosticFlag = (scene: Scene): unknown => (scene as { diagnostic?: unknown }).diagnostic;

/** A pre-lesson diagnostic: a scene flagged `diagnostic: true` — or, in a bundle written before the
 * flag existed (no scene carries it), the production scene right after a meta_checkpoint, the
 * opening « what do you already know? » the authoring guide asked for. */
export function isDiagnosticScene(bundle: LessonBundle, scene: Scene): boolean {
  if (bundle.scenes.some((s) => typeof diagnosticFlag(s) === "boolean")) return diagnosticFlag(scene) === true;
  const at = bundle.scenes.findIndex((s) => s.id === scene.id);
  return at > 0 && bundle.scenes[at - 1]!.type === "meta_checkpoint" && keyClassOf(scene.type) === "production";
}

/** Graded against an answer key, with no judge model: a quiz, a spot_the_flaw played as a verdict deck. */
export function answerGraded(scene: Scene): boolean {
  return scene.type === "quiz" || (scene.type === "spot_the_flaw" && (scene as { verdict_deck?: unknown }).verdict_deck === true);
}

/** The scene a review of `conceptId` plays from `bundle`, or null when none can (see the header).
 * `judge`: a judge model grades production scenes on this server. */
export function pickReviewScene(
  bundle: LessonBundle, conceptId: string, lastSceneId: string | null, opts: { judge?: boolean } = {},
): Scene | null {
  const candidates = bundle.scenes.filter((s) => RETRIEVAL_SCENE_TYPES.has(s.type) && s.concept_refs[0] === conceptId
    && playableOutsideItsLesson(s) && !isDiagnosticScene(bundle, s));
  const graded = opts.judge ? [] : candidates.filter(answerGraded);
  const pool = graded.length ? graded : candidates;
  return pool.find((s) => s.id !== lastSceneId) ?? pool[0] ?? null;
}

function combinedAuthoring(bundles: readonly LessonBundle[]): { mode: AuthoringMode; author_is_learner: boolean; drafted_by: DraftedBy } {
  const drafted = bundles.map((b) => draftedByOf(b.metadata));
  return {
    mode: bundles.some((b) => b.metadata.authoring?.mode === "self_study") ? "self_study" : "teacher",
    author_is_learner: bundles.some((b) => b.metadata.authoring?.author_is_learner ?? false),
    // The weakest provenance wins, so the notice warns for every item that needs it.
    drafted_by: drafted.includes("agent") ? "agent" : drafted.includes("learner") ? "learner" : "teacher",
  };
}

/**
 * Assemble the review lesson. Scene ids are namespaced (`r<n>:<id>`) because two lessons may reuse
 * an id; choices keep the order and letters their own lesson shuffled them into. Returns null when no
 * source has a playable scene. `language` is the review's language (its chrome: « Révision n sur
 * N »), by default the first lesson's; `judge` as for pickReviewScene.
 */
export function buildReviewBundle(
  sources: readonly ReviewSource[],
  opts: { title: string; nowIso: string; judge?: boolean; language?: string },
): { bundle: LessonBundle; origins: Record<string, ReviewOrigin>; approvedSources: boolean } | null {
  const picked: Array<{ scene: Scene; source: ReviewSource }> = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const scene = pickReviewScene(source.bundle, source.conceptId, source.lastSceneId, { judge: opts.judge ?? false });
    const key = scene ? `${source.bundle.bundle_id}\u0000${scene.id}` : "";
    if (!scene || seen.has(key)) continue;
    seen.add(key);
    picked.push({ scene, source });
  }
  if (!picked.length) return null;
  const bundles = [...new Map(picked.map((p) => [p.source.bundle.bundle_id, p.source.bundle])).values()];
  const origins: Record<string, ReviewOrigin> = {};
  const scenes = picked.map(({ scene, source }, i) => {
    const id = `r${i + 1}:${scene.id}`;
    origins[id] = {
      bundle_ref: source.bundleRef, bundle_id: source.bundle.bundle_id, scene_id: scene.id,
      lesson_title: source.bundle.metadata.title, baseDir: source.baseDir,
    };
    return { ...scene, id } as Scene;
  });
  const conceptIds = new Set(scenes.flatMap((s) => s.concept_refs));
  const concepts = [...new Map(bundles.flatMap((b) => b.concepts)
    .filter((c) => conceptIds.has(c.id)).map((c) => [c.id, c])).values()];
  const authoring = combinedAuthoring(bundles);
  // C5: approval records, never `validated_by` text, say whether the lessons were validated.
  const approvedIds = new Set(picked.filter(({ source }) => source.approved === true).map(({ source }) => source.bundle.bundle_id));
  const allValidated = bundles.every((b) => approvedIds.has(b.bundle_id));
  const first = picked[0]!.source.bundle;
  const bundle = {
    schema_version: "1.4",
    bundle_id: REVIEW_BUNDLE_ID,
    source_plan_id: REVIEW_BUNDLE_ID,
    metadata: {
      title: opts.title,
      target: first.metadata.target,
      duration_minutes: Math.max(1, Math.ceil(scenes.reduce((sum, s) => sum + s.estimated_seconds, 0) / 60)),
      language: opts.language ?? first.metadata.language,
      discipline: first.metadata.discipline,
      authoring,
    },
    concepts,
    scenes,
    rules: [],
    validated_by: allValidated ? "review of teacher-validated lessons"
      : authoring.mode === "self_study" ? "SELF-STUDY — review of lessons not all teacher-validated"
        : "DRAFT — review of lessons not all teacher-validated",
    validated_at: opts.nowIso,
  } as LessonBundle;
  return { bundle, origins, approvedSources: allValidated };
}
