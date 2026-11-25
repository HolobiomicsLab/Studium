// packages/lesson-session-host/src/shipped-lessons.test.ts
//
// Lessons shipped with Studium (2026-11-25, « Discover Studium »): a third lesson root, searched after the
// bundles root and the learner's library. A fresh install has no lesson at all, so the study plan offers the
// shipped demo to a learner who has none of their own, and list_lessons shows it apart from theirs. It never
// shadows nor mixes with the learner's lessons: theirs come first, a shipped lesson with the same ref or
// bundle_id is not listed, and it is never "the next lesson" once the learner has one. Its notice says it
// ships with Studium and was drafted from Studium's documentation, not from the learner's sources.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCatalog, type Catalog, type CatalogLesson } from "./lesson-catalog.js";
import { buildStudyPlan, type StudyPlanInput } from "./study-plan.js";
import { emptyStudyRecord } from "./study-record.js";
import { authoringOf } from "./authoring.js";
import { SessionHost } from "./host.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempRoot(): string { const d = mkdtempSync(join(tmpdir(), "shipped-")); dirs.push(d); return d; }

const NOW = Date.parse("2026-11-25T09:00:00Z");

/** A small agent-drafted self-study lesson: an intro, then one quiz. */
function lesson(id: string, title: string, language: string, conceptId = `${id}.c`) {
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "ss-0000000000000000",
    metadata: {
      title, target: "Newcomers", duration_minutes: 10, language, discipline: "Studium",
      authoring: { mode: "self_study", author_is_learner: false, drafted_by: "agent" },
    },
    concepts: [{ id: conceptId, title: `${title} concept`, description: "d", bloom_level_target: "understand" }],
    scenes: [
      { id: "s1", type: "intro", title: "Welcome", objective_refs: [], concept_refs: [conceptId], estimated_seconds: 30,
        adaptation_hooks: [], markdown: "Hello." },
      { id: "s2", type: "quiz", title: "One question", objective_refs: [], concept_refs: [conceptId], estimated_seconds: 30,
        adaptation_hooks: [], question: "Pick the right one.", choices: [
          { id: "a", text: "Right", correct: true }, { id: "b", text: "Wrong", correct: false }],
        feedback_correct: "Yes.", feedback_incorrect: "No.", hints: [] },
    ],
    rules: [], validated_by: "SELF-STUDY — not teacher-validated", validated_at: "2026-11-25T08:00:00Z",
  };
}
function put(root: string, ref: string, data: unknown): void {
  const path = join(root, ref);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}
/** A shipped root holding the demo in English and in French. */
function shippedRoot(): string {
  const root = tempRoot();
  put(root, "discover-studium-en/lesson.json", lesson("self-study-discover-studium-en", "Discover Studium", "en", "studium.graph"));
  put(root, "discover-studium-fr/lesson.json", lesson("self-study-discover-studium-fr", "Découvrir Studium", "fr", "studium.graph"));
  return root;
}

function entry(ref: string, root: CatalogLesson["root"], language: string, extra: Partial<CatalogLesson> = {}): CatalogLesson {
  return {
    bundle_ref: ref, root, bundle_id: `id-${ref}`, title: `Title ${ref}`, language, discipline: "",
    authoring: { mode: "self_study", drafted_by: "agent" }, validated: false, concepts: [{ id: "c", title: "C" }],
    scene_count: 12, modified_at: NOW, duration_minutes: 10, ...extra,
  };
}
const catalogOf = (...lessons: CatalogLesson[]): Catalog => ({ lessons, courses: [], skipped: 0 });
function input(over: Partial<StudyPlanInput>): StudyPlanInput {
  return {
    nowMs: NOW, memory: {}, mastery: {}, record: emptyStudyRecord(), completedLessons: [], catalog: catalogOf(),
    locale: "en", learnerId: "ana", playableReviews: new Set(), measured: new Set(), timeZone: "UTC", ...over,
  };
}
const DEMO_EN = entry("discover-studium-en/lesson.json", "shipped", "en", { title: "Discover Studium", bundle_id: "demo-en" });
const DEMO_FR = entry("discover-studium-fr/lesson.json", "shipped", "fr", { title: "Découvrir Studium", bundle_id: "demo-fr" });

