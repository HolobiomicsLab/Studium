// packages/lesson-session-host/src/study-plan.test.ts
//
// get_study_plan's pure core (HJ-5, HJ-1 point 3): what is due, what to relearn, the earliest review
// still ahead — never one already past — and the one next step, in the learner's language.
import { describe, it, expect } from "vitest";
import { buildStudyPlan, scheduleFromMemory, type StudyPlanInput } from "./study-plan.js";
import { emptyStudyRecord, type StudyRecord } from "./study-record.js";
import type { Catalog, CatalogLesson } from "./lesson-catalog.js";
import type { ConceptMemoryState } from "./fsrs-memory.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T09:00:00Z");
const mem = (concept_id: string, lastMs: number, stability = 3, reps = 1): ConceptMemoryState =>
  ({ concept_id, stability, difficulty: 5, last_reviewed_at: lastMs, reps, lapses: 0 });

function lessonEntry(bundle_ref: string, bundle_id: string, title: string, concepts: string[], extra: Partial<CatalogLesson> = {}): CatalogLesson {
  return {
    bundle_ref, root: "library", bundle_id, title, language: "fr", discipline: "chimie",
    authoring: { mode: "self_study", drafted_by: "agent" }, validated: false,
    concepts: concepts.map((id) => ({ id, title: `Notion ${id}` })), scene_count: 3, modified_at: NOW - DAY, ...extra,
  };
}
const catalogOf = (...lessons: CatalogLesson[]): Catalog => ({ lessons, courses: [], skipped: 0 });

function input(over: Partial<StudyPlanInput> = {}): StudyPlanInput {
  return {
    nowMs: NOW, memory: {}, mastery: {}, record: emptyStudyRecord(), completedLessons: [],
    catalog: catalogOf(), locale: "fr", learnerId: "ana",
    // By default every concept in memory has a review scene; tests about unplayable reviews say so.
    playableReviews: new Set(Object.keys(over.memory ?? {})),
    // By default a concept given a mastery was measured (graded); tests about self-rated ones say so.
    measured: new Set(Object.keys(over.mastery ?? {})), ...over,
  };
}

describe("scheduleFromMemory", () => {
  it("splits due (mastered) from relearn (weak), and dates only a review still ahead", () => {
    const memory = {
      "c-mastered": mem("c-mastered", NOW - 30 * DAY),
      "c-weak": mem("c-weak", NOW - 30 * DAY),
      "c-fresh": mem("c-fresh", NOW - DAY, 50),
    };
    const s = scheduleFromMemory(memory, { "c-mastered": 0.9, "c-weak": 0.3, "c-fresh": 0.9 }, NOW,
      new Set(["c-mastered", "c-weak", "c-fresh"]));
    expect(s.due.map((d) => d.concept_id)).toEqual(["c-mastered"]);
    expect(s.relearn.map((d) => d.concept_id)).toEqual(["c-weak"]);
    expect(s.next_due_at).toBeGreaterThan(NOW);
    expect(s.has_history).toBe(true);
  });

  it("gives no date rather than a past one when every reviewed concept is already due (HJ-1)", () => {
    const s = scheduleFromMemory({ "c-weak": mem("c-weak", NOW - 30 * DAY) }, { "c-weak": 0.3 }, NOW, new Set(["c-weak"]));
    expect(s.relearn).toHaveLength(1);
    expect(s.next_due_at).toBeNull();
  });

  it("lists a concept nobody measured (self-rated only) as due for review, never as one to relearn (I-3)", () => {
    const memory = { "c-self": mem("c-self", NOW - 30 * DAY), "c-weak": mem("c-weak", NOW - 30 * DAY) };
    // c-self's 0.3 is the prior: no graded attempt ever moved it. c-weak was graded and stayed low.
    const s = scheduleFromMemory(memory, { "c-self": 0.3, "c-weak": 0.3 }, NOW, new Set(["c-weak"]));
    expect(s.relearn.map((d) => d.concept_id)).toEqual(["c-weak"]);
    expect(s.unmeasured.map((d) => d.concept_id)).toEqual(["c-self"]);
    expect(s.due).toEqual([]);
  });

  it("ignores concepts never reviewed", () => {
    const s = scheduleFromMemory({ c: { ...mem("c", NOW), reps: 0, last_reviewed_at: null, stability: 0 } }, { c: 0.9 }, NOW, new Set(["c"]));
    // `unmeasured: []` joined the schedule with lead decision I-3 (a third, empty list here).
    expect(s).toEqual({ due: [], relearn: [], unmeasured: [], next_due_at: null, has_history: false });
  });
});

