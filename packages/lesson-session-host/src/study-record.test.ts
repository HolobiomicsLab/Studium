// packages/lesson-session-host/src/study-record.test.ts
//
// The study record (HJ-1, HJ-5): where each concept was last graded and how far each lesson got,
// kept next to the learner's profile under the same pseudonym, read fail-safe, erased with it.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyStudyRecord, FileStudyRecordStore, InMemoryStudyRecordStore, type StudyRecord } from "./study-record.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const RECORD: StudyRecord = {
  ...emptyStudyRecord(),
  concepts: { c: { bundle_ref: "a/lesson.json", bundle_id: "a", scene_id: "s", lesson_title: "A" } },
  lessons: { a: { bundle_ref: "a/lesson.json", bundle_id: "a", title: "A", language: "fr", scenes_completed: 1,
    total_scenes: 2, completed: false, updated_at: "2026-11-02T09:00:00Z" } },
};

describe("FileStudyRecordStore", () => {
  it("round-trips <dataDir>/<pseudonym>/study.json, reads garbage as absent, and deletes it", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "study-record-")); dirs.push(dataDir);
    const store = new FileStudyRecordStore(dataDir);
    expect(await store.load("0123abcd")).toBeNull();
    await store.save("0123abcd", RECORD);
    expect(JSON.parse(readFileSync(join(dataDir, "0123abcd", "study.json"), "utf8"))).toEqual(RECORD);
    expect(await store.load("0123abcd")).toEqual(RECORD);

    mkdirSync(join(dataDir, "badbad"));
    writeFileSync(join(dataDir, "badbad", "study.json"), "{ not json");
    expect(await store.load("badbad")).toBeNull();
    writeFileSync(join(dataDir, "badbad", "study.json"), JSON.stringify({ schema: "other/1" }));
    expect(await store.load("badbad")).toBeNull();

    await store.delete("0123abcd");
    expect(existsSync(join(dataDir, "0123abcd", "study.json"))).toBe(false);
  });

  it("keeps a pseudonym to one path segment", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "study-record-")); dirs.push(dataDir);
    await new FileStudyRecordStore(dataDir).save("../escape", RECORD);
    expect(existsSync(join(dataDir, ".._escape", "study.json"))).toBe(true);
  });
});

describe("InMemoryStudyRecordStore", () => {
  it("hands out copies, so a caller's edit is not saved by accident", async () => {
    const store = new InMemoryStudyRecordStore();
    await store.save("p", RECORD);
    const loaded = (await store.load("p"))!;
    loaded.concepts["x"] = RECORD.concepts["c"]!;
    expect(Object.keys((await store.load("p"))!.concepts)).toEqual(["c"]);
    await store.delete("p");
    expect(await store.load("p")).toBeNull();
  });
});
