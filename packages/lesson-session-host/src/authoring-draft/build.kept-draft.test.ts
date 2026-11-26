// packages/lesson-session-host/src/authoring-draft/build.kept-draft.test.ts
//
// D4 (waiting review 2026-11-25, owner's decision 3): Studium keeps a refused draft, and the assistant
// resends only the faulty scenes. The fixture replays the one refusal recorded in OpenCode (a schema
// error on scene 8, then the whole 9.7 KB draft sent again): fixtures/photosynthese holds the course
// notes the build read (written for these tests) and the two recorded create_lesson drafts, which
// differ only by `"markdown": ""` in scene 8. L1: a refusal reports the schema, quote and concept errors
// of every scene at once.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLesson, type CreateLessonResult } from "./build.js";
import { DRAFTS_DIR } from "./draft-store.js";
import { prepareSources, type SourceSet } from "./source-set.js";

const NOW = new Date("2026-11-25T12:00:00.000Z");
const FIXTURE = fileURLToPath(new URL("fixtures/photosynthese/", import.meta.url));
const fixture = (name: string): any => JSON.parse(readFileSync(join(FIXTURE, name), "utf8"));
const NOTES = readFileSync(join(FIXTURE, "notes.txt"), "utf8");
const PREPARE = fixture("prepare.json") as { goal: string; language: string; sources: Array<{ kind: "document"; title: string }> };
const REJECTED = fixture("create-1-rejected.json") as { course_id: string; draft: Record<string, any> };
const ACCEPTED = fixture("create-2-accepted.json") as { course_id: string; draft: Record<string, any> };

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function prepared(goal = PREPARE.goal): Promise<{ root: string; set: SourceSet }> {
  const root = mkdtempSync(join(tmpdir(), "kept-draft-"));
  roots.push(root);
  return { root, set: await prepareSources(root, [{ ...PREPARE.sources[0]!, text: NOTES }], { goal, language: PREPARE.language }) };
}

function refusal(result: CreateLessonResult) {
  if (result.ok) throw new Error("expected a refusal");
  return result;
}
function accepted(result: CreateLessonResult) {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
}
const keptFile = (root: string, set: SourceSet) => join(root, DRAFTS_DIR, `${set.source_set_id}.json`);
const clone = <T,>(value: T): T => structuredClone(value);

