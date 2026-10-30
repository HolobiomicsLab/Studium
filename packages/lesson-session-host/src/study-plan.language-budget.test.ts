// packages/lesson-session-host/src/study-plan.language-budget.test.ts
//
// L-4 (RFR-04): get_study_plan, list_lessons and start_review_session speak the language they are
// asked for (fr|en), else the language of the learner's last lesson, else the server's default; the
// next step's arguments carry it to the tool that takes it.
// RFR-06 (plan part): the minutes a day the learner said they have (kept in their study record, or
// read from the self-study lesson they asked for) shape the plan: a lesson longer than that is
// proposed in several sittings, and a review session longer than that is cut with max_items.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildStudyPlan, type StudyPlanInput } from "./study-plan.js";
import { emptyStudyRecord, type StudyRecord } from "./study-record.js";
import type { Catalog, CatalogLesson } from "./lesson-catalog.js";
import type { ConceptMemoryState } from "./fsrs-memory.js";
import { SessionHost } from "./host.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T09:00:00Z");
const mem = (concept_id: string, lastMs: number): ConceptMemoryState =>
  ({ concept_id, stability: 3, difficulty: 5, last_reviewed_at: lastMs, reps: 1, lapses: 0 });

function entry(bundle_ref: string, bundle_id: string, title: string, concepts: string[], extra: Partial<CatalogLesson> = {}): CatalogLesson {
  return {
    bundle_ref, root: "library", bundle_id, title, language: "fr", discipline: "biologie",
    authoring: { mode: "self_study", drafted_by: "agent" }, validated: false,
    concepts: concepts.map((id) => ({ id, title: `Notion ${id}` })), scene_count: 11, modified_at: NOW - DAY, ...extra,
  };
}
const catalogOf = (...lessons: CatalogLesson[]): Catalog => ({ lessons, courses: [], skipped: 0 });
function input(over: Partial<StudyPlanInput> = {}): StudyPlanInput {
  return {
    nowMs: NOW, memory: {}, mastery: {}, record: emptyStudyRecord(), completedLessons: [], catalog: catalogOf(),
    locale: "fr", learnerId: "ana", playableReviews: new Set(Object.keys(over.memory ?? {})),
    measured: new Set(Object.keys(over.mastery ?? {})), timeZone: "UTC", ...over,
  };
}

describe("next_step.arguments carry the plan's language to the tool that takes it (L-4)", () => {
  it("to start_review_session and get_authoring_guide, not to start_lesson_session", () => {
    expect(buildStudyPlan(input({ locale: "en" })).next_step).toMatchObject({ tool: "get_authoring_guide", arguments: { language: "en" } });
    const review = buildStudyPlan(input({
      memory: { "c-a": mem("c-a", NOW - 30 * DAY) }, mastery: { "c-a": 0.9 },
      catalog: catalogOf(entry("a/lesson.json", "a", "Atomes", ["c-a"])), // a review plays from a lesson on disk
    }));
    expect(review.next_step).toMatchObject({ tool: "start_review_session", arguments: { learner_id: "ana", language: "fr" } });
    const start = buildStudyPlan(input({ catalog: catalogOf(entry("p/lesson.json", "p", "Photosynthèse", ["c-p"])) }));
    expect(start.next_step).toMatchObject({ tool: "start_lesson_session", arguments: { bundle_ref: "p/lesson.json", learner_id: "ana" } });
    expect(start.next_step.arguments).not.toHaveProperty("language");
  });
});

describe("minutes per day shape the plan (RFR-06)", () => {
  it("proposes a lesson longer than the daily budget in several sittings", () => {
    const lesson = entry("p/lesson.json", "p", "Photosynthèse", ["c-p"], { duration_minutes: 26 });
    const plan = buildStudyPlan(input({ catalog: catalogOf(lesson), minutesPerDay: 20 }));
    expect(plan.minutes_per_day).toBe(20);
    expect(plan.next_step).toMatchObject({ action: "start", estimated_minutes: 26 });
    expect(plan.next_step.text).toContain("26 minutes");
    expect(plan.next_step.text).toContain("20 minutes par jour");
    expect(plan.next_step.text).toContain("2 fois");
    const en = buildStudyPlan(input({ catalog: catalogOf(lesson), minutesPerDay: 20, locale: "en" }));
    expect(en.next_step.text).toContain("20 minutes a day");
    // Without a budget, nothing is said about one.
    const free = buildStudyPlan(input({ catalog: catalogOf(lesson) }));
    expect(free.minutes_per_day).toBeNull();
    expect(free.next_step.text).not.toContain("par jour");
  });

  it("counts what is left of a lesson in progress", () => {
    const record: StudyRecord = { ...emptyStudyRecord(), minutes_per_day: 10, lessons: {
      p: { bundle_ref: "p/lesson.json", bundle_id: "p", title: "Photosynthèse", language: "fr",
        scenes_completed: 8, total_scenes: 10, completed: false, updated_at: "2026-11-19T10:00:00Z" },
    } };
    const lesson = entry("p/lesson.json", "p", "Photosynthèse", ["c-p"], { duration_minutes: 30, scene_count: 10 });
    const plan = buildStudyPlan(input({ catalog: catalogOf(lesson), record }));
    expect(plan.minutes_per_day).toBe(10);
    expect(plan.next_step).toMatchObject({ action: "continue", estimated_minutes: 6 });
    expect(plan.next_step.text).not.toContain("fois"); // 6 minutes left fit in 10
  });

  it("cuts a review session longer than the budget with max_items", () => {
    const memory = Object.fromEntries(["c1", "c2", "c3", "c4", "c5"].map((c) => [c, mem(c, NOW - 30 * DAY)]));
    const mastery = Object.fromEntries(Object.keys(memory).map((c) => [c, 0.9]));
    const reviewSeconds = new Map(Object.keys(memory).map((c) => [c, 300]));
    const catalog = catalogOf(entry("r/lesson.json", "r", "Révisions", Object.keys(memory)));
    const plan = buildStudyPlan(input({ memory, mastery, minutesPerDay: 10, reviewSeconds, catalog }));
    expect(plan.next_step).toMatchObject({ action: "review", arguments: { max_items: 2 }, estimated_minutes: 10 });
    expect(plan.next_step.text).toContain("10 minutes par jour");
    const roomy = buildStudyPlan(input({ memory, mastery, minutesPerDay: 60, reviewSeconds, catalog }));
    expect(roomy.next_step.arguments).not.toHaveProperty("max_items");
    expect(roomy.next_step).toMatchObject({ estimated_minutes: 25 });
  });
});

