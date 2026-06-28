import { describe, it, expect } from "vitest";
import { CourseSchema, nextCourseLesson, isCourseComplete, type Course } from "../src/index";

const linear: Course = {
  schema_version: "1.0", course_id: "c", title: "C",
  lessons: [
    { lesson_id: "L1", bundle_ref: "L1.json", prerequisite_lesson_ids: [] },
    { lesson_id: "L2", bundle_ref: "L2.json", prerequisite_lesson_ids: ["L1"] },
    { lesson_id: "L3", bundle_ref: "L3.json", prerequisite_lesson_ids: ["L2"] },
  ],
};

describe("course spine — nextCourseLesson / isCourseComplete", () => {
  it("routes linearly: none -> L1; L1 -> L2; L1,L2 -> L3; all -> null", () => {
    expect(nextCourseLesson(linear, [])?.lesson_id).toBe("L1");
    expect(nextCourseLesson(linear, ["L1"])?.lesson_id).toBe("L2");
    expect(nextCourseLesson(linear, ["L1", "L2"])?.lesson_id).toBe("L3");
    expect(nextCourseLesson(linear, ["L1", "L2", "L3"])).toBeNull();
    expect(isCourseComplete(linear, ["L1", "L2", "L3"])).toBe(true);
    expect(isCourseComplete(linear, ["L1"])).toBe(false);
  });

  it("gates on prerequisites — a lesson with an unmet prereq is NOT returned (DAG)", () => {
    const dag: Course = { schema_version: "1.0", course_id: "c", title: "C", lessons: [
      { lesson_id: "intro", bundle_ref: "i.json", prerequisite_lesson_ids: [] },
      { lesson_id: "adv", bundle_ref: "a.json", prerequisite_lesson_ids: ["intro", "mid"] },
      { lesson_id: "mid", bundle_ref: "m.json", prerequisite_lesson_ids: ["intro"] },
    ] };
    expect(nextCourseLesson(dag, ["intro"])?.lesson_id).toBe("mid");        // adv blocked (mid not done) -> mid
    expect(nextCourseLesson(dag, ["intro", "mid"])?.lesson_id).toBe("adv"); // now adv is unlocked
  });

  it("parses a valid course; prerequisite_lesson_ids defaults to []", () => {
    const parsed = CourseSchema.parse({ schema_version: "1.0", course_id: "c", title: "C", lessons: [{ lesson_id: "L1", bundle_ref: "L1.json" }] });
    expect(parsed.lessons[0]!.prerequisite_lesson_ids).toEqual([]);
  });
});