describe("createLesson keeps a refused draft (D4)", () => {
  it("replays the recorded refusal: the scene 8 error, a draft_id, and only scene 8 to resend", async () => {
    const { root, set } = await prepared();
    const result = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(REJECTED.draft), course_id: REJECTED.course_id }, { now: () => NOW }));
    expect(result.errors).toEqual([{ path: "scenes.8", message: "unknown field: markdown", hint: "remove it or fix its spelling" }]);
    expect(result.draft_id).toMatch(/^dr-[0-9a-f]{16}$/);
    expect(result.resend).toBe("scenes");
    expect(result.fix_scenes).toEqual([8]);
    expect(result.hint).toMatch(/draft_id/);
    expect(result.hint).toMatch(/only the scenes/);
    expect(existsSync(keptFile(root, set))).toBe(true);
    // Nothing is written unless the whole lesson passes.
    expect(existsSync(join(root, REJECTED.course_id))).toBe(false);
  });

  it("builds from the kept draft and one corrected scene a lesson.json byte-identical to the whole-draft build", async () => {
    const whole = await prepared();
    accepted(await createLesson(whole.root, { source_set_id: whole.set.source_set_id, draft: clone(ACCEPTED.draft), course_id: ACCEPTED.course_id }, { now: () => NOW }));

    const patched = await prepared();
    expect(patched.set.source_set_id).toBe(whole.set.source_set_id);
    const refused = refusal(await createLesson(patched.root, { source_set_id: patched.set.source_set_id, draft: clone(REJECTED.draft), course_id: REJECTED.course_id }, { now: () => NOW }));
    // The assistant sends scene 8 alone (about 1.4 KB instead of the 9.7 KB draft), keys in its own order.
    const scene = clone(ACCEPTED.draft["scenes"][8]) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(scene).reverse());
    const result = accepted(await createLesson(patched.root, {
      source_set_id: patched.set.source_set_id, draft_id: refused.draft_id!, scenes: [{ at: 8, ...reordered }],
    }, { now: () => NOW }));
    expect(result.course_ref).toBe("photosynthese/lesson.json");
    const bytes = (root: string) => readFileSync(join(root, "photosynthese", "lesson.json"));
    expect(bytes(patched.root).equals(bytes(whole.root))).toBe(true);
    // The write deletes the kept draft.
    expect(existsSync(keptFile(patched.root, patched.set))).toBe(false);
  });

  it("deletes the kept draft after any successful write on its source set, the whole draft included", async () => {
    const { root, set } = await prepared();
    refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(REJECTED.draft) }, { now: () => NOW }));
    expect(existsSync(keptFile(root, set))).toBe(true);
    accepted(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(ACCEPTED.draft) }, { now: () => NOW }));
    expect(existsSync(keptFile(root, set))).toBe(false);
  });

  it("keeps neither what the learner already knows nor their interests", async () => {
    const { root, set } = await prepared();
    const draft = { ...clone(REJECTED.draft), learner_profile: { prior: "Terminale S, spécialité SVT", interests: ["jardinage"], minutes_per_day: 20 } };
    refusal(await createLesson(root, { source_set_id: set.source_set_id, draft }, { now: () => NOW }));
    const kept = readFileSync(keptFile(root, set), "utf8");
    expect(kept).not.toContain("Terminale");
    expect(kept).not.toContain("jardinage");
    expect(JSON.parse(kept).draft.learner_profile).toEqual({ minutes_per_day: 20 });
  });

  it("stores nothing when the refusal is not about the draft: a lesson already there, an unknown source set, another folder's lesson", async () => {
    const { root, set } = await prepared();
    accepted(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(ACCEPTED.draft) }, { now: () => NOW }));
    const again = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(ACCEPTED.draft) }, { now: () => NOW }));
    expect(again.errors[0]).toMatchObject({ path: "course_id", message: expect.stringContaining("already exists") });
    expect(again).not.toHaveProperty("draft_id");
    // The refusal says what to send again: nothing was kept, so the whole draft.
    expect(again).toMatchObject({ resend: "draft", hint: expect.stringContaining("whole draft") });
    const unknown = refusal(await createLesson(root, { source_set_id: "ss-0000000000000000", draft: clone(REJECTED.draft) }, { now: () => NOW }));
    expect(unknown.errors[0]).toMatchObject({ path: "source_set_id" });
    const elsewhere = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(ACCEPTED.draft), course_id: "taken" },
      { now: () => NOW, servedElsewhere: (id) => id === "taken" }));
    expect(elsewhere.errors[0]).toMatchObject({ path: "course_id" });
    expect(existsSync(join(root, DRAFTS_DIR)) ? readdirSync(join(root, DRAFTS_DIR)) : []).toEqual([]);
  });

  it("keeps the kept draft as it was when a patch is refused for its course id, and says to send the same scenes again", async () => {
    const { root, set } = await prepared();
    const refused = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(REJECTED.draft), course_id: REJECTED.course_id }, { now: () => NOW }));
    const patch = { source_set_id: set.source_set_id, draft_id: refused.draft_id!, scenes: [{ at: 8, ...clone(ACCEPTED.draft["scenes"][8]) }] };
    const taken = refusal(await createLesson(root, patch, { now: () => NOW, servedElsewhere: (id) => id === REJECTED.course_id }));
    expect(taken.errors[0]).toMatchObject({ path: "course_id" });
    expect(taken).toMatchObject({ draft_id: refused.draft_id, resend: "scenes", fix_scenes: [8], hint: expect.stringContaining("same draft_id and scenes") });
    accepted(await createLesson(root, { ...patch, course_id: "photosynthese-2" }, { now: () => NOW }));
  });

  it("asks for the whole draft when an error is outside the scenes, and says so in the refusal", async () => {
    const { root, set } = await prepared();
    const draft = clone(REJECTED.draft);
    draft["concepts"][1]["prerequisites"] = ["c-absent"];
    const result = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft }, { now: () => NOW }));
    expect(result.errors.map((error) => error.path)).toEqual(expect.arrayContaining(["concepts.1.prerequisites.0", "scenes.8"]));
    expect(result.resend).toBe("draft");
    expect(result).not.toHaveProperty("draft_id");
    expect(result.hint).toMatch(/whole draft/);
    // Kept all the same: the study plan offers to finish it.
    expect(existsSync(keptFile(root, set))).toBe(true);
  });

  it("refuses draft and draft_id together, neither of them, and a draft_id that is not the kept draft's", async () => {
    const { root, set } = await prepared();
    const refused = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(REJECTED.draft) }, { now: () => NOW }));
    const scene = { at: 8, ...clone(ACCEPTED.draft["scenes"][8]) };
    const both = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(ACCEPTED.draft), draft_id: refused.draft_id!, scenes: [scene] }));
    expect(both.errors[0]).toMatchObject({ path: "draft_id", message: expect.stringContaining("not both") });
    const neither = refusal(await createLesson(root, { source_set_id: set.source_set_id }));
    expect(neither.errors[0]).toMatchObject({ path: "draft" });
    const stale = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft_id: "dr-0000000000000000", scenes: [scene] }));
    expect(stale.errors[0]).toMatchObject({ path: "draft_id", hint: expect.stringContaining(refused.draft_id!) });
    const outside = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft_id: refused.draft_id!, scenes: [{ ...scene, at: 9 }] }));
    expect(outside.errors[0]).toMatchObject({ path: "scenes.0.at" });
    // A refused patch leaves the kept draft as it was.
    expect(JSON.parse(readFileSync(keptFile(root, set), "utf8")).draft_id).toBe(refused.draft_id);
  });

  it("keeps the patched draft when the patch is still refused, with a new draft_id, its errors and the course id first given", async () => {
    const { root, set } = await prepared();
    const first = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(REJECTED.draft), course_id: REJECTED.course_id }, { now: () => NOW }));
    const scene = clone(ACCEPTED.draft["scenes"][8]);
    scene["quotes"] = [{ passage_id: scene["quotes"][0]["passage_id"], text: "La photosynthèse est un processus qui n'existe pas" }];
    const second = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft_id: first.draft_id!, scenes: [{ at: 8, ...scene }] }, { now: () => NOW }));
    expect(second.errors).toEqual([expect.objectContaining({ path: "scenes.8.quotes.0.text" })]);
    expect(second.draft_id).not.toBe(first.draft_id);
    expect(second.fix_scenes).toEqual([8]);
    const fixed = accepted(await createLesson(root, {
      source_set_id: set.source_set_id, draft_id: second.draft_id!, scenes: [{ at: 8, ...clone(ACCEPTED.draft["scenes"][8]) }],
    }, { now: () => NOW }));
    expect(fixed.course_ref).toBe("photosynthese/lesson.json");
  });

  it("takes the kept draft over a new preparation of the same sources, matched by their sha256", async () => {
    const { root, set } = await prepared();
    const refused = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(REJECTED.draft) }, { now: () => NOW }));
    // The learner comes back and the assistant prepares the same notes with a reworded goal: a new set.
    const again = await prepareSources(root, [{ ...PREPARE.sources[0]!, text: NOTES }], { goal: "Comprendre la photosynthèse", language: "fr" });
    expect(again.source_set_id).not.toBe(set.source_set_id);
    accepted(await createLesson(root, {
      source_set_id: again.source_set_id, draft_id: refused.draft_id!, scenes: [{ at: 8, ...clone(ACCEPTED.draft["scenes"][8]) }],
    }, { now: () => NOW }));
    expect(existsSync(keptFile(root, set))).toBe(false);
  });
});

