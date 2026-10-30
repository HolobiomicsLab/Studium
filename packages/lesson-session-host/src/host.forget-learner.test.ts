// packages/lesson-session-host/src/host.forget-learner.test.ts
//
// L-13 (R-en-07, UX-01 host side): a learner can erase their data without a live session, and is told
// what was erased and what stays. forget(session) erases this lesson's progress and the learner's
// cross-lesson profile and review schedule; forgetLearner(learner) erases every lesson's progress as
// well. Both leave no empty pseudonym folder behind, and both say what is kept: the lessons in the
// library and the sources they were built from (and, for one lesson, the progress in the others).
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionHost } from "./host.js";

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "forget-learner-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function write(root: string, ref: string, data: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(data));
}
const quiz = (id: string, concept: string) => ({
  id, type: "quiz", title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
  question: `Question ${id} ?`, choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
function lesson(id: string, title: string, scenes: Array<{ concept_refs: string[] }>, language = "fr") {
  const concepts = [...new Set(scenes.flatMap((s) => s.concept_refs))];
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title, target: "L1", duration_minutes: 5, language, discipline: "chimie",
      authoring: { mode: "self_study", author_is_learner: false, drafted_by: "agent" } },
    concepts: concepts.map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: "SELF-STUDY — not teacher-validated", validated_at: "2026-10-01T00:00:00Z",
  };
}
const idOf = (presentation: { scene: unknown }): string =>
  (presentation.scene as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === "Juste")!.id;

/** Every folder and file under the data folder, relative, sorted. */
function tree(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).map((p) => p.split("\\").join("/")).sort();
}

async function setup() {
  const library = tmp();
  const data = tmp();
  write(library, "atomes/lesson.json", lesson("lesson-atomes", "Les atomes", [quiz("s-a", "c-a"), quiz("s-a2", "c-a")]));
  write(library, "liaisons/lesson.json", lesson("lesson-liaisons", "Les liaisons", [quiz("s-l", "c-l"), quiz("s-l2", "c-l")]));
  mkdirSync(join(library, "_sources"), { recursive: true });
  writeFileSync(join(library, "_sources", "ss-1.json"), "{}");
  const host = new SessionHost({ bundlesRoot: library, libraryRoot: library, live: false, dataDir: data });
  const play = async (ref: string, learner: string) => {
    const s = await host.create(ref, learner);
    await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: idOf(s.presentation) });
    return s.sessionId;
  };
  return { host, library, data, play };
}

describe("forgetLearner (L-13): no live session needed, every lesson erased", () => {
  it("erases every lesson's progress, the profile and the review schedule, and says what stays", async () => {
    const { host, library, data, play } = await setup();
    await host.close(await play("atomes/lesson.json", "ben"));
    const bensFiles = tree(data);
    await host.close(await play("atomes/lesson.json", "ana"));
    await host.close(await play("liaisons/lesson.json", "ana"));
    const open = await play("liaisons/lesson.json", "ana"); // still open when the learner asks

    const report = await host.forgetLearner("ana");
    expect(report).toMatchObject({ forgotten: true, scope: "learner" });
    expect(report.erased).toEqual([
      { kind: "lesson_progress", lessons: ["Les atomes", "Les liaisons"] },
      { kind: "learner_profile" },
      { kind: "study_record" },
    ]);
    expect(report.kept.slice(0, 2)).toEqual([
      { kind: "library_lessons", lessons: ["Les atomes", "Les liaisons"], path: library },
      { kind: "lesson_sources", path: join(library, "_sources") },
    ]);
    // The install's pseudonym key holds no learner data; it stays, and the JSON says so.
    if (existsSync(join(data, ".studium-secret"))) {
      expect(report.kept[2]).toEqual({ kind: "pseudonym_key", path: join(data, ".studium-secret") });
    }
    expect(report.display_markdown).toContain("Les atomes");
    expect(report.display_markdown).toContain(join(library, "_sources"));
    expect(report.display_markdown).not.toContain("pseudonym");

    // Nothing of ana is left, not even an empty folder; ben's data is untouched.
    expect(tree(data)).toEqual(bensFiles);
    expect(host.has(open)).toBe(false);
    const again = await host.create("atomes/lesson.json", "ana");
    expect(again.resume).toMatchObject({ kind: "new", scenes_completed: 0 });
    expect((again.presentation as { learnerSnapshot: { conceptMastery: object } }).learnerSnapshot.conceptMastery).toEqual({});
    expect((await host.create("atomes/lesson.json", "ben")).resume.scenes_completed).toBe(1);
  });

  it("answers an unknown learner in words, erasing nothing", async () => {
    const { host, data } = await setup();
    const before = tree(data);
    const report = await host.forgetLearner("nobody");
    expect(report).toMatchObject({ forgotten: true, scope: "learner", erased: [] });
    expect(report.display_markdown).toMatch(/Nothing|Rien/);
    expect(tree(data)).toEqual(before);
  });
});

describe("forget(session) (L-13): this lesson, the profile and the schedule", () => {
  it("says which other lessons keep their progress, and removes the empty folders", async () => {
    const { host, data, play } = await setup();
    await host.close(await play("atomes/lesson.json", "ana"));
    const profileDir = readdirSync(data).find((entry) => existsSync(join(data, entry, "profile.json")));
    expect(profileDir).toBeDefined();
    const atomesOnly = tree(data).filter((p) => p !== profileDir && !p.startsWith(`${profileDir}/`));
    const liaisons = await play("liaisons/lesson.json", "ana");

    const report = await host.forget(liaisons);
    expect(report).toMatchObject({ forgotten: true, scope: "lesson" });
    expect(report.erased).toEqual([
      { kind: "lesson_progress", lessons: ["Les liaisons"] },
      { kind: "learner_profile" },
      { kind: "study_record" },
    ]);
    expect(report.kept[0]).toEqual({ kind: "other_lessons_progress", lessons: ["Les atomes"] });
    expect(report.display_markdown).toContain("Les atomes");
    // Only the other lesson's folder is left: no empty folder of the erased lesson or the profile.
    expect(tree(data)).toEqual(atomesOnly);
    for (const entry of readdirSync(data, { withFileTypes: true })) {
      if (entry.isDirectory()) expect(readdirSync(join(data, entry.name)).length).toBeGreaterThan(0);
    }
  });

  it("speaks the lesson's language", async () => {
    const library = tmp();
    write(library, "en/lesson.json", lesson("lesson-en", "Binary search", [quiz("s-1", "c-1")], "en"));
    const host = new SessionHost({ bundlesRoot: library, libraryRoot: library, live: false, dataDir: null });
    const s = await host.create("en/lesson.json", "ana");
    const report = await host.forget(s.sessionId);
    expect(report.display_markdown).toMatch(/^\*\*Your data is erased\.\*\*/);
    expect(report.display_markdown).toContain("Binary search");
  });
});
