// AUTO-ROUTING FSRS into course selection: host.nextCourseStep makes a DUE reinforcement PREEMPT
// advancing to new material — so spaced repetition actually drives the next step, not just a readout.
// When nothing is due, advance the course spine; when the spine is done, "done" (but a still-due concept
// keeps surfacing "reinforce" — review continues past the last lesson).
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 0, 1);

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

const course = {
  schema_version: "1.0" as const, course_id: "c", title: "Decay",
  lessons: [
    { lesson_id: "lesson-A", bundle_ref: "A.json", prerequisite_lesson_ids: [] },
    { lesson_id: "lesson-B", bundle_ref: "B.json", prerequisite_lesson_ids: ["lesson-A"] },
  ],
};

function setup() {
  const d = mkdtempSync(join(tmpdir(), "ncs-"));
  writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-shared")));
  writeFileSync(join(d, "B.json"), JSON.stringify(quizBundle("lesson-B", "c-other")));
  return { d, host: new SessionHost({ bundlesRoot: d, live: false }) };
}

describe("host.nextCourseStep — FSRS reinforcement preempts course advancement", () => {
  it("fresh learner → advance to the first lesson (nothing learned yet, nothing due)", async () => {
    const { d, host } = setup();
    try {
      const step = await host.nextCourseStep(course, "learner-1", t0);
      expect(step.kind).toBe("advance");
      if (step.kind === "advance") expect(step.lesson.lesson_id).toBe("lesson-A");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("after completing A: fresh-time → advance to B; future-time (decayed) → REINFORCE c-shared (preempts B)", async () => {
    const { d, host } = setup();
    try {
      const a = await host.create("A.json", "learner-1");
      expect((await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: "a" })).kind).toBe("complete");

      // immediately (fresh) nothing is due → advance the spine to B
      const soon = await host.nextCourseStep(course, "learner-1", Date.now());
      expect(soon.kind).toBe("advance");
      if (soon.kind === "advance") expect(soon.lesson.lesson_id).toBe("lesson-B");

      // far in the future c-shared has decayed → reinforcement PREEMPTS advancing to B
      const later = await host.nextCourseStep(course, "learner-1", Date.UTC(2035, 0, 1));
      expect(later.kind).toBe("reinforce");
      if (later.kind === "reinforce") {
        expect(later.concept_id).toBe("c-shared");
        expect(later.retrievability).toBeLessThan(1);
      }
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("course spine exhausted + nothing due → done; but a still-due concept keeps surfacing reinforce", async () => {
    const { d, host } = setup();
    try {
      const a = await host.create("A.json", "learner-1");
      await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: "a" });
      const b = await host.create("B.json", "learner-1");
      await host.respond(b.sessionId, { kind: "quiz_choice", choiceId: "a" });

      // both lessons done + fresh → done
      const done = await host.nextCourseStep(course, "learner-1", Date.now());
      expect(done.kind).toBe("done");

      // ...but review never stops: far-future, a decayed concept still routes to reinforce
      const review = await host.nextCourseStep(course, "learner-1", Date.UTC(2035, 0, 1));
      expect(review.kind).toBe("reinforce");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("a STUCK spine (an unmet/dangling prereq) is BLOCKED, not falsely reported done", async () => {
    const { d, host } = setup();
    try {
      // lesson-B depends on a lesson id that does not exist in the course → never unlockable
      const stuckCourse = {
        schema_version: "1.0" as const, course_id: "c", title: "Stuck",
        lessons: [{ lesson_id: "lesson-B", bundle_ref: "B.json", prerequisite_lesson_ids: ["lesson-NEVER"] }],
      };
      const step = await host.nextCourseStep(stuckCourse, "learner-1", Date.now());
      expect(step.kind).toBe("blocked"); // remaining-but-locked ≠ done
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