describe("createLesson reports every scene's errors in one refusal (L1)", () => {
  it("returns a schema error of one scene and a wrong quote of another together", async () => {
    const { root, set } = await prepared();
    const draft = clone(REJECTED.draft); // scene 8 has an unknown field
    const quote = draft["scenes"][2]["quotes"][0];
    quote["text"] = "Le cycle de Calvin se déroule dans le noyau de la cellule";
    const result = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft }, { now: () => NOW }));
    expect(result.errors.map((error) => error.path).sort()).toEqual(["scenes.2.quotes.0.text", "scenes.8"]);
    expect(result.fix_scenes).toEqual([2, 8]);
  });
});

const ANA = "a1a1a1a1a1a1a1a1";
const BOB = "b0b0b0b0b0b0b0b0";
/** A kept draft file, as far as these tests read it. */
type KeptRecord = { draft_id: string; draft: { learner_profile?: unknown }; errors: Array<{ path: string }> };
const keptRecords = (root: string): KeptRecord[] => (existsSync(join(root, DRAFTS_DIR))
  ? readdirSync(join(root, DRAFTS_DIR)).map((name) => JSON.parse(readFileSync(join(root, DRAFTS_DIR, name), "utf8")) as KeptRecord)
  : []);

describe("what a kept draft holds of the learner (review of D4, minor 1)", () => {
  it("keeps of the learner profile only minutes_per_day and target_date, and no error about the profile", async () => {
    // Misspelled fields: the top level does not parse, the refusal names them, and their values stay out.
    const misspelled = await prepared();
    const first = refusal(await createLesson(misspelled.root, { source_set_id: misspelled.set.source_set_id, draft: {
      ...clone(REJECTED.draft),
      learner_profile: { prior_knowledge: "SECRET-PRIOR infirmière diabétique", interest: ["SECRET-INTEREST"], minutes_per_day: 20, target_date: "2026-12-20" },
    } }, { now: () => NOW, learner: ANA }));
    expect(first.errors.map((error) => error.path)).toContain("learner_profile");
    // prior with a placeholder: the refusal quotes it to the assistant; the kept draft and its errors do not.
    const placeholder = await prepared();
    const second = refusal(await createLesson(placeholder.root, { source_set_id: placeholder.set.source_set_id, draft: {
      ...clone(REJECTED.draft), learner_profile: { prior: "TODO SECRET-PLACEHOLDER-PRIOR", interests: ["SECRET-INTEREST"], minutes_per_day: 20 },
    } }, { now: () => NOW, learner: ANA }));
    expect(second.errors).toContainEqual(expect.objectContaining({ path: "learner_profile.prior", message: expect.stringContaining("SECRET-PLACEHOLDER-PRIOR") }));
    const [kept1, kept2] = [keptRecords(misspelled.root), keptRecords(placeholder.root)];
    expect([kept1.length, kept2.length]).toEqual([1, 1]);
    const records = [...kept1, ...kept2];
    expect(JSON.stringify(records)).not.toContain("SECRET");
    expect(JSON.stringify(records)).not.toContain("infirmière");
    expect(records.map((record) => record["draft"]["learner_profile"])).toEqual([{ minutes_per_day: 20, target_date: "2026-12-20" }, { minutes_per_day: 20 }]);
    for (const record of records) {
      expect(record["errors"].filter((error: { path: string }) => error.path.startsWith("learner_profile"))).toEqual([]);
      expect(record["errors"]).toContainEqual(expect.objectContaining({ path: "scenes.8" }));
    }
  });
});

