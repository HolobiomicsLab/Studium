// packages/lesson-session-host/src/learner-store.atomic.test.ts
//
// L-11 (CC-1): profile.json and study.json are written whole or not at all. A write that dies half-way
// (a full disk, a killed process) used to leave a truncated file, which the next load read as « no
// profile » and the next answer replaced with an empty one: the learner's completed lessons and memory
// were gone. The crash is simulated: under the armed folder, a write lands half its bytes, then fails.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLearnerProfile, type LearnerProfile } from "@studium/learner-state";

const crash: { dir: string | null } = { dir: null };

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const writeFile = (async (path: Parameters<typeof fs.writeFile>[0], data: string, options?: Parameters<typeof fs.writeFile>[2]) => {
    if (crash.dir && typeof path === "string" && path.startsWith(crash.dir)) {
      await fs.writeFile(path, data.slice(0, Math.floor(data.length / 2)), options);
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    }
    return fs.writeFile(path, data, options);
  }) as typeof fs.writeFile;
  return { ...fs, default: { ...fs, writeFile }, writeFile };
});

const { FileLearnerProfileStore } = await import("./learner-profile-store.js");
const { FileStudyRecordStore, emptyStudyRecord } = await import("./study-record.js");

const dirs: string[] = [];
afterEach(() => {
  crash.dir = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "atomic-store-")); dirs.push(d); return d; }

const PSEUDONYM = "0123456789abcdef";
const leftovers = (dir: string) => readdirSync(join(dir, PSEUDONYM)).filter((name) => !["profile.json", "study.json"].includes(name));

describe("L-11 — atomic learner files", () => {
  it("a profile write that dies half-way leaves the stored profile readable, and no temporary file", async () => {
    const data = tmp();
    const store = new FileLearnerProfileStore(data);
    const first: LearnerProfile = { ...defaultLearnerProfile(PSEUDONYM, "2026-10-30T10:00:00.000Z"), completed_lessons: ["lesson-a"] };
    await store.save(first);
    crash.dir = data;
    const second: LearnerProfile = { ...first, completed_lessons: ["lesson-a", "lesson-b"], updated_at: "2026-10-30T11:00:00.000Z" };
    await expect(store.save(second)).rejects.toThrow(/ENOSPC/);
    crash.dir = null;
    const loaded = await store.load(PSEUDONYM);
    expect([first, second]).toContainEqual(loaded);
    expect(leftovers(data)).toEqual([]);
  });

  it("a study-record write that dies half-way leaves the stored record readable, and no temporary file", async () => {
    const data = tmp();
    const store = new FileStudyRecordStore(data);
    const first = { ...emptyStudyRecord(), minutes_per_day: 20 };
    await store.save(PSEUDONYM, first);
    crash.dir = data;
    await expect(store.save(PSEUDONYM, { ...first, minutes_per_day: 30 })).rejects.toThrow(/ENOSPC/);
    crash.dir = null;
    const loaded = await store.load(PSEUDONYM);
    expect([20, 30]).toContain(loaded?.minutes_per_day);
    expect(leftovers(data)).toEqual([]);
  });
});