describe("the shipped lessons root in the catalog", () => {
  it("lists a shipped lesson with root shipped, after the learner's own", async () => {
    const library = tempRoot();
    put(library, "mine/lesson.json", lesson("mine", "Mine", "fr"));
    const catalog = await scanCatalog([{ kind: "library", dir: library }, { kind: "shipped", dir: shippedRoot() }]);
    expect(catalog.lessons.map((l) => [l.root, l.bundle_ref])).toEqual([
      ["library", "mine/lesson.json"], ["shipped", "discover-studium-en/lesson.json"], ["shipped", "discover-studium-fr/lesson.json"],
    ]);
  });

  it("never lists a shipped lesson whose ref or bundle_id a lesson of the learner already has", async () => {
    const library = tempRoot();
    put(library, "discover-studium-en/lesson.json", lesson("my-own-lesson", "My own lesson", "en"));
    put(library, "other/lesson.json", lesson("self-study-discover-studium-fr", "Copied demo", "fr"));
    const catalog = await scanCatalog([{ kind: "library", dir: library }, { kind: "shipped", dir: shippedRoot() }]);
    expect(catalog.lessons.map((l) => [l.root, l.title])).toEqual([
      ["library", "My own lesson"], ["library", "Copied demo"],
    ]);
    expect(catalog.skipped).toBe(0);
  });
});