// --- through the host ----------------------------------------------------------------------------
const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "plan-language-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function write(root: string, ref: string, data: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(data));
}
const quiz = (id: string, concept: string, seconds = 30) => ({
  id, type: "quiz", title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: seconds, adaptation_hooks: [],
  question: `Question ${id} ?`, choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
function lesson(id: string, language: string, scenes: object[], metadata: object = {}) {
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title: `Lesson ${id}`, target: "L1", duration_minutes: 5, language, discipline: "x", ...metadata },
    concepts: [{ id: "c-1", title: "Concept one", description: "d", bloom_level_target: "understand" }],
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
}
const idOf = (presentation: { scene: unknown }): string =>
  (presentation.scene as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === "Juste")!.id;

describe("the study tools speak the language asked for, else the learner's (L-4)", () => {
  it("get_study_plan: a French learner with nothing yet reads French, and the next step says so", async () => {
    const host = new SessionHost({ bundlesRoot: tmp(), live: false, dataDir: null });
    const fr = await host.studyPlan("etu-fr", { language: "fr" });
    expect(fr.display_markdown).toContain("### Ton plan d'étude");
    expect(fr.next_step).toMatchObject({ action: "author", tool: "get_authoring_guide", arguments: { language: "fr" } });
    expect((await host.studyPlan("etu-fr")).display_markdown).toContain("### Your study plan"); // the server's default
  });

  it("list_lessons and start_review_session default to the language of the learner's last lesson", async () => {
    const bundles = tmp();
    write(bundles, "en.json", lesson("lesson-en", "en", [quiz("s-1", "c-1")]));
    const { clock, set } = (() => { let now = NOW; return { clock: { now: () => new Date(now).toISOString() }, set: (ms: number) => { now = ms; } }; })();
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const s = await host.create("en.json", "ana");
    await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: idOf(s.presentation) });

    const listed = await host.listLessons({ learnerId: "ana" });
    expect(listed.display_markdown).toContain("Lesson lesson-en");
    expect(listed.display_markdown).toMatch(/^### Lessons/);
    expect((await host.listLessons({ learnerId: "ana", language: "fr" })).display_markdown).toMatch(/^### Leçons/);

    set(NOW + 7 * DAY);
    const review = await host.startReview("ana");
    if (review.status !== "started") throw new Error(`expected a review, got ${review.status}`);
    expect(review.presentation.display_markdown).toContain("Review 1 of 1");
    const fr = await host.startReview("ana", { language: "fr" });
    if (fr.status !== "started") throw new Error(`expected a review, got ${fr.status}`);
    expect(fr.presentation.display_markdown).toContain("Révision 1 sur 1");
  });

  it("refuses a language Studium does not speak", async () => {
    const host = new SessionHost({ bundlesRoot: tmp(), live: false, dataDir: null });
    await expect(host.studyPlan("ana", { language: "de" as never })).rejects.toThrow(/language must be fr or en/);
  });
});

describe("the daily budget reaches the plan through the learner's study record (RFR-06)", () => {
  it("is read from the self-study lesson the learner asked for, then kept in their study record", async () => {
    const library = tmp();
    const data = tmp();
    write(library, "p/lesson.json", lesson("lesson-p", "fr",
      [quiz("s-1", "c-1", 600), quiz("s-2", "c-1", 600), quiz("s-3", "c-1", 360)],
      { duration_minutes: 26, authoring: { mode: "self_study", author_is_learner: false, drafted_by: "agent",
        learner_profile: { minutes_per_day: 20, prior: "lycée" } } }));
    const host = new SessionHost({ bundlesRoot: library, libraryRoot: library, live: false, dataDir: data });
    const first = await host.studyPlan("ana");
    expect(first.minutes_per_day).toBe(20);
    expect(first.next_step).toMatchObject({ action: "start", estimated_minutes: 26 });
    expect(first.next_step.text).toContain("20 minutes par jour");

    const s = await host.create("p/lesson.json", "ana");
    await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: idOf(s.presentation) });
    const folder = readdirSync(data).find((name) => existsSync(join(data, name, "study.json")))!;
    expect(JSON.parse(readFileSync(join(data, folder, "study.json"), "utf8"))).toMatchObject({ minutes_per_day: 20 });
    const later = await host.studyPlan("ana");
    expect(later).toMatchObject({ minutes_per_day: 20, next_step: { action: "continue" } });
  });
});
