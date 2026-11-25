// packages/lesson-session-host/src/host.forget-learner.test.ts
//
// L-13 (R-en-07, UX-01 host side): a learner can erase their data without a live session, and is told
// what was erased and what stays. forget(session) erases this lesson's progress and the learner's
// cross-lesson profile and review schedule; forgetLearner(learner) erases every lesson's progress as
// well. Both leave no empty pseudonym folder behind, and both say what is kept: the lessons in the
// library and the sources they were built from (and, for one lesson, the progress in the others).
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { createLesson } from "./authoring-draft/build.js";
import { prepareSources } from "./authoring-draft/source-set.js";

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
    const anaLockDir = tree(data).find((p) => p.startsWith(".learner-locks/") &&
      !p.slice(".learner-locks/".length).includes("/") && !bensFiles.includes(p));
    expect(anaLockDir).toBeDefined();

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

    // L-11 retains only a random forget generation outside the erased learner folders. It stops
    // another process's old session resurrecting ana; ben's files and every deletion stay checked.
    expect(tree(data)).toEqual([...bensFiles, anaLockDir, `${anaLockDir}/tombstone`].sort());
    expect(readFileSync(join(data, anaLockDir!, "tombstone"), "utf8")).toMatch(/^[0-9a-f]{32}\n$/);
    expect(host.has(open)).toBe(false);
    const again = await host.create("atomes/lesson.json", "ana");
    expect(again.resume).toMatchObject({ kind: "new", scenes_completed: 0 });
    // L-6 explicitly lists unmeasured concepts as null rather than leaving the map empty.
    expect(again.presentation.learnerSnapshot.conceptMastery).toEqual({ "c-a": null });
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
    // L-11 adds only the forget generation; the erased lesson/profile folders must still be gone.
    expect(tree(data)).toEqual([...atomesOnly, `.learner-locks/${profileDir}/tombstone`].sort());
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

// Review of the waiting branch, finding 1: when the editor names the learner (the server the Studium VS Code extension
// offers to Copilot, D1), forget_session {learner_id} played any id as the editor's learner, so a model naming another
// learner erased the pane's. That call is irreversible: an id that is not the editor's learner is refused, naming that
// learner and how to forget it, and nothing is erased. No id, or the editor's own, forgets the editor's learner as
// before; the confirmation names the learner forgotten.
describe("forgetLearner when the editor names the learner", () => {
  async function editorSetup() {
    const library = tmp();
    const data = tmp();
    write(library, "atomes/lesson.json", lesson("lesson-atomes", "Les atomes", [quiz("s-a", "c-a"), quiz("s-a2", "c-a")]));
    const host = new SessionHost({
      bundlesRoot: library, libraryRoot: library, live: false, dataDir: data, defaultLearnerId: "vscode-learner", editorNamesLearner: true,
    });
    const s = await host.create("atomes/lesson.json");
    await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: idOf(s.presentation) });
    await host.close(s.sessionId);
    return { host, data };
  }

  it("refuses another learner_id, erasing nothing, and names the editor's learner and how to forget it", async () => {
    const { host, data } = await editorSetup();
    const before = tree(data);
    const refused = host.forgetLearner("some-test-learner");
    await expect(refused).rejects.toThrow(/"some-test-learner"/);
    await expect(refused).rejects.toThrow(/"vscode-learner"/);
    await expect(refused).rejects.toThrow(/nothing was erased/);
    await expect(refused).rejects.toThrow(/call forget_session without learner_id/);
    expect(tree(data)).toEqual(before);
    expect((await host.studyPlan()).in_progress).toHaveLength(1);
  });

  it("forgets the editor's learner with no learner_id, and the confirmation names it", async () => {
    const { host } = await editorSetup();
    const report = await host.forgetLearner(undefined, "en");
    expect(report.erased).toContainEqual({ kind: "lesson_progress", lessons: ["Les atomes"] });
    expect(report.display_markdown).toMatch(/^\*\*Your data is erased\.\*\*\n\nLearner: “vscode-learner”\./);
    expect((await host.studyPlan()).in_progress).toHaveLength(0);
  });

  it("forgets the editor's learner when the learner_id given is the editor's own", async () => {
    const { host } = await editorSetup();
    const report = await host.forgetLearner("vscode-learner", "fr");
    expect(report.erased).toContainEqual({ kind: "lesson_progress", lessons: ["Les atomes"] });
    expect(report.display_markdown).toMatch(/Apprenant\s?: «\s?vscode-learner\s?»\./u);
    expect((await host.studyPlan()).in_progress).toHaveLength(0);
  });

  it("names the learner forgotten on any server, and when there is nothing to erase", async () => {
    const { host, play } = await setup();
    await host.close(await play("atomes/lesson.json", "ana"));
    expect((await host.forgetLearner("ana", "en")).display_markdown).toContain("Learner: “ana”.");
    expect((await host.forgetLearner("nobody", "en")).display_markdown).toContain("Learner: “nobody”.");
  });
});

