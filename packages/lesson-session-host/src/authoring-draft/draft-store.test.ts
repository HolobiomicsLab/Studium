// packages/lesson-session-host/src/authoring-draft/draft-store.test.ts
//
// D4 (waiting review 2026-11-25): an unfinished build is offered again, and only while it is useful. After
// the review of D4 (M1, M2), an unfinished build is a kept draft: a draft Studium refused, not followed by
// a lesson written for the same learner. Sources prepared with no draft are never offered (the server
// cannot tell an abandoned build from one still running or already done). A kept draft is offered only to
// the learner it was refused for, not while the build may still be running (30 minutes), not after 14
// days (an expired record is removed when it is read), and not once the learner discarded it.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLesson, type CreateLessonResult } from "./build.js";
import {
  BUILD_GRACE_MINUTES, discardBuild, DRAFTS_DIR, eraseDrafts, eraseLearnerDrafts, UNFINISHED_BUILD_DAYS, unfinishedBuilds,
} from "./draft-store.js";
import { prepareSources } from "./source-set.js";

const MINUTE = 60_000;
const DAY = 86_400_000;
const FIXTURE = fileURLToPath(new URL("fixtures/photosynthese/", import.meta.url));
const fixture = (name: string): any => JSON.parse(readFileSync(join(FIXTURE, name), "utf8"));
const NOTES = readFileSync(join(FIXTURE, "notes.txt"), "utf8");
const PREPARE = fixture("prepare.json") as { goal: string; language: string; sources: Array<{ kind: "document"; title: string }> };
const REJECTED = fixture("create-1-rejected.json") as { course_id: string; draft: Record<string, any> };
const ACCEPTED = fixture("create-2-accepted.json") as { course_id: string; draft: Record<string, any> };
/** The learners' pseudonyms, as SessionHost.draftLearnerOf gives them. */
const ANA = "a1a1a1a1a1a1a1a1";
const BOB = "b0b0b0b0b0b0b0b0";
const forAna = { learner: ANA };
const TITLE = PREPARE.sources[0]!.title;

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function folder(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

/** A library, and the learner's notes as a file Studium reads by path. */
function setup() {
  const library = folder("drafts-library-");
  const home = folder("drafts-learner-");
  const notes = join(home, "photosynthese.md");
  writeFileSync(notes, NOTES, "utf8");
  const files = { base: home, refusedRoots: [library] };
  const prepare = (goal = PREPARE.goal) =>
    prepareSources(library, [{ path: notes, title: TITLE }], { goal, language: PREPARE.language, files });
  return { library, notes, files, prepare };
}
const later = (minutes = BUILD_GRACE_MINUTES + 1) => Date.now() + minutes * MINUTE;
function refusal(result: CreateLessonResult) {
  if (result.ok) throw new Error("expected a refusal");
  return result;
}
const keptFiles = (library: string) => (existsSync(join(library, DRAFTS_DIR)) ? readdirSync(join(library, DRAFTS_DIR)) : []);

describe("unfinishedBuilds", () => {
  // Changed (review of D4, M1 and M2): a kept draft records the learner it was refused for and is offered only
  // to them, so createLesson and unfinishedBuilds name the learner; every assertion is as it was.
  it("lists a refused draft once the build can no longer be running: its draft_id, scenes to fix, a keyless outline, how to prepare it again", async () => {
    const { library, notes, files, prepare } = setup();
    const set = await prepare();
    const refused = refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    expect(await unfinishedBuilds(library, Date.now(), ANA)).toEqual([]); // the assistant may be fixing it now
    const [build, ...rest] = await unfinishedBuilds(library, later(), ANA);
    expect(rest).toEqual([]);
    expect(build).toMatchObject({
      source_set_id: set.source_set_id, draft_id: refused.draft_id, resend: "scenes", fix_scenes: [8],
      sources: ["La photosynthèse : notes de cours (L1)"],
      prepare_sources: { sources: [{ path: notes, title: "La photosynthèse : notes de cours (L1)" }], goal: PREPARE.goal, language: "fr" },
    });
    expect(build!.outline).toMatchObject({ title: REJECTED.draft["title"] });
    expect(build!.outline!.scenes[8]).toEqual({ at: 8, type: "explain_back", title: REJECTED.draft["scenes"][8]["title"], concepts: ["c-phase-photochimique", "c-cycle-calvin"] });
    // The outline is keyless: no choice, key point, cue or model answer of the kept draft.
    const shown = JSON.stringify(build);
    for (const key of ["correct", "key_points", "cues", "model_explanation", "feedback_correct"]) expect(shown).not.toContain(key);
    // The arguments given prepare the same source set again, so the kept draft matches as it is.
    const again = await prepareSources(library, build!.prepare_sources!.sources as never, {
      goal: build!.prepare_sources!.goal, language: build!.prepare_sources!.language, files,
    });
    expect(again.source_set_id).toBe(set.source_set_id);
  });

  // Changed (review of D4, M1 and M2): sources prepared with no draft kept are no longer offered. This test
  // asserted the opposite; the server cannot tell such a build from one still running or already done.
  it("does not list sources prepared with no draft kept", async () => {
    const { library, prepare } = setup();
    await prepare();
    expect(await unfinishedBuilds(library, later(), ANA)).toEqual([]);
    expect(await unfinishedBuilds(library, later(), null)).toEqual([]);
  });

  it("offers nothing in the reviewer's three cases (M1): a superset prepared, a page fetched again, a lesson deleted", async () => {
    const other = { title: "Autre", text: "Un autre texte assez long pour faire un passage. ".repeat(10) };
    const options = { goal: PREPARE.goal, language: "fr" };
    // A superset of the sources prepared, then the lesson written from the subset.
    const superset = setup();
    await prepareSources(superset.library, [{ title: TITLE, text: NOTES }, other], options);
    const subset = await prepareSources(superset.library, [{ title: TITLE, text: NOTES }], options);
    expect((await createLesson(superset.library, { source_set_id: subset.source_set_id, draft: structuredClone(ACCEPTED.draft) }, forAna)).ok).toBe(true);
    expect(await unfinishedBuilds(superset.library, later(), ANA)).toEqual([]);
    // The page fetched again, one line longer, then the lesson written from the first text.
    const refetched = setup();
    await prepareSources(refetched.library, [{ title: TITLE, text: `${NOTES}\nMis à jour le 24/11.` }], options);
    const first = await prepareSources(refetched.library, [{ title: TITLE, text: NOTES }], options);
    expect((await createLesson(refetched.library, { source_set_id: first.source_set_id, draft: structuredClone(ACCEPTED.draft) }, forAna)).ok).toBe(true);
    expect(await unfinishedBuilds(refetched.library, later(), ANA)).toEqual([]);
    // A lesson written, then deleted by the learner.
    const deleted = setup();
    const set = await prepareSources(deleted.library, [{ title: TITLE, text: NOTES }], options);
    const written = await createLesson(deleted.library, { source_set_id: set.source_set_id, draft: structuredClone(ACCEPTED.draft) }, forAna);
    if (!written.ok) throw new Error("expected a lesson");
    rmSync(join(deleted.library, written.course_id), { recursive: true });
    expect(await unfinishedBuilds(deleted.library, later(), ANA)).toEqual([]);
  });

  it("forgets the build once a lesson is written from the same sources, even from another preparation of them", async () => {
    const { library, prepare } = setup();
    const first = await prepare();
    refusal(await createLesson(library, { source_set_id: first.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    const second = await prepare("Comprendre la photosynthèse");
    expect(second.source_set_id).not.toBe(first.source_set_id);
    expect((await createLesson(library, { source_set_id: second.source_set_id, draft: structuredClone(ACCEPTED.draft) }, forAna)).ok).toBe(true);
    expect(await unfinishedBuilds(library, later(), ANA)).toEqual([]);
    expect(keptFiles(library)).toEqual([]);
  });

  it("ends every build of the learner left unfinished before a lesson is written for them: a superset, a page fetched again", async () => {
    const options = { goal: PREPARE.goal, language: "fr" };
    const { library } = setup();
    const superset = await prepareSources(library, [{ title: TITLE, text: NOTES }, { title: "Autre", text: "Un autre texte assez long pour faire un passage. ".repeat(10) }], options);
    refusal(await createLesson(library, { source_set_id: superset.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    const refetched = await prepareSources(library, [{ title: TITLE, text: `${NOTES}\nMis à jour le 24/11.` }], options);
    refusal(await createLesson(library, { source_set_id: refetched.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    expect(await unfinishedBuilds(library, later(), ANA)).toHaveLength(2);
    const subset = await prepareSources(library, [{ title: TITLE, text: NOTES }], options);
    expect((await createLesson(library, { source_set_id: subset.source_set_id, draft: structuredClone(ACCEPTED.draft) }, forAna)).ok).toBe(true);
    expect(await unfinishedBuilds(library, later(), ANA)).toEqual([]);
    expect(keptFiles(library)).toEqual([]);
  });

  // Changed (review of D4, M1): this test listed the latest of two preparations with nothing kept, which are
  // no longer offered; it now refuses a draft on each preparation, and the learner is offered the latest once.
  it("lists the same sources once, from their latest preparation", async () => {
    const { library, prepare } = setup();
    const first = await prepare();
    refusal(await createLesson(library, { source_set_id: first.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    const second = await prepare("Comprendre la photosynthèse");
    refusal(await createLesson(library, { source_set_id: second.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    expect((await unfinishedBuilds(library, later(), ANA)).map((build) => build.source_set_id)).toEqual([second.source_set_id]);
  });

  it("offers a kept draft only to the learner it was refused for, and one refused for no known learner to nobody", async () => {
    const { library, prepare } = setup();
    const set = await prepare();
    const ana = refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    expect((await unfinishedBuilds(library, later(), ANA)).map((build) => build.draft_id)).toEqual([ana.draft_id]);
    expect(await unfinishedBuilds(library, later(), BOB)).toEqual([]);
    expect(await unfinishedBuilds(library, later(), null)).toEqual([]);
    // Bob builds from the same file on the same computer: his refusal does not replace Ana's draft...
    const draft = structuredClone(REJECTED.draft);
    draft["title"] = "La photosynthèse, version de Bob";
    const bob = refusal(await createLesson(library, { source_set_id: set.source_set_id, draft }, { learner: BOB }));
    expect(bob.draft_id).not.toBe(ana.draft_id);
    expect((await unfinishedBuilds(library, later(), ANA)).map((build) => build.draft_id)).toEqual([ana.draft_id]);
    expect((await unfinishedBuilds(library, later(), BOB)).map((build) => build.draft_id)).toEqual([bob.draft_id]);
    // ...and his lesson, once written, ends his build, not hers.
    expect((await createLesson(library, {
      source_set_id: set.source_set_id, draft_id: bob.draft_id!, scenes: [{ at: 8, ...structuredClone(ACCEPTED.draft["scenes"][8]) }], course_id: "photosynthese-bob",
    }, { learner: BOB })).ok).toBe(true);
    expect(await unfinishedBuilds(library, later(), BOB)).toEqual([]);
    expect((await unfinishedBuilds(library, later(), ANA)).map((build) => build.draft_id)).toEqual([ana.draft_id]);
    // A draft refused with no learner known is kept for the resend in the same conversation, offered to no one.
    const unnamed = { ...structuredClone(REJECTED.draft), title: "La photosynthèse, sans apprenant" };
    const nobody = refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: unnamed, course_id: "anonyme" }));
    expect(nobody.draft_id).toMatch(/^dr-/);
    expect(nobody.draft_id).not.toBe(ana.draft_id);
    for (const learner of [null, ANA, BOB]) expect((await unfinishedBuilds(library, later(), learner)).map((build) => build.draft_id)).not.toContain(nobody.draft_id);
  });

  it("removes a record past its expiry when it reads it (review of D4, minor 3)", async () => {
    const { library, prepare } = setup();
    const set = await prepare();
    refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    expect(keptFiles(library)).toHaveLength(1);
    expect(await unfinishedBuilds(library, Date.now() + UNFINISHED_BUILD_DAYS * DAY + MINUTE, ANA)).toEqual([]);
    expect(keptFiles(library)).toEqual([]);
    // The same when the resend reads it: an expired draft_id is no draft.
    const kept = refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    const expired = new Date(Date.now() + UNFINISHED_BUILD_DAYS * DAY + MINUTE);
    const resent = refusal(await createLesson(library, {
      source_set_id: set.source_set_id, draft_id: kept.draft_id!, scenes: [{ at: 8, ...structuredClone(ACCEPTED.draft["scenes"][8]) }],
    }, { ...forAna, now: () => expired }));
    expect(resent.errors[0]).toMatchObject({ path: "draft_id" });
    expect(keptFiles(library)).toEqual([]);
  });

  // Changed (review of D4, M1): discarding drops the kept draft and keeps no record of its own, since sources
  // prepared with nothing kept are no longer offered; this test asserted that preparing again offered them.
  it("stops offering a build after its expiry, and once the learner discards it; a new refusal is offered again", async () => {
    const { library, prepare } = setup();
    const set = await prepare();
    refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    expect(await unfinishedBuilds(library, later(), ANA)).toHaveLength(1);
    await discardBuild(library, set.source_set_id, new Date(), ANA);
    expect(await unfinishedBuilds(library, later(), ANA)).toEqual([]);
    // The kept draft is gone with it.
    expect(keptFiles(library)).toEqual([]);
    const again = await prepare("Comprendre la photosynthèse");
    expect(await unfinishedBuilds(library, later(), ANA)).toEqual([]);
    refusal(await createLesson(library, { source_set_id: again.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    expect((await unfinishedBuilds(library, later(), ANA)).map((build) => build.source_set_id)).toEqual([again.source_set_id]);
  });

  it("discards only the learner's own draft", async () => {
    const { library, prepare } = setup();
    const set = await prepare();
    refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    await discardBuild(library, set.source_set_id, new Date(), BOB);
    await discardBuild(library, set.source_set_id, new Date(), null);
    expect(await unfinishedBuilds(library, later(), ANA)).toHaveLength(1);
  });

  it("refuses to discard an unknown source set, in the {path, message, hint} shape", async () => {
    const { library } = setup();
    await expect(discardBuild(library, "ss-0000000000000000", new Date(), ANA)).rejects.toMatchObject({ issues: [expect.objectContaining({ path: "source_set_id" })] });
  });

  // Changed (review of D4, M1): a prepared source set is no longer offered, so what this test checks is
  // that unreadable drafts and source sets are skipped, with nothing offered.
  it("ignores what it cannot read, and a library with no source set", async () => {
    const library = folder("drafts-empty-");
    expect(await unfinishedBuilds(library, later(), ANA)).toEqual([]);
    expect(await unfinishedBuilds(join(library, "absent"), later(), ANA)).toEqual([]);
    const { library: other, prepare } = setup();
    const set = await prepare();
    refusal(await createLesson(other, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    writeFileSync(join(other, "_sources", "ss-1.json"), "{}");
    writeFileSync(join(other, "_sources", "ss-ffffffffffffffff.json"), "{ not json");
    writeFileSync(join(other, DRAFTS_DIR, "ss-eeeeeeeeeeeeeeee.json"), "{ not json");
    writeFileSync(join(other, DRAFTS_DIR, "notes.txt"), "not a record");
    expect(await unfinishedBuilds(other, later(), ANA)).toHaveLength(1);
  });

  it("erases every kept draft, and says whether there was any", async () => {
    const { library, prepare } = setup();
    const set = await prepare();
    expect(await eraseDrafts(library)).toBe(false);
    refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }));
    expect(await eraseDrafts(library)).toBe(true);
    expect(existsSync(join(library, DRAFTS_DIR))).toBe(false);
  });

  it("erases a learner's drafts, those kept for no learner and unreadable ones, and leaves the other learners' (forgetLearner)", async () => {
    const { library, prepare } = setup();
    const set = await prepare();
    expect(await eraseLearnerDrafts(library, ANA)).toBe(false);
    refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }, forAna));
    const draft = structuredClone(REJECTED.draft);
    draft["title"] = "La photosynthèse, version de Bob";
    const bob = refusal(await createLesson(library, { source_set_id: set.source_set_id, draft }, { learner: BOB }));
    refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft), course_id: "anonyme" }));
    writeFileSync(join(library, DRAFTS_DIR, "ss-eeeeeeeeeeeeeeee.json"), "{ not json");
    expect(keptFiles(library)).toHaveLength(4);
    expect(await eraseLearnerDrafts(library, ANA)).toBe(true);
    expect(await unfinishedBuilds(library, later(), ANA)).toEqual([]);
    expect((await unfinishedBuilds(library, later(), BOB)).map((build) => build.draft_id)).toEqual([bob.draft_id]);
    expect(keptFiles(library)).toHaveLength(1);
    expect(await eraseLearnerDrafts(library, BOB)).toBe(true);
    expect(existsSync(join(library, DRAFTS_DIR))).toBe(false);
  });
});