describe("createLesson runs one call at a time per library (review of D4, minor 2)", () => {
  it("never leaves a refused draft beside a lesson written by a call made at the same time, in either order", async () => {
    for (let trial = 0; trial < 12; trial += 1) {
      const { root, set } = await prepared();
      const good = () => createLesson(root, { source_set_id: set.source_set_id, draft: clone(ACCEPTED.draft) }, { learner: ANA });
      const bad = () => createLesson(root, { source_set_id: set.source_set_id, draft: clone(REJECTED.draft) }, { learner: ANA });
      const [a, b] = trial % 2 === 0 ? await Promise.all([good(), bad()]) : await Promise.all([bad(), good()]);
      const [written, refused] = trial % 2 === 0 ? [a, b] : [b, a];
      expect(written.ok).toBe(true);
      expect(refused.ok).toBe(false);
      expect({ trial, kept: keptRecords(root).length }).toEqual({ trial, kept: 0 });
      // A refusal that came while the lesson was being written keeps nothing, so it offers no draft_id.
      if (trial % 2 === 0) expect({ trial, draft_id: refused.ok ? null : refused.draft_id }).toEqual({ trial, draft_id: undefined });
    }
  });

  it("lets only one of two patches of the same kept draft sent at the same time write the lesson", async () => {
    const { root, set } = await prepared();
    const kept = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(REJECTED.draft) }, { learner: ANA }));
    const patch = { source_set_id: set.source_set_id, draft_id: kept.draft_id!, scenes: [{ at: 8, ...clone(ACCEPTED.draft["scenes"][8]) }] };
    const results = await Promise.all([createLesson(root, patch, { learner: ANA }), createLesson(root, patch, { learner: ANA })]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const other = refusal(results.find((result) => !result.ok)!);
    expect(other.errors[0]).toMatchObject({ path: "draft_id" });
    expect(keptRecords(root)).toEqual([]);
  });
});

