// packages/lesson-session-host/src/review-session.ts
//
// start_review_session (HJ-1 point 2, SL-2): one ephemeral lesson made of a retrieval scene for each
// concept due, across every lesson the learner studied. It is graded like any lesson and its
// answers are written back into the learner's FSRS memory; it is never recorded as a completed
// lesson, and nothing of it is kept on disk except that memory and the concepts' mastery.
//
// Scene choice: a retrieval scene of the lesson the concept was learned in, preferring one whose
// FIRST concept is that concept (the one the graders score) and one other than the scene answered
// last time, so a review is not always the same item. Scenes that only make sense inside their
// lesson are left out: a learner-time run, and a judgment grounded on the learner's own run.
import type { LessonBundle, Scene, AuthoringMode } from "@studium/lesson-bundle-schema";
import { draftedByOf, isTeacherValidated, type DraftedBy } from "./authoring.js";

/** Scene types that RE-TEST recall (active retrieval), preferred for reinforcement over a passive
 * intro/exposition — reinforcement is about retrieval practice, not re-reading. */
export const RETRIEVAL_SCENE_TYPES: ReadonlySet<string> = new Set([
  "quiz", "spot_the_flaw", "explain_back", "comparison", "summary_audit", "prompt_practice",
]);

export const REVIEW_BUNDLE_ID = "studium-review";

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
  /** The scene this concept was answered in last, if known. */
  lastSceneId: string | null;
}

const covers = (scene: Scene, conceptId: string) => (scene.concept_refs ?? []).includes(conceptId);
const playableOutsideItsLesson = (scene: Scene) => {
  const s = scene as { run_manifest?: unknown; reference_from_run?: unknown };
  return !s.run_manifest && !s.reference_from_run;
};

export function pickReviewScene(bundle: LessonBundle, conceptId: string, lastSceneId: string | null): Scene | null {
  const candidates = bundle.scenes.filter((s) =>
    RETRIEVAL_SCENE_TYPES.has(s.type) && covers(s, conceptId) && playableOutsideItsLesson(s));
  const primary = candidates.filter((s) => s.concept_refs[0] === conceptId);
  const pool = primary.length ? primary : candidates;
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
 * source has a playable scene.
 */
export function buildReviewBundle(
  sources: readonly ReviewSource[],
  opts: { title: string; nowIso: string },
): { bundle: LessonBundle; origins: Record<string, ReviewOrigin> } | null {
  const picked: Array<{ scene: Scene; source: ReviewSource }> = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const scene = pickReviewScene(source.bundle, source.conceptId, source.lastSceneId);
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
  const allValidated = bundles.every((b) => isTeacherValidated(b.validated_by));
  const first = picked[0]!.source.bundle;
  const bundle = {
    schema_version: "1.4",
    bundle_id: REVIEW_BUNDLE_ID,
    source_plan_id: REVIEW_BUNDLE_ID,
    metadata: {
      title: opts.title,
      target: first.metadata.target,
      duration_minutes: Math.max(1, Math.ceil(scenes.reduce((sum, s) => sum + s.estimated_seconds, 0) / 60)),
      language: first.metadata.language,
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
  return { bundle, origins };
}