// D4 (waiting review 2026-11-25): the drafts Studium keeps after a refusal are learner data of the library.
// forgetLearner erases them, even on an install where no learner was ever recorded; forget(session),
// which erases one lesson, keeps them and says where they are.
describe("the drafts Studium kept after a refusal (D4)", () => {
  function keepDraft(library: string): void {
    mkdirSync(join(library, "_drafts"), { recursive: true });
    writeFileSync(join(library, "_drafts", "ss-1111111111111111.json"), "{}");
  }

  it("forgetLearner erases them with the rest, and says so", async () => {
    const { host, library, play } = await setup();
    await host.close(await play("atomes/lesson.json", "ana"));
    keepDraft(library);
    const report = await host.forgetLearner("ana", "en");
    expect(report.erased).toContainEqual({ kind: "lesson_drafts" });
    expect(report.kept.map((item) => item.kind)).not.toContain("lesson_drafts");
    expect(existsSync(join(library, "_drafts"))).toBe(false);
    expect(report.display_markdown).toContain("the drafts of unfinished lessons");
  });

  it("forgetLearner erases them on an install where no learner was ever recorded", async () => {
    const library = tmp();
    keepDraft(library);
    const host = new SessionHost({ bundlesRoot: library, libraryRoot: library, live: false, dataDir: tmp() });
    const report = await host.forgetLearner("ana", "fr");
    expect(report.erased).toEqual([{ kind: "lesson_drafts" }]);
    expect(existsSync(join(library, "_drafts"))).toBe(false);
    expect(report.display_markdown).toContain("les brouillons de leçons inachevées");
    expect(report.display_markdown).not.toMatch(/Rien à effacer/);
  });

  it("forget(session) keeps them, and says where they are", async () => {
    const { host, library, play } = await setup();
    const open = await play("atomes/lesson.json", "ana");
    keepDraft(library);
    const report = await host.forget(open, "en");
    expect(report.kept).toContainEqual({ kind: "lesson_drafts", path: join(library, "_drafts") });
    expect(existsSync(join(library, "_drafts"))).toBe(true);
    expect(report.display_markdown).toContain(join(library, "_drafts"));
  });
});

