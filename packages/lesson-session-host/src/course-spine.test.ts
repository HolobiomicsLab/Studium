// COURSE SPINE at the host level: nextLesson routes the next lesson off the learner's completed lessons
// (recorded in the cross-lesson profile on completion), gated by prerequisites; resolveCourse loads the
// real course manifest fixture.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Course } from "@studium/lesson-bundle-schema";
import { SessionHost } from "./host.js";
import { resolveCourse } from "./course-resolver.js";

const FIXTURES = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");

function quizBundle(id: string, conceptId: string) {
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title: id, target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
    concepts: [{ id: conceptId, title: "C", description: "d", bloom_level_target: "understand" }],
    scenes: [
      { id: "s-q", type: "quiz", title: "Q", objective_refs: [], concept_refs: [conceptId], estimated_seconds: 0, adaptation_hooks: [],
        question: "?", choices: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }], feedback_correct: "y", feedback_incorrect: "n", hints: [] },
    ],
    rules: [], validated_by: "teacher", validated_at: "2026-06-28T00:00:00Z",
  };
}

describe("course spine — multi-lesson sequencing", () => {
  it("routes the next lesson as the learner completes lessons; finished -> null", async () => {
    const d = mkdtempSync(join(tmpdir(), "course-"));
    writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c1")));
    writeFileSync(join(d, "B.json"), JSON.stringify(quizBundle("lesson-B", "c2")));
    const course: Course = {
      schema_version: "1.0", course_id: "demo", title: "Demo",
      lessons: [
        { lesson_id: "lesson-A", bundle_ref: "A.json", prerequisite_lesson_ids: [] },
        { lesson_id: "lesson-B", bundle_ref: "B.json", prerequisite_lesson_ids: ["lesson-A"] },
      ],
    };
    try {
      const host = new SessionHost({ bundlesRoot: d, live: false });
      // fresh learner -> the first lesson is A (B is gated on A)
      expect((await host.nextLesson(course, "learner-1"))?.lesson_id).toBe("lesson-A");

      // complete A -> recorded in the profile
      const a = await host.create(course.lessons[0]!.bundle_ref, "learner-1");
      const ta = await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: "a" });
      expect(ta.kind).toBe("complete");

      // now next is B
      expect((await host.nextLesson(course, "learner-1"))?.lesson_id).toBe("lesson-B");

      // complete B -> course finished
      const b = await host.create(course.lessons[1]!.bundle_ref, "learner-1");
      await host.respond(b.sessionId, { kind: "quiz_choice", choiceId: "a" });
      expect(await host.nextLesson(course, "learner-1")).toBeNull();

      // a DIFFERENT learner still starts at lesson A (per-learner progress)
      expect((await host.nextLesson(course, "learner-2"))?.lesson_id).toBe("lesson-A");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("resolveCourse loads + validates the real decay-course fixture", async () => {
    const course = await resolveCourse(FIXTURES, "courses/decay-course.json");
    expect(course.course_id).toBe("decay-course");
    expect(course.lessons.map((l) => l.lesson_id)).toEqual(["capsule-run-demo", "capsule-loop-demo"]);
    expect(course.lessons[1]!.prerequisite_lesson_ids).toEqual(["capsule-run-demo"]);
  });
});
