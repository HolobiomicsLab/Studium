// packages/lesson-session-host/src/lesson-archive.failure.test.ts
//
// Review 2026-11-27, items 5 and 9: a file-system failure after the checks. node:fs/promises rename is made to fail on
// demand, so the install's two renames (the new folder into place, the old folder back) can be broken one at a time.
// A failure says « nothing was changed » only when it is true; when the old lesson cannot be put back, it is never
// deleted and the error names where it is.
import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const hooks = vi.hoisted(() => ({ fail: undefined as undefined | ((from: string, to: string) => boolean) }));
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
  };
});
import { installLessonArchive, LessonArchiveError, IMPORT_TEMP_PREFIX } from "./lesson-archive.js";

const dirs: string[] = [];
afterEach(() => { hooks.fail = undefined; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
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
function archive(title: string): string {
  const path = join(tempDir("download"), "chem-l1.studium.zip");
  writeFileSync(path, storedZip({ "lesson.json": lesson(title), "assets/fig.png": "fig " + title }));
  return path;
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
    const kept = error.member as string;
    expect(kept.startsWith(join(lib, IMPORT_TEMP_PREFIX)) && kept.endsWith("previous")).toBe(true);
    expect(readFileSync(join(kept, "lesson.json")).equals(old)).toBe(true);
    expect(existsSync(join(lib, "chem-l1"))).toBe(false);
    hooks.fail = undefined;
    // A later install keeps that folder, even once it is old: it holds a previous lesson.
    await installLessonArchive(archive("v3"), lib);
    expect(existsSync(join(kept, "lesson.json"))).toBe(true);
  });
});