// Review of D4 (M1, M2): a kept draft is offered only to the learner it was refused for, after a lesson in
// progress, and forgetLearner erases that learner's drafts (and those kept for no known learner), never
// another learner's. The drafts replayed are the recorded OpenCode drafts of the authoring-draft fixture.
describe("drafts kept per learner (review of D4)", () => {
  const FIXTURE = fileURLToPath(new URL("authoring-draft/fixtures/photosynthese/", import.meta.url));
  const NOTES = readFileSync(join(FIXTURE, "notes.txt"), "utf8");
  const REJECTED = JSON.parse(readFileSync(join(FIXTURE, "create-1-rejected.json"), "utf8")) as { draft: Record<string, unknown> };
  const TITLE = "La photosynthèse : notes de cours (L1)";
  const later = () => Date.now() + 31 * 60_000;

  /** A draft refused for `learnerId` (none: no learner known) and kept in the library. */
  async function refusedFor(host: SessionHost, library: string, learnerId?: string, title = REJECTED.draft["title"]): Promise<string> {
    const set = await prepareSources(library, [{ title: TITLE, text: NOTES }], { goal: "comprendre la photosynthèse", language: "fr" });
    const result = await createLesson(library, { source_set_id: set.source_set_id, draft: { ...structuredClone(REJECTED.draft), title } },
      { learner: await host.draftLearnerOf(learnerId) });
    if (result.ok || !result.draft_id) throw new Error("expected a kept draft");
    return result.draft_id;
  }

  it("names no learner for a call without learner_id on a server with no STUDIUM_LEARNER_ID, and a pseudonym otherwise", async () => {
    const { host } = await setup();
    expect(await host.draftLearnerOf(undefined)).toBeNull();
    expect(await host.draftLearnerOf("anonymous")).toBeNull();
    expect(await host.draftLearnerOf("ana")).toMatch(/^[0-9a-f]{16}$/);
    expect(await host.draftLearnerOf("ana")).not.toBe(await host.draftLearnerOf("bob"));
    const configured = new SessionHost({ bundlesRoot: tmp(), live: false, dataDir: null, defaultLearnerId: "ana" });
    expect(await configured.draftLearnerOf(undefined)).toBe(await configured.draftLearnerOf("ana"));
  });

  it("keeps a lesson in progress as the next step, and the unfinished build under its own heading, for its learner only", async () => {
    const { host, library, play } = await setup();
    await host.close(await play("atomes/lesson.json", "ana"));
    const draftId = await refusedFor(host, library, "ana");
    const plan = await host.studyPlan("ana", { nowMs: later(), language: "fr" });
    expect(plan.next_step).toMatchObject({ action: "continue", arguments: { bundle_ref: "atomes/lesson.json" } });
    expect(plan.unfinished_build).toMatchObject({ draft_id: draftId });
    expect(plan.display_markdown).toContain("**Leçon inachevée**");
    for (const other of ["bob", undefined]) {
      const theirs = await host.studyPlan(other, { nowMs: later(), language: "fr" });
      expect(theirs.unfinished_build).toBeNull();
      expect(JSON.stringify(theirs)).not.toContain("photosynthèse");
    }
  });

  it("forgetLearner erases this learner's drafts and those kept for no learner, never another learner's", async () => {
    const { host, library, play } = await setup();
    await host.close(await play("atomes/lesson.json", "ana"));
    await refusedFor(host, library, "ana");
    const bob = await refusedFor(host, library, "bob", "La photosynthèse, version de Bob");
    await refusedFor(host, library, undefined, "La photosynthèse, sans apprenant");
    expect(readdirSync(join(library, "_drafts"))).toHaveLength(3);
    const report = await host.forgetLearner("ana", "en");
    expect(report.erased).toContainEqual({ kind: "lesson_drafts" });
    // Bob's draft is his: not named to Ana as kept, and still offered to him.
    expect(report.kept.map((item) => item.kind)).not.toContain("lesson_drafts");
    expect(readdirSync(join(library, "_drafts"))).toHaveLength(1);
    expect((await host.studyPlan("ana", { nowMs: later() })).unfinished_build).toBeNull();
    expect((await host.studyPlan("bob", { nowMs: later() })).unfinished_build).toMatchObject({ draft_id: bob });
    const bobReport = await host.forgetLearner("bob", "en");
    expect(bobReport.erased).toContainEqual({ kind: "lesson_drafts" });
    expect(existsSync(join(library, "_drafts"))).toBe(false);
    expect((await host.studyPlan("bob", { nowMs: later() })).unfinished_build).toBeNull();
  });
});