describe("the study plan offers the shipped demo to a learner with no lesson of their own", () => {
  it("proposes the demo in the learner's language before building a lesson", () => {
    for (const [locale, demo] of [["en", DEMO_EN], ["fr", DEMO_FR]] as const) {
      const plan = buildStudyPlan(input({ catalog: catalogOf(DEMO_EN, DEMO_FR), locale }));
      expect(plan.next_step).toMatchObject({
        action: "start", tool: "start_lesson_session", arguments: { bundle_ref: demo.bundle_ref, learner_id: "ana" },
      });
      expect(plan.next_lesson).toEqual({ bundle_ref: demo.bundle_ref, title: demo.title });
    }
    const en = buildStudyPlan(input({ catalog: catalogOf(DEMO_EN, DEMO_FR), locale: "en" }));
    expect(en.next_step.text).toContain("“Discover Studium”");
    expect(en.next_step.text).toMatch(/shipped with Studium/);
    expect(en.next_step.text).toMatch(/drafted by an AI agent from Studium's documentation, not checked by a teacher/);
    expect(en.next_step.text).toMatch(/your own topic/);
    const fr = buildStudyPlan(input({ catalog: catalogOf(DEMO_EN, DEMO_FR), locale: "fr" }));
    expect(fr.next_step.text).toMatch(/«\s?Découvrir Studium\s?»/u); // French spacing inside the guillemets
    expect(fr.next_step.text).toMatch(/livrée avec Studium/);
    expect(fr.display_markdown).toContain(fr.next_step.text);
  });

  it("never proposes a shipped lesson once the learner has a lesson of their own", () => {
    const mine = entry("mine/lesson.json", "library", "en", { modified_at: NOW - 86_400_000 });
    const plan = buildStudyPlan(input({ catalog: catalogOf(mine, DEMO_EN, DEMO_FR) }));
    expect(plan.next_step).toMatchObject({ action: "start", arguments: { bundle_ref: "mine/lesson.json" } });
    expect(plan.next_lesson?.bundle_ref).toBe("mine/lesson.json");
    // The learner finished their lesson: the plan waits, it does not fall back to the demo.
    const done = buildStudyPlan(input({ catalog: catalogOf(mine, DEMO_EN), completedLessons: [mine.bundle_id] }));
    expect(done.next_step.action).toBe("wait");
    expect(done.next_lesson).toBeNull();
  });

  it("asks to author once the demo was played and the learner has nothing else", () => {
    const record = emptyStudyRecord();
    const plan = buildStudyPlan(input({ catalog: catalogOf(DEMO_EN, DEMO_FR), completedLessons: [DEMO_EN.bundle_id], record }));
    expect(plan.next_step).toMatchObject({ action: "author", tool: "get_authoring_guide" });
  });

  it("names a concept by the lesson the learner studied it in, when two lessons share its id", () => {
    const record = emptyStudyRecord();
    record.concepts["c"] = { bundle_ref: DEMO_FR.bundle_ref, bundle_id: DEMO_FR.bundle_id, lesson_title: DEMO_FR.title, scene_id: "s2" };
    const en = { ...DEMO_EN, concepts: [{ id: "c", title: "A course is a graph" }] };
    const fr = { ...DEMO_FR, concepts: [{ id: "c", title: "Un cours est un graphe" }] };
    const memory = { c: { concept_id: "c", stability: 1, difficulty: 5, last_reviewed_at: NOW - 10 * 86_400_000, reps: 1, lapses: 0 } };
    const plan = buildStudyPlan(input({
      catalog: catalogOf(en, fr), locale: "fr", memory, mastery: { c: 0.9 }, measured: new Set(["c"]), record, playableReviews: new Set(["c"]),
    }));
    expect(plan.due_reviews[0]).toMatchObject({ concept: "Un cours est un graphe", lesson: { bundle_ref: DEMO_FR.bundle_ref } });
  });
});

describe("the notice of a shipped lesson", () => {
  const bundle = (language: string) => ({ metadata: { title: "Discover Studium", target: "t", duration_minutes: 10, language, discipline: "",
    authoring: { mode: "self_study" as const, author_is_learner: false, drafted_by: "agent" as const } } });
  it("says it ships with Studium and was drafted from Studium's documentation, not from the learner's sources", () => {
    const en = authoringOf(bundle("en"), { judge: false, shipped: true });
    expect(en.notice).toMatch(/^Demo lesson shipped with Studium, drafted by an AI agent from Studium's documentation, not checked by a teacher/);
    expect(en.notice).not.toContain("your sources");
    expect(en.notice).toContain("rate your recall");
    expect(en).toMatchObject({ shipped: true, validated: false, drafted_by: "agent" });
    const fr = authoringOf(bundle("fr"), { judge: false, shipped: true });
    expect(fr.notice).toMatch(/^Leçon de démonstration livrée avec Studium, rédigée par l'IA à partir de la documentation de Studium/);
    expect(fr.notice).not.toContain("tes sources");
  });
  it("leaves every other lesson's notice as it was", () => {
    const own = authoringOf(bundle("en"), { judge: false });
    expect(own.notice).toMatch(/^AI-drafted lesson from your sources/);
    expect(own).not.toHaveProperty("shipped");
  });
});

describe("a host with a shipped lessons root", () => {
  function host(library: string, shipped: string) {
    return new SessionHost({ bundlesRoot: library, libraryRoot: library, shippedRoot: shipped, dataDir: null, live: false });
  }

  it("lists shipped lessons apart from the learner's, labelled as shipped with Studium", async () => {
    const library = tempRoot();
    const empty = await host(library, shippedRoot()).listLessons({ language: "en" });
    expect(empty.lessons).toEqual([]);
    expect(empty.shipped_lessons.map((l) => [l.bundle_ref, l.source])).toEqual([
      ["discover-studium-en/lesson.json", "shipped"], ["discover-studium-fr/lesson.json", "shipped"],
    ]);
    expect(empty.display_markdown).toMatch(/Shipped with Studium/);
    expect(empty.display_markdown).toContain("Discover Studium");
    expect(empty.display_markdown).not.toContain("Découvrir Studium"); // the other language is in the JSON only
    put(library, "mine/lesson.json", lesson("mine", "Mine", "en"));
    const mine = await host(library, shippedRoot()).listLessons({ language: "en" });
    expect(mine.lessons.map((l) => l.bundle_ref)).toEqual(["mine/lesson.json"]);
    expect(mine.display_markdown.indexOf("Mine")).toBeLessThan(mine.display_markdown.indexOf("Shipped with Studium"));
  });

  it("starts a shipped lesson by its ref with the shipped notice, and the plan proposes it first", async () => {
    const library = tempRoot();
    const h = host(library, shippedRoot());
    const plan = await h.studyPlan("ana", { language: "fr", nowMs: NOW });
    expect(plan.next_step).toMatchObject({ action: "start", arguments: { bundle_ref: "discover-studium-fr/lesson.json" } });
    const started = await h.create(plan.next_step.arguments["bundle_ref"] as string, "ana");
    expect(started.authoring).toMatchObject({ shipped: true, validated: false, drafted_by: "agent" });
    expect(started.authoring.notice).toMatch(/^Leçon de démonstration livrée avec Studium/);
  });

  it("reads the shipped folder as shipped when a server is pointed at it as its bundles root", async () => {
    // The VS Code extension opens the demo with BUNDLES_ROOT set to the shipped folder.
    const shipped = shippedRoot();
    const h = new SessionHost({ bundlesRoot: shipped, libraryRoot: tempRoot(), shippedRoot: shipped, dataDir: null, live: false });
    const started = await h.create("discover-studium-en/lesson.json", "ana");
    expect(started.authoring).toMatchObject({ shipped: true });
    const listed = await h.listLessons({ language: "en" });
    expect(listed.lessons).toEqual([]);
    expect(listed.shipped_lessons).toHaveLength(2);
  });

  it("plays the learner's own lesson when it has the same ref as a shipped one", async () => {
    const library = tempRoot();
    put(library, "discover-studium-en/lesson.json", lesson("my-own-lesson", "My own lesson", "en"));
    const started = await host(library, shippedRoot()).create("discover-studium-en/lesson.json", "ana");
    expect(started.presentation.scene.title).toBe("Welcome");
    expect(started.authoring).not.toHaveProperty("shipped");
    expect(started.authoring.notice).toMatch(/^AI-drafted lesson from your sources/);
  });
});
