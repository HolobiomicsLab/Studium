// packages/lesson-session-host/src/review-session.test.ts
//
// start_review_session's assembly (HJ-1 point 2, SL-2): one retrieval scene per concept due, from
// the lesson it was learned in, never a scene that only makes sense inside its lesson, and a lesson
// whose provenance and validation are those of the weakest lesson it draws from.
import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { buildReviewBundle, pickReviewScene, REVIEW_BUNDLE_ID, type ReviewSource } from "./review-session.js";

const scene = (id: string, type: string, concepts: string[], extra: object = {}) => ({
  id, type, title: `T ${id}`, objective_refs: [], concept_refs: concepts, estimated_seconds: 90, adaptation_hooks: [], ...extra,
});
function bundle(id: string, scenes: object[], meta: object = {}, validated_by = "Prof. Test"): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title: `Leçon ${id}`, target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie", ...meta },
    concepts: [{ id: "c1", title: "Un", description: "d", bloom_level_target: "understand" },
      { id: "c2", title: "Deux", description: "d", bloom_level_target: "understand" }],
    scenes, rules: [], validated_by, validated_at: "2026-10-01T00:00:00Z",
  } as unknown as LessonBundle;
}
const source = (b: LessonBundle, conceptId: string, lastSceneId: string | null = null): ReviewSource =>
  ({ conceptId, bundleRef: `${b.bundle_id}.json`, bundle: b, baseDir: `/lessons/${b.bundle_id}`, lastSceneId });

describe("pickReviewScene", () => {
  const lesson = bundle("L", [
    scene("intro", "intro", ["c1"]),
    scene("q-other", "quiz", ["c2", "c1"]),
    scene("q-1", "quiz", ["c1"]),
    scene("e-1", "explain_back", ["c1"]),
    scene("run", "reproduction", ["c1"], { run_manifest: { capsule_ref: "x" } }),
    scene("flaw-run", "spot_the_flaw", ["c1"], { reference_from_run: "tc" }),
  ]);

  it("takes a retrieval scene that grades the concept, other than the one answered last when a judge grades them all", () => {
    expect(pickReviewScene(lesson, "c1", null)?.id).toBe("q-1");
    // L-8: without a judge only the quiz re-measures, so it is replayed even when answered last; with a
    // judge every retrieval scene measures, and the other one comes first (this used to be the rule
    // whatever the judge).
    expect(pickReviewScene(lesson, "c1", "q-1")?.id).toBe("q-1");
    expect(pickReviewScene(lesson, "c1", "q-1", { judge: true })?.id).toBe("e-1");
  });

  it("takes only a scene whose first concept is the concept, never a run-bound scene or an intro", () => {
    // L-8: q-other grades c2 (its first concept); it used to be the fallback for c1, which it only mentions.
    expect(pickReviewScene(lesson, "c2", null)?.id).toBe("q-other");
    expect(pickReviewScene(bundle("O", [scene("q-other", "quiz", ["c2", "c1"])]), "c1", null)).toBeNull();
    const runOnly = bundle("R", [scene("intro", "intro", ["c1"]), scene("run", "reproduction", ["c1"], { run_manifest: {} })]);
    expect(pickReviewScene(runOnly, "c1", null)).toBeNull();
  });
});

describe("buildReviewBundle", () => {
  const teacher = bundle("T", [scene("q", "quiz", ["c1"])]);
  const agent = bundle("A", [scene("q", "quiz", ["c2"])],
    { authoring: { mode: "self_study", author_is_learner: true, drafted_by: "agent" } }, "SELF-STUDY — not validated");

  it("namespaces the scene ids, keeps where each comes from, and takes the weakest provenance", () => {
    const built = buildReviewBundle([source(teacher, "c1"), source(agent, "c2")], { title: "Révision", nowIso: "2026-11-09T09:00:00Z" })!;
    expect(built.bundle.bundle_id).toBe(REVIEW_BUNDLE_ID);
    expect(built.bundle.scenes.map((s) => s.id)).toEqual(["r1:q", "r2:q"]);
    expect(built.origins["r2:q"]).toEqual({ bundle_ref: "A.json", bundle_id: "A", scene_id: "q", lesson_title: "Leçon A", baseDir: "/lessons/A" });
    expect(built.bundle.concepts.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(built.bundle.metadata.authoring).toEqual({ mode: "self_study", author_is_learner: true, drafted_by: "agent" });
    expect(built.bundle.validated_by).toMatch(/^SELF-STUDY/);
    expect(built.bundle.metadata.duration_minutes).toBe(3);
  });

  it("plays a scene once even when two due concepts pick it, and builds nothing when none is playable", () => {
    const shared = bundle("S", [scene("q", "quiz", ["c1", "c2"])]);
    const built = buildReviewBundle([source(shared, "c1"), source(shared, "c2")], { title: "R", nowIso: "2026-11-09T09:00:00Z" })!;
    expect(built.bundle.scenes.map((s) => s.id)).toEqual(["r1:q"]);
    expect(buildReviewBundle([source(bundle("I", [scene("intro", "intro", ["c1"])]), "c1")], { title: "R", nowIso: "x" })).toBeNull();
    expect(buildReviewBundle([], { title: "R", nowIso: "x" })).toBeNull();
  });

  it("is teacher-validated only when every lesson it draws from is", () => {
    const built = buildReviewBundle([source(teacher, "c1")], { title: "R", nowIso: "2026-11-09T09:00:00Z" })!;
    expect(built.bundle.validated_by).toBe("review of teacher-validated lessons");
    expect(built.bundle.metadata.authoring).toEqual({ mode: "teacher", author_is_learner: false, drafted_by: "teacher" });
  });
});