describe("buildStudyPlan", () => {
  const record: StudyRecord = {
    ...emptyStudyRecord(),
    concepts: { "c-a": { bundle_ref: "a/lesson.json", bundle_id: "lesson-a", scene_id: "s-q", lesson_title: "Atomes" } },
    lessons: {
      "lesson-b": { bundle_ref: "b/lesson.json", bundle_id: "lesson-b", title: "Liaisons", language: "fr",
        scenes_completed: 1, total_scenes: 3, completed: false, updated_at: "2026-11-19T10:00:00Z" },
    },
  };
  const catalog = catalogOf(
    lessonEntry("a/lesson.json", "lesson-a", "Atomes", ["c-a"]),
    lessonEntry("b/lesson.json", "lesson-b", "Liaisons", ["c-b"]),
    lessonEntry("c/lesson.json", "lesson-c", "Cristaux", ["c-c"], { modified_at: NOW }),
  );

  it("puts a due review first, naming the lesson and scene it is played from", () => {
    const plan = buildStudyPlan(input({ memory: { "c-a": mem("c-a", NOW - 30 * DAY) }, mastery: { "c-a": 0.9 }, record, catalog }));
    expect(plan.next_step).toEqual({
      action: "review", tool: "start_review_session", arguments: { learner_id: "ana" },
      text: "tu as 1 notion(s) à revoir (Notion c-a). Lance une séance de révision.",
    });
    expect(plan.due_reviews).toEqual([expect.objectContaining({
      concept_id: "c-a", concept: "Notion c-a", lesson: { bundle_ref: "a/lesson.json", title: "Atomes" }, scene_id: "s-q",
    })]);
    expect(plan.display_markdown).toContain("**À réviser**");
  });

  it("then a lesson in progress, then the newest library lesson not started, then authoring", () => {
    expect(buildStudyPlan(input({ record, catalog })).next_step)
      .toMatchObject({ action: "continue", arguments: { bundle_ref: "b/lesson.json", learner_id: "ana" } });
    expect(buildStudyPlan(input({ catalog })).next_step)
      .toMatchObject({ action: "start", arguments: { bundle_ref: "c/lesson.json" } });
    expect(buildStudyPlan(input()).next_step).toMatchObject({ action: "author", tool: "get_authoring_guide" });
  });

  it("offers a lesson of the bundles root when the library has none to start", () => {
    const shared = lessonEntry("cours/lesson.json", "cours", "Cours du prof", ["c-x"], { root: "bundles" });
    const plan = buildStudyPlan(input({ catalog: catalogOf(shared) }));
    expect(plan.next_step).toMatchObject({ action: "start", arguments: { bundle_ref: "cours/lesson.json", learner_id: "ana" } });
  });

  it("waits with the date of the next review when nothing is left to do", () => {
    const memory = { "c-a": mem("c-a", NOW - DAY, 50) };
    const plan = buildStudyPlan(input({
      memory, mastery: { "c-a": 0.9 }, catalog: catalogOf(lessonEntry("a/lesson.json", "lesson-a", "Atomes", ["c-a"])),
      completedLessons: ["lesson-a"], locale: "en",
    }));
    expect(plan.next_step.action).toBe("wait");
    expect(plan.next_step.text).toMatch(/^nothing to review right now\. Next review: /);
    expect(plan.next_review_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(plan.display_markdown).toContain("### Your study plan");
  });

  it("does not send the learner to a review no lesson can play any more", () => {
    // The concept's lesson was deleted: it is still listed (with no lesson), but the next step is
    // not a review that start_review_session would answer with « nothing to review ».
    const gone: StudyRecord = { ...emptyStudyRecord(),
      concepts: { "c-gone": { bundle_ref: "gone/lesson.json", bundle_id: "gone", scene_id: "s", lesson_title: "Disparue" } } };
    const plan = buildStudyPlan(input({
      memory: { "c-gone": mem("c-gone", NOW - 30 * DAY) }, mastery: { "c-gone": 0.9 }, record: gone,
      catalog: catalogOf(lessonEntry("c/lesson.json", "lesson-c", "Cristaux", ["c-c"])),
    }));
    expect(plan.due_reviews).toEqual([expect.objectContaining({ concept_id: "c-gone", lesson: null, scene_id: null })]);
    expect(plan.next_step).toMatchObject({ action: "start", arguments: { bundle_ref: "c/lesson.json" } });
  });

  it("never makes a review the next step when its lesson has no review scene to play (R2)", () => {
    // c-a is due and its lesson is on disk, but that lesson teaches it only through scenes the review
    // session cannot replay (a communication_sim, a run-bound reproduction): the concept stays listed,
    // marked unplayable, and the plan falls through to the lesson in progress.
    const plan = buildStudyPlan(input({
      memory: { "c-a": mem("c-a", NOW - 30 * DAY) }, mastery: { "c-a": 0.9 }, record, catalog,
      playableReviews: new Set(),
    }));
    expect(plan.due_reviews).toEqual([expect.objectContaining({
      concept_id: "c-a", lesson: { bundle_ref: "a/lesson.json", title: "Atomes" }, playable: false,
    })]);
    expect(plan.next_step).toMatchObject({ action: "continue", arguments: { bundle_ref: "b/lesson.json" } });
    expect(plan.display_markdown).toContain("aucune question de révision");
  });

  it.each([["fr", "**À revoir**", "**À reprendre**"], ["en", "**Due for review**", "**To relearn**"]] as const)(
    "shows a self-rated concept under %s's « due for review », never « to relearn », and plays it (I-3)", (locale, revisit, relearn) => {
      const plan = buildStudyPlan(input({
        memory: { "c-a": mem("c-a", NOW - 30 * DAY) }, mastery: { "c-a": 0.3 }, measured: new Set(), record, catalog, locale,
      }));
      expect(plan.relearn).toEqual([]);
      expect(plan.unmeasured_reviews).toEqual([expect.objectContaining({ concept_id: "c-a", playable: true })]);
      expect(plan.display_markdown).toContain(`${revisit}\n\n- Notion c-a`);
      expect(plan.display_markdown).not.toContain(relearn);
      expect(plan.next_step).toMatchObject({ action: "review", tool: "start_review_session" });
    });

  it("marks a playable review as such", () => {
    const plan = buildStudyPlan(input({ memory: { "c-a": mem("c-a", NOW - 30 * DAY) }, mastery: { "c-a": 0.9 }, record, catalog }));
    expect(plan.due_reviews[0]).toMatchObject({ concept_id: "c-a", playable: true });
    expect(plan.display_markdown).not.toContain("aucune question de révision");
  });
});
