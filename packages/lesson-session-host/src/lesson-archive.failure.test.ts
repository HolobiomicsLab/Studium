// packages/lesson-session-host/src/lesson-archive.failure.test.ts
//
// Review 2026-11-27, items 5 and 9: a file-system failure after the checks. node:fs/promises rename is made to fail on
// demand, so the install's two renames (the new folder into place, the old folder back) can be broken one at a time.
// A failure says « nothing was changed » only when it is true; when the old lesson cannot be put back, it is never
// deleted and the error names where it is.
import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";

const hooks = vi.hoisted(() => ({
  fail: undefined as undefined | ((from: string, to: string) => boolean),
  failRm: undefined as undefined | ((path: string) => boolean),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (hooks.fail?.(String(from), String(to))) {
        const error = new Error("EACCES: permission denied, rename '" + from + "' -> '" + to + "'") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return real.rename(from, to);
    },
    rm: async (path: string, options?: Parameters<typeof real.rm>[1]) => {
      if (hooks.failRm?.(String(path))) {
        const error = new Error("EACCES: permission denied, rmdir '" + path + "'") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
      return real.rm(path, options);
    },
  };
});
import { installLessonArchive, LessonArchiveError, IMPORT_TEMP_PREFIX, STAGING_NAME_PATTERN } from "./lesson-archive.js";

const dirs: string[] = [];
afterEach(() => { hooks.fail = undefined; hooks.failRm = undefined; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempDir(label: string): string { const d = mkdtempSync(join(tmpdir(), "lesson-archive-fail-" + label + "-")); dirs.push(d); return d; }

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** A stored (method 0) zip of named entries. */
function storedZip(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [n, content] of Object.entries(entries)) {
    const raw = Buffer.from(content, "utf8");
    const name = Buffer.from(n, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(raw.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, raw);
    centrals.push(central, name);
    offset += 30 + name.length + raw.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}
function lesson(title: string) {
  return JSON.stringify({
    schema_version: "1.4", bundle_id: "chem-l1", source_plan_id: "p",
    metadata: { title, target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: [{ id: "c1", title: "Concept", description: "d", bloom_level_target: "understand" }],
    scenes: [{ id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" }],
    rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
  });
}
function archive(title: string, extra: Record<string, string> = {}): string {
  const path = join(tempDir("download"), "chem-l1.studium.zip");
  writeFileSync(path, storedZip({ "lesson.json": lesson(title), "assets/fig.png": "fig " + title, ...extra }));
  return path;
}
function approval(title: string): string {
  return JSON.stringify({ schema: "studium-approval/1", bundle_sha256: createHash("sha256").update(lesson(title)).digest("hex"), reviewer: "R" });
}
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const relPath = rel ? rel + "/" + name : name;
      const st = lstatSync(join(dir, relPath));
      if (st.isDirectory()) { out.push("d " + relPath); walk(relPath); }
      else out.push("f " + relPath + " " + createHash("sha256").update(readFileSync(join(dir, relPath))).digest("hex"));
    }
  };
  walk("");
  return out.join("\n");
}
const isNewIntoPlace = (from: string, to: string) => from.endsWith("/new") && !to.includes(IMPORT_TEMP_PREFIX);

describe("a file-system failure after the checks", () => {
  it("installing: write_failed with the system code only, no path, nothing left in the library", async () => {
    const lib = tempDir("library");
    mkdirSync(join(lib, "other"));
    writeFileSync(join(lib, "other", "lesson.json"), "{}");
    const before = snapshot(lib);
    hooks.fail = isNewIntoPlace;
    const error = await installLessonArchive(archive("v1"), lib).catch((e) => e);
    expect(error).toBeInstanceOf(LessonArchiveError);
    expect(error.code).toBe("write_failed");
    expect(error.systemCode).toBe("EACCES");
    expect(error.message).not.toContain(lib);
    expect(snapshot(lib)).toBe(before);
  });
  it("replacing: the old lesson is put back, write_failed, nothing left", async () => {
    const lib = tempDir("library");
    await installLessonArchive(archive("v1"), lib);
    const before = snapshot(lib);
    hooks.fail = isNewIntoPlace;
    const error = await installLessonArchive(archive("v2"), lib, { replace: true }).catch((e) => e);
    expect(error).toBeInstanceOf(LessonArchiveError);
    expect(error.code).toBe("write_failed");
    expect(snapshot(lib)).toBe(before);
  });
  it("replacing, and the old lesson cannot be put back: it is never deleted, and the error names where it is", async () => {
    const lib = tempDir("library");
    await installLessonArchive(archive("v1"), lib);
    const old = readFileSync(join(lib, "chem-l1", "lesson.json"));
    hooks.fail = (from, to) => isNewIntoPlace(from, to) || from.endsWith("/previous");
    const error = await installLessonArchive(archive("v2"), lib, { replace: true }).catch((e) => e);
    expect(error).toBeInstanceOf(LessonArchiveError);
    expect(error.code).toBe("restore_failed");
    // Changed (second review, item 1): the error names the staging folder, which holds « previous » and « new ».
    const kept = error.member as string;
    expect(kept.startsWith(join(lib, IMPORT_TEMP_PREFIX))).toBe(true);
    expect(readFileSync(join(kept, "previous", "lesson.json")).equals(old)).toBe(true);
    expect(existsSync(join(lib, "chem-l1"))).toBe(false);
    hooks.fail = undefined;
    // A later install keeps that folder, even once it is old: it holds a previous lesson.
    await installLessonArchive(archive("v3"), lib);
    expect(existsSync(join(kept, "previous", "lesson.json"))).toBe(true);
  });
  it("replacing, and community/ cannot be put back: restore_failed names the folder that holds the old lesson and its contributions", async () => {
    const lib = tempDir("library");
    await installLessonArchive(archive("v1"), lib);
    mkdirSync(join(lib, "chem-l1", "community"));
    writeFileSync(join(lib, "chem-l1", "community", "c.zip"), "contribution");
    hooks.fail = (from, to) => isNewIntoPlace(from, to) || from.endsWith("/new/community");
    const error = await installLessonArchive(archive("v2"), lib, { replace: true }).catch((e) => e);
    expect(error).toBeInstanceOf(LessonArchiveError);
    expect(error.code).toBe("restore_failed");
    const kept = error.member as string;
    expect(readdirSync(kept).sort()).toEqual(["new", "previous"]);
    expect(readFileSync(join(kept, "new", "community", "c.zip"), "utf8")).toBe("contribution");
    expect(error.message).toMatch(/contributions/);
  });
  // Second review, item 1: the clean-up recognises the name the install gives its staging folder.
  it("the staging folder an install creates bears the name the clean-up recognises", async () => {
    const lib = tempDir("library");
    const moved: string[] = [];
    hooks.fail = (from) => { moved.push(from); return false; };
    await installLessonArchive(archive("v1"), lib);
    const staging = moved.filter((from) => from.endsWith("/new")).map((from) => basename(dirname(from)));
    expect(staging.length).toBe(1);
    expect(STAGING_NAME_PATTERN.test(staging[0]!)).toBe(true);
  });
  // Second review, item 2: once the new folder is in place the operation has succeeded; a clean-up that fails is not a
  // failure.
  it("replacing: the staging folder cannot be removed, the outcome is still replaced", async () => {
    const lib = tempDir("library");
    await installLessonArchive(archive("v1"), lib);
    hooks.failRm = (path) => path.includes(IMPORT_TEMP_PREFIX);
    const outcome = await installLessonArchive(archive("v2"), lib, { replace: true });
    expect(outcome.status).toBe("replaced");
    expect(readFileSync(join(lib, "chem-l1", "lesson.json"), "utf8")).toBe(lesson("v2"));
  });
  it("refreshing: a backup cannot be removed, the outcome is still refreshed", async () => {
    const lib = tempDir("library");
    await installLessonArchive(archive("v1"), lib);
    hooks.failRm = (path) => path.endsWith(".old");
    const outcome = await installLessonArchive(archive("v1", { "approval.json": approval("v1"), "assets/fig.png": "new figure" }), lib);
    expect(outcome.status).toBe("refreshed");
    expect(readFileSync(join(lib, "chem-l1", "assets", "fig.png"), "utf8")).toBe("new figure");
  });
});