describe("a resend takes only a draft kept to be fixed scene by scene (review of D4, minor 4)", () => {
  it("refuses the id of a draft kept for a whole resend, and never names a draft_id a refusal withheld", async () => {
    const { root, set } = await prepared();
    const draft = clone(REJECTED.draft);
    draft["concepts"][1]["prerequisites"] = ["c-absent"];
    const whole = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft }, { now: () => NOW, learner: ANA }));
    expect(whole).toMatchObject({ resend: "draft" });
    expect(whole).not.toHaveProperty("draft_id");
    const [record] = keptRecords(root);
    const withheld = String(record!["draft_id"]);
    const scenes = [{ at: 8, ...clone(ACCEPTED.draft["scenes"][8]) }];
    const patched = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft_id: withheld, scenes }, { now: () => NOW, learner: ANA }));
    expect(patched.errors[0]).toMatchObject({ path: "draft_id" });
    expect(patched.errors[0]!.hint).not.toContain(withheld);
    const stale = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft_id: "dr-0000000000000000", scenes }, { now: () => NOW, learner: ANA }));
    expect(JSON.stringify(stale)).not.toContain(withheld);
    expect(stale.errors[0]!.hint).toMatch(/whole draft/);
  });

  it("names in its hint only a draft kept for the same learner", async () => {
    const { root, set } = await prepared();
    const ana = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft: clone(REJECTED.draft) }, { now: () => NOW, learner: ANA }));
    const scenes = [{ at: 8, ...clone(ACCEPTED.draft["scenes"][8]) }];
    const forBob = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft_id: "dr-0000000000000000", scenes }, { now: () => NOW, learner: BOB }));
    expect(JSON.stringify(forBob)).not.toContain(ana.draft_id!);
    const forNobody = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft_id: "dr-0000000000000000", scenes }, { now: () => NOW }));
    expect(JSON.stringify(forNobody)).not.toContain(ana.draft_id!);
    const forAna = refusal(await createLesson(root, { source_set_id: set.source_set_id, draft_id: "dr-0000000000000000", scenes }, { now: () => NOW, learner: ANA }));
    expect(forAna.errors[0]!.hint).toContain(ana.draft_id!);
  });
});
