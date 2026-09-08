/**
 * @vitest-environment node
 */
// CourseProgress — server-rendered course-spine funnel. Asserts ordered lessons,
// per-lesson distinct-completer counts, prerequisite labels, and the honesty
// boundary (cohort funnel, not per-individual cross-lesson tracking).
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import CourseProgress from "./CourseProgress";
import type { CourseManifest, CourseCompletionResponse } from "@/lib/api";

const COURSE: CourseManifest = {
  schema_version: "1.0",
  course_id: "decay-course",
  title: "Decay kinetics",
  lessons: [
    { lesson_id: "l1", bundle_ref: "l1/lesson.json", title: "Reproduce the fit", prerequisite_lesson_ids: [] },
    { lesson_id: "l2", bundle_ref: "l2/lesson.json", title: "Audit your result", prerequisite_lesson_ids: ["l1"] },
  ],
};

const COMPLETION: CourseCompletionResponse = {
  lessons: { l1: { n_completed: 5 }, l2: { n_completed: 2 } },
  total_completions: 7,
};

function render(course: CourseManifest, completion: CourseCompletionResponse) {
  return renderToStaticMarkup(createElement(CourseProgress, { course, completion }));
}

describe("CourseProgress", () => {
  it("renders lessons in spine order with titles", () => {
    const html = render(COURSE, COMPLETION);
    expect(html).toContain('data-testid="course-progress"');
    expect(html).toContain("1. Reproduce the fit");
    expect(html).toContain("2. Audit your result");
  });

  it("annotates each lesson with its distinct-completer count", () => {
    const html = render(COURSE, COMPLETION);
    expect(html).toContain("5 apprenant");
    expect(html).toContain("2 apprenant");
  });

  it("shows prerequisites by title", () => {
    const html = render(COURSE, COMPLETION);
    expect(html).toContain("Prérequis : Reproduce the fit");
  });

  it("treats a lesson with no completion event as 0 completers", () => {
    const html = render(COURSE, { lessons: { l1: { n_completed: 3 } }, total_completions: 3 });
    expect(html).toContain("0 apprenant"); // l2 absent from completion map
  });

  it("frames counts as independent + disclaims any retention-flow reading (honesty boundary)", () => {
    const html = render(COURSE, COMPLETION);
    expect(html).toContain("INDÉPENDANTS par leçon");
    expect(html).toContain("entonnoir de rétention"); // explicitly NOT a funnel
    expect(html).toContain("profil cross-lesson");
    expect(html).not.toContain("entonnoir de COHORTE"); // the overclaiming framing is gone
  });
});
