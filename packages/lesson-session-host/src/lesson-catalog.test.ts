// packages/lesson-session-host/src/lesson-catalog.test.ts
//
// HJ-5: no tool listed the playable lessons, so a harness had to `ls` BUNDLES_ROOT. The catalog
// walks the bundles root and the learner's library with the pane's rules (top-level *.json, or
// lesson.json up to two folders deep), reads each lesson once, and reports what list_lessons shows.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCatalog, nearestRefs } from "./lesson-catalog.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempRoot(): string { const d = mkdtempSync(join(tmpdir(), "catalog-")); dirs.push(d); return d; }

function lesson(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title, target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie", ...extra },
    concepts: [{ id: `${id}-c`, title: `Concept ${title}`, description: "d", bloom_level_target: "understand" }],
    scenes: [{ id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: [`${id}-c`],
      estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" }],
    rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
  };
}
function put(root: string, ref: string, data: unknown): void {
  const path = join(root, ref);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
}

describe("scanCatalog", () => {
  it("lists lessons with the pane's rules and skips what cannot be a playable lesson", async () => {
    const root = tempRoot();
    put(root, "top.json", lesson("top", "Top"));
    put(root, "a/lesson.json", lesson("a", "Alpha"));
    put(root, "b/c/lesson.json", lesson("bc", "Deux niveaux"));
    put(root, "d/e/f/lesson.json", lesson("deep", "Trop profond"));
    put(root, "node_modules/x/lesson.json", lesson("nm", "Ignored"));
    put(root, "data/p/lesson.json", lesson("data", "Learner data folder"));
    put(root, "a/notes.json", { not: "a lesson" });
    put(root, "bad/lesson.json", "{ not json");
    const catalog = await scanCatalog([{ kind: "bundles", dir: root }]);
    expect(catalog.lessons.map((l) => l.bundle_ref)).toEqual(["a/lesson.json", "b/c/lesson.json", "top.json"]);
    expect(catalog.skipped).toBe(1); // bad/lesson.json is named like a lesson but does not load
    const alpha = catalog.lessons[0]!;
    expect(alpha).toMatchObject({
      bundle_id: "a", title: "Alpha", language: "fr", root: "bundles", scene_count: 1,
      authoring: { mode: "teacher", drafted_by: "teacher" }, validated: true,
      concepts: [{ id: "a-c", title: "Concept Alpha" }],
    });
    expect(alpha.modified_at).toBeGreaterThan(0);
  });

  it("searches the library after the bundles root and lists a shared root once", async () => {
    const bundles = tempRoot();
    const library = tempRoot();
    put(bundles, "x/lesson.json", lesson("x", "From fixtures"));
    put(library, "mine/lesson.json", lesson("mine", "Mine", {
      authoring: { mode: "self_study", author_is_learner: false, drafted_by: "agent" },
    }));
    const both = await scanCatalog([{ kind: "bundles", dir: bundles }, { kind: "library", dir: library }]);
    expect(both.lessons.map((l) => [l.root, l.bundle_ref])).toEqual([["bundles", "x/lesson.json"], ["library", "mine/lesson.json"]]);
    const same = await scanCatalog([{ kind: "bundles", dir: library }, { kind: "library", dir: library }]);
    expect(same.lessons).toHaveLength(1);
  });

  it("treats a missing root (a fresh install has no library yet) as empty", async () => {
    const catalog = await scanCatalog([{ kind: "library", dir: join(tempRoot(), "absent") }]);
    expect(catalog).toEqual({ lessons: [], courses: [], skipped: 0 });
  });

  it("never descends into an excluded directory (the learner data dir may sit inside a root)", async () => {
    const root = tempRoot();
    put(root, "a/lesson.json", lesson("a", "Alpha"));
    put(root, "state/x/lesson.json", lesson("x", "Inside the data dir"));
    const catalog = await scanCatalog([{ kind: "bundles", dir: root }], { exclude: [join(root, "state")] });
    expect(catalog.lessons.map((l) => l.bundle_ref)).toEqual(["a/lesson.json"]);
  });

  it("reads course manifests for the course spine", async () => {
    const root = tempRoot();
    put(root, "courses/c.json", {
      schema_version: "1.0", course_id: "c", title: "Course",
      lessons: [{ lesson_id: "a", bundle_ref: "a/lesson.json", prerequisite_lesson_ids: [] }],
    });
    const catalog = await scanCatalog([{ kind: "bundles", dir: root }]);
    expect(catalog.courses.map((c) => [c.course_ref, c.course.course_id])).toEqual([["courses/c.json", "c"]]);
  });
});

describe("nearestRefs", () => {
  it("ranks the refs that share the most of the requested name, best first", () => {
    const refs = ["atomistique-l1/lesson.json", "capsule-demo/lesson.json", "m6/demo-atomistique/lesson.json"];
    expect(nearestRefs("atomistique/lesson.json", refs, 2)).toEqual([
      "atomistique-l1/lesson.json", "m6/demo-atomistique/lesson.json",
    ]);
    expect(nearestRefs("zzz", refs, 3)).toEqual([]);
  });
});
