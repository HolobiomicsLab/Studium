// packages/lesson-session-host/src/authoring-draft/draft-store.test.ts
//
// D4 (waiting review 2026-11-25): an unfinished build is offered again, and only while it is useful. A
// build is unfinished when its sources were prepared, or its draft refused and kept, and no lesson was
// written from those sources since: matched by the sources' sha256, because every new preparation of
// the same file makes a new source set. It is not offered while it may still be running (30 minutes),
// nor after 14 days, nor once the learner said they do not want it.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLesson, type CreateLessonResult } from "./build.js";
import { BUILD_GRACE_MINUTES, discardBuild, DRAFTS_DIR, eraseDrafts, UNFINISHED_BUILD_DAYS, unfinishedBuilds } from "./draft-store.js";
import { prepareSources } from "./source-set.js";

const MINUTE = 60_000;
const DAY = 86_400_000;
const FIXTURE = fileURLToPath(new URL("fixtures/photosynthese/", import.meta.url));
const fixture = (name: string): any => JSON.parse(readFileSync(join(FIXTURE, name), "utf8"));
const NOTES = readFileSync(join(FIXTURE, "notes.txt"), "utf8");
const PREPARE = fixture("prepare.json") as { goal: string; language: string; sources: Array<{ kind: "document"; title: string }> };
const REJECTED = fixture("create-1-rejected.json") as { course_id: string; draft: Record<string, any> };
const ACCEPTED = fixture("create-2-accepted.json") as { course_id: string; draft: Record<string, any> };

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
    prepareSources(library, [{ path: notes, title: PREPARE.sources[0]!.title }], { goal, language: PREPARE.language, files });
  return { library, notes, files, prepare };
}
const later = (minutes = BUILD_GRACE_MINUTES + 1) => Date.now() + minutes * MINUTE;
function refusal(result: CreateLessonResult) {
  if (result.ok) throw new Error("expected a refusal");
  return result;
}

describe("unfinishedBuilds", () => {
  it("lists a refused draft once the build can no longer be running: its draft_id, scenes to fix, a keyless outline, how to prepare it again", async () => {
    const { library, notes, files, prepare } = setup();
    const set = await prepare();
    const refused = refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }));
    expect(await unfinishedBuilds(library, Date.now())).toEqual([]); // the assistant may be fixing it now
    const [build, ...rest] = await unfinishedBuilds(library, later());
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

  it("lists sources prepared with no lesson built from them: a build that stopped before its draft reached Studium", async () => {
    const { library, prepare } = setup();
    const set = await prepare();
    expect(await unfinishedBuilds(library, later())).toEqual([expect.objectContaining({
      source_set_id: set.source_set_id, draft_id: null, resend: null, fix_scenes: [], outline: null,
    })]);
  });

  it("forgets the build once a lesson is written from the same sources, even from another preparation of them", async () => {
    const { library, prepare } = setup();
    const first = await prepare();
    refusal(await createLesson(library, { source_set_id: first.source_set_id, draft: structuredClone(REJECTED.draft) }));
    const second = await prepare("Comprendre la photosynthèse");
    expect(second.source_set_id).not.toBe(first.source_set_id);
    expect((await createLesson(library, { source_set_id: second.source_set_id, draft: structuredClone(ACCEPTED.draft) })).ok).toBe(true);
    expect(await unfinishedBuilds(library, later())).toEqual([]);
    expect(existsSync(join(library, DRAFTS_DIR, `${first.source_set_id}.json`))).toBe(false);
  });

  it("lists the same sources once, from their latest preparation", async () => {
    const { library, prepare } = setup();
    await prepare();
    const second = await prepare("Comprendre la photosynthèse");
    expect((await unfinishedBuilds(library, later())).map((build) => build.source_set_id)).toEqual([second.source_set_id]);
  });

  it("stops offering a build after its expiry, and once the learner discards it, until the sources are prepared again", async () => {
    const { library, prepare } = setup();
    const set = await prepare();
    refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }));
    expect(await unfinishedBuilds(library, Date.now() + (UNFINISHED_BUILD_DAYS * DAY) + MINUTE)).toEqual([]);
    await discardBuild(library, set.source_set_id, new Date());
    expect(await unfinishedBuilds(library, later())).toEqual([]);
    // The kept draft is gone with it.
    expect(readFileSync(join(library, DRAFTS_DIR, `${set.source_set_id}.json`), "utf8")).not.toContain("draft_id");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await prepare("Comprendre la photosynthèse");
    expect((await unfinishedBuilds(library, later())).map((build) => build.source_set_id)).toEqual([again.source_set_id]);
  });

  it("refuses to discard an unknown source set, in the {path, message, hint} shape", async () => {
    const { library } = setup();
    await expect(discardBuild(library, "ss-0000000000000000", new Date())).rejects.toMatchObject({ issues: [expect.objectContaining({ path: "source_set_id" })] });
  });

  it("ignores what it cannot read, and a library with no source set", async () => {
    const library = folder("drafts-empty-");
    expect(await unfinishedBuilds(library, later())).toEqual([]);
    expect(await unfinishedBuilds(join(library, "absent"), later())).toEqual([]);
    const { library: other, prepare } = setup();
    await prepare();
    writeFileSync(join(other, "_sources", "ss-1.json"), "{}");
    writeFileSync(join(other, "_sources", "ss-ffffffffffffffff.json"), "{ not json");
    expect(await unfinishedBuilds(other, later())).toHaveLength(1);
  });

  it("erases every kept draft, and says whether there was any", async () => {
    const { library, prepare } = setup();
    const set = await prepare();
    expect(await eraseDrafts(library)).toBe(false);
    refusal(await createLesson(library, { source_set_id: set.source_set_id, draft: structuredClone(REJECTED.draft) }));
    expect(await eraseDrafts(library)).toBe(true);
    expect(existsSync(join(library, DRAFTS_DIR))).toBe(false);
  });
});
