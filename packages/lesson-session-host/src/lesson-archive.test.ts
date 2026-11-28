// packages/lesson-session-host/src/lesson-archive.test.ts
//
// Route A, lot 1 (plan 2026-11-27-moodle-etagere, task 2): a lesson file a student downloaded from a course page is
// checked, then installed into the learner's library. The archive is untrusted: every refusal of the archive
// contract is tested here, each with the library folder compared byte for byte before and after. The zips are built
// in the test, including the malformed ones a zip library would refuse to write.
import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import {
  inspectLessonArchive, installLessonArchive, LessonArchiveError, IMPORT_TEMP_PREFIX, STAGING_NAME_PATTERN,
  MAX_ARCHIVE_MEMBERS, MAX_ASSET_BYTES, type LessonArchiveErrorCode,
} from "./lesson-archive.js";
import { scanCatalog } from "./lesson-catalog.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tempDir(label: string): string { const d = mkdtempSync(join(tmpdir(), "lesson-archive-" + label + "-")); dirs.push(d); return d; }

function lesson(id = "chem-l1", title = "Les orbitales") {
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title, target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: [{ id: "c1", title: "Concept", description: "d", bloom_level_target: "understand" }],
    scenes: [
      { id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" },
      { id: "s1", type: "intro", title: "II", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "ho" },
    ],
    rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
  };
}
const bytesOf = (data: unknown) => Buffer.from(JSON.stringify(data), "utf8");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function approvalFor(lessonBytes: Buffer, reviewer = "Élise Dumont") {
  return JSON.stringify({ schema: "studium-approval/1", bundle_sha256: sha(lessonBytes), reviewer, reviewed_at: "2026-11-27T09:00:00Z" });
}

// ------------------------------------------------------------------ a zip writer that can also write bad zips
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
interface Entry {
  name: string;
  content?: string | Buffer;
  method?: number;          // 0 stored, 8 deflate (default), anything else written as is
  flags?: number;           // general purpose bit flag (bit 0: encrypted)
  unixMode?: number;        // written in the external attributes, made by Unix
  declaredSize?: number;    // the uncompressed size the directory claims
  crc?: number;
}
interface ZipOptions { zip64Locator?: boolean; offsetOverride?: number }
function zip(entries: Entry[], opts: ZipOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = e.content === undefined ? Buffer.alloc(0) : Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content, "utf8");
    const method = e.method ?? 8;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, "utf8");
    const flags = (e.flags ?? 0) | 0x800;
    const crc = e.crc ?? crc32(raw);
    const size = e.declaredSize ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(e.unixMode === undefined ? 20 : (3 << 8) | 20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.unixMode === undefined ? 0 : (e.unixMode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const parts: Buffer[] = [...locals, centralBytes];
  if (opts.zip64Locator) {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    parts.push(locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(opts.offsetOverride ?? offset, 16);
  parts.push(end);
  return Buffer.concat(parts);
}

/** A well-formed lesson archive, as pack writes it: lesson.json, approval.json, then the assets. */
function lessonZip(opts: { data?: unknown; approval?: false | string; assets?: Record<string, string | Buffer>; extra?: Entry[] } = {}) {
  const lessonBytes = bytesOf(opts.data ?? lesson());
  const entries: Entry[] = [{ name: "lesson.json", content: lessonBytes }];
  if (opts.approval !== false) entries.push({ name: "approval.json", content: opts.approval ?? approvalFor(lessonBytes) });
  for (const [name, content] of Object.entries(opts.assets ?? {})) entries.push({ name: "assets/" + name, content });
  entries.push(...(opts.extra ?? []));
  return { bytes: zip(entries), lessonBytes };
}

function writeArchive(bytes: Buffer, name = "chem-l1.studium.zip"): string {
  const path = join(tempDir("download"), name);
  writeFileSync(path, bytes);
  return path;
}

/** Every entry under a folder, with its mode and, for a file, the digest of its bytes: equal snapshots mean the
 * folder is unchanged. */
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const relPath = rel ? rel + "/" + name : name;
      const st = lstatSync(join(dir, relPath));
      if (st.isSymbolicLink()) out.push("l " + relPath + " -> " + readlinkSync(join(dir, relPath)));
      else if (st.isDirectory()) { out.push("d " + relPath + " " + st.mode); walk(relPath); }
      else out.push("f " + relPath + " " + st.mode + " " + sha(readFileSync(join(dir, relPath))));
    }
  };
  walk("");
  return out.join("\n");
}

/** A library holding one unrelated lesson, so "unchanged" has something to compare. */
function library(): string {
  const lib = tempDir("library");
  mkdirSync(join(lib, "other"), { recursive: true });
  writeFileSync(join(lib, "other", "lesson.json"), JSON.stringify(lesson("other", "Autre")));
  return lib;
}

/** The archive is refused with `code` by inspect and by install (even with replace), and the library is unchanged. */
async function refusal(bytes: Buffer, code: LessonArchiveErrorCode, lib = library()): Promise<LessonArchiveError> {
  const before = snapshot(lib);
  const path = writeArchive(bytes);
  // The library is not read by inspect: a folder that is taken is found at install.
  if (code !== "folder_taken") {
    let inspected: unknown;
    try { await inspectLessonArchive(path); } catch (e) { inspected = e; }
    expect(inspected).toBeInstanceOf(LessonArchiveError);
    expect((inspected as LessonArchiveError).code).toBe(code);
  }
  let installed: unknown;
  try { await installLessonArchive(path, lib, { replace: true }); } catch (e) { installed = e; }
  expect(installed).toBeInstanceOf(LessonArchiveError);
  expect((installed as LessonArchiveError).code).toBe(code);
  expect(snapshot(lib)).toBe(before);
  return installed as LessonArchiveError;
}

describe("inspectLessonArchive and installLessonArchive refuse the archive, and write nothing", () => {
  it("not a zip", async () => {
    await refusal(Buffer.from("this is not a zip archive at all, only text"), "not_zip");
    await refusal(Buffer.alloc(0), "not_zip");
  });
  it("a corrupt zip: a directory that points outside the file, a damaged member", async () => {
    const good = lessonZip().bytes;
    await refusal(zip([{ name: "lesson.json", content: bytesOf(lesson()) }], { offsetOverride: good.length + 100 }), "not_zip");
    await refusal(zip([{ name: "lesson.json", content: bytesOf(lesson()), crc: 1234 }]), "not_zip");
  });
  it("zip64", async () => {
    await refusal(zip([{ name: "lesson.json", content: bytesOf(lesson()) }], { zip64Locator: true }), "unsupported_zip");
    await refusal(zip([{ name: "lesson.json", content: bytesOf(lesson()), declaredSize: 0xffffffff }]), "unsupported_zip");
  });
  it("an encrypted member", async () => {
    await refusal(zip([{ name: "lesson.json", content: bytesOf(lesson()), flags: 1 }]), "unsupported_zip");
  });
  it("an unsupported compression", async () => {
    await refusal(zip([{ name: "lesson.json", content: bytesOf(lesson()) }, { name: "assets/a.png", content: "x", method: 12 }]), "unsupported_zip");
  });
  it.each([
    ["a parent segment", "assets/../../evil.txt"],
    ["a parent segment at the end", "assets/sub/.."],
    ["a current-folder segment", "assets/./evil.txt"],
    ["a backslash", "assets/sub\\..\\evil.txt"],
    ["a NUL", "assets/evil\x00.txt"],
    ["a drive letter", "assets/C:/evil.txt"],
    ["an absolute path after the prefix", "assets//etc/passwd"],
  ])("an unsafe name under assets/: %s", async (_label, name) => {
    const error = await refusal(lessonZip({ extra: [{ name, content: "x" }] }).bytes, "unsafe_member");
    expect(error.member).toBe(name);
  });
  it("a symlink entry, under assets/ or anywhere", async () => {
    await refusal(lessonZip({ extra: [{ name: "assets/link", content: "/etc/passwd", unixMode: 0o120777, method: 0 }] }).bytes, "unsafe_member");
    await refusal(lessonZip({ extra: [{ name: "notes/link", content: "/etc", unixMode: 0o120777, method: 0 }] }).bytes, "unsafe_member");
  });
  it("a duplicate accepted name, also case-insensitively, and a file that is also a folder", async () => {
    const lessonBytes = bytesOf(lesson());
    await refusal(zip([{ name: "lesson.json", content: lessonBytes }, { name: "lesson.json", content: lessonBytes }]), "duplicate_member");
    await refusal(lessonZip({ assets: { "Fig.png": "a", "fig.PNG": "b" } }).bytes, "duplicate_member");
    await refusal(lessonZip({ assets: { "a": "a", "a/b.png": "b" } }).bytes, "duplicate_member");
  });
  it("more than " + MAX_ARCHIVE_MEMBERS + " members", async () => {
    const extra = Array.from({ length: MAX_ARCHIVE_MEMBERS }, (_, n) => ({ name: "junk/" + n, content: "", method: 0 }));
    await refusal(lessonZip({ extra }).bytes, "too_many_members");
  });
  it("an asset over the cap (declared), a lie about a size (inflated), more than the total", async () => {
    await refusal(lessonZip({ extra: [{ name: "assets/big.bin", content: "x", declaredSize: MAX_ASSET_BYTES + 1 }] }).bytes, "too_large");
    // Declared 10 bytes, inflates to a megabyte: stopped while inflating.
    await refusal(lessonZip({ extra: [{ name: "assets/bomb.bin", content: Buffer.alloc(1024 * 1024), declaredSize: 10 }] }).bytes, "too_large");
    const parts = Array.from({ length: 5 }, (_, n) => ({ name: "assets/part" + n, content: "x", declaredSize: MAX_ASSET_BYTES - 1 }));
    await refusal(lessonZip({ extra: parts }).bytes, "too_large");
  });
  it("a lesson.json over the lesson cap", async () => {
    await refusal(zip([{ name: "lesson.json", content: bytesOf(lesson()), declaredSize: 8 * 1024 * 1024 + 1 }]), "too_large");
  });
  it("no lesson.json at the root", async () => {
    await refusal(zip([{ name: "course/lesson.json", content: bytesOf(lesson()) }, { name: "assets/a.png", content: "a" }]), "missing_lesson");
  });
  it("a lesson.json that is not JSON, or fails the bundle schema", async () => {
    await refusal(zip([{ name: "lesson.json", content: "{ not json" }]), "invalid_lesson");
    const error = await refusal(zip([{ name: "lesson.json", content: bytesOf({ ...lesson(), scenes: "none" }) }]), "invalid_lesson");
    expect(error.message).toMatch(/scenes/);
  });
  it.each(["../escape", "a/b", ".hidden", "-dash", "x".repeat(101), "data", "Community", "node_modules"])(
    "a bundle_id the library cannot hold: %s", async (id) => {
      await refusal(lessonZip({ data: lesson(id) }).bytes, "bad_bundle_id");
    });
});

describe("what the archive holds", () => {
  it("inspect summarises the lesson and writes nothing", async () => {
    const { bytes, lessonBytes } = lessonZip({ assets: { "fig.png": "png", "sub/data.csv": "a,b" } });
    const path = writeArchive(bytes);
    const before = snapshot(join(path, ".."));
    const summary = await inspectLessonArchive(path);
    expect(summary).toEqual({
      archiveSha256: sha(bytes),
      bundleId: "chem-l1", title: "Les orbitales", language: "fr", sceneCount: 2, lessonSha256: sha(lessonBytes),
      approval: { recorded: true, matches: true, reviewer: "Élise Dumont", reviewed_at: "2026-11-27T09:00:00Z" },
      assetCount: 2, ignoredMembers: 0, totalBytes: lessonBytes.length + Buffer.byteLength(approvalFor(lessonBytes)) + 3 + 3,
    });
    expect(snapshot(join(path, ".."))).toBe(before);
  });
  it("unknown members are ignored and counted, never extracted; directory entries are skipped", async () => {
    const lib = library();
    const { bytes } = lessonZip({
      assets: { "fig.png": "png" },
      extra: [
        { name: "reviews/r1.json", content: "{}" }, { name: ".DS_Store", content: "x" }, { name: "../outside.txt", content: "x" },
        { name: "/etc/evil", content: "x" }, { name: "assets/", content: "" }, { name: "assets/sub/", content: "" },
      ],
    });
    const outcome = await installLessonArchive(writeArchive(bytes), lib);
    expect(outcome.summary.ignoredMembers).toBe(4);
    expect(outcome.summary.assetCount).toBe(1);
    expect(readdirSync(join(lib, "chem-l1")).sort()).toEqual(["approval.json", "assets", "lesson.json"]);
    expect(readdirSync(join(lib, "chem-l1", "assets"))).toEqual(["fig.png"]);
    expect(readdirSync(lib).sort()).toEqual(["chem-l1", "other"]);
  });
  it("a lesson without approval installs, and its approval reads as none", async () => {
    const lib = library();
    const outcome = await installLessonArchive(writeArchive(lessonZip({ approval: false }).bytes), lib);
    expect(outcome.status).toBe("installed");
    expect(outcome.summary.approval).toEqual({ recorded: false, matches: false });
    expect(existsSync(join(lib, "chem-l1", "approval.json"))).toBe(false);
  });
  it("an approval of another lesson.json reads as recorded and not matching (changed since approval)", async () => {
    const { bytes } = lessonZip({ approval: approvalFor(Buffer.from("another lesson")) });
    const summary = await inspectLessonArchive(writeArchive(bytes));
    expect(summary.approval).toMatchObject({ recorded: true, matches: false });
  });
});

describe("installLessonArchive", () => {
  it("installs into <library>/<bundle_id>/: the exact bytes, the assets under assets/, the approval copied", async () => {
    const lib = library();
    const { bytes, lessonBytes } = lessonZip({ assets: { "fig.png": Buffer.from([0, 1, 2, 255]), "sub/data.csv": "a,b" } });
    const outcome = await installLessonArchive(writeArchive(bytes), lib);
    expect(outcome.status).toBe("installed");
    if (outcome.status === "conflict") throw new Error("unexpected conflict");
    expect(outcome.courseDir).toBe(join(lib, "chem-l1"));
    expect(outcome.bundleRef).toBe("chem-l1/lesson.json");
    expect(readFileSync(join(lib, "chem-l1", "lesson.json")).equals(lessonBytes)).toBe(true);
    expect(readFileSync(join(lib, "chem-l1", "assets", "fig.png")).equals(Buffer.from([0, 1, 2, 255]))).toBe(true);
    expect(readFileSync(join(lib, "chem-l1", "assets", "sub", "data.csv"), "utf8")).toBe("a,b");
    expect(outcome.summary.approval.matches).toBe(true);
    // The catalog lists the lesson as validated, the other lesson is still there, no temporary folder is left.
    const catalog = await scanCatalog([{ kind: "library", dir: lib }]);
    expect(catalog.lessons.map((l) => [l.bundle_ref, l.validated]).sort()).toEqual([["chem-l1/lesson.json", true], ["other/lesson.json", false]]);
    expect(readdirSync(lib).sort()).toEqual(["chem-l1", "other"]);
  });
  it("creates the library folder when it does not exist yet", async () => {
    const lib = join(tempDir("fresh"), "library");
    const outcome = await installLessonArchive(writeArchive(lessonZip().bytes), lib);
    expect(outcome.status).toBe("installed");
    expect(readdirSync(lib)).toEqual(["chem-l1"]);
  });
  it("the same lesson.json already there: already_present, nothing written", async () => {
    const lib = library();
    const path = writeArchive(lessonZip().bytes);
    await installLessonArchive(path, lib);
    const before = snapshot(lib);
    const again = await installLessonArchive(path, lib);
    expect(again.status).toBe("already_present");
    expect(snapshot(lib)).toBe(before);
  });
  it("another lesson.json under that bundle_id: conflict without replace, nothing written", async () => {
    const lib = library();
    const first = await installLessonArchive(writeArchive(lessonZip({ assets: { "old.png": "old" } }).bytes), lib);
    const before = snapshot(lib);
    const { bytes } = lessonZip({ data: lesson("chem-l1", "Les orbitales, version 2") });
    const outcome = await installLessonArchive(writeArchive(bytes), lib);
    expect(outcome.status).toBe("conflict");
    if (outcome.status !== "conflict") throw new Error("expected a conflict");
    expect(outcome.existingSha256).toBe(first.summary.lessonSha256);
    expect(outcome.courseDir).toBe(join(lib, "chem-l1"));
    expect(outcome.summary.title).toBe("Les orbitales, version 2");
    expect(snapshot(lib)).toBe(before);
  });
  it("a folder of that name without a lesson.json is a conflict too", async () => {
    const lib = library();
    mkdirSync(join(lib, "chem-l1"));
    writeFileSync(join(lib, "chem-l1", "notes.txt"), "mine");
    const before = snapshot(lib);
    const outcome = await installLessonArchive(writeArchive(lessonZip().bytes), lib);
    expect(outcome).toMatchObject({ status: "conflict", existingSha256: "" });
    expect(snapshot(lib)).toBe(before);
  });
  it("replace: the new lesson takes the folder's place, the old one's files are gone, nothing is left over", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip({ assets: { "old.png": "old" } }).bytes), lib);
    const { bytes, lessonBytes } = lessonZip({ data: lesson("chem-l1", "Les orbitales, version 2"), approval: false, assets: { "new.png": "new" } });
    const outcome = await installLessonArchive(writeArchive(bytes), lib, { replace: true });
    expect(outcome.status).toBe("replaced");
    expect(readFileSync(join(lib, "chem-l1", "lesson.json")).equals(lessonBytes)).toBe(true);
    expect(readdirSync(join(lib, "chem-l1")).sort()).toEqual(["assets", "lesson.json"]);
    expect(readdirSync(join(lib, "chem-l1", "assets"))).toEqual(["new.png"]);
    expect(readdirSync(lib).sort()).toEqual(["chem-l1", "other"]);
  });
  it("replace never follows a link the library holds in the lesson's place", async () => {
    const lib = library();
    const elsewhere = tempDir("elsewhere");
    writeFileSync(join(elsewhere, "keep.txt"), "keep");
    symlinkSync(elsewhere, join(lib, "chem-l1"));
    const outcome = await installLessonArchive(writeArchive(lessonZip().bytes), lib, { replace: true });
    expect(outcome.status).toBe("replaced");
    expect(lstatSync(join(lib, "chem-l1")).isDirectory()).toBe(true);
    expect(readdirSync(elsewhere)).toEqual(["keep.txt"]);
  });
  // Root writes through a read-only mode, so the refusal this checks cannot happen there.
  it.skipIf(process.getuid?.() === 0)("a library that cannot be written to: an error, nothing left over", async () => {
    const lib = library();
    chmodSync(lib, 0o500);
    try {
      await expect(installLessonArchive(writeArchive(lessonZip().bytes), lib)).rejects.toThrow();
    } finally { chmodSync(lib, 0o700); }
    expect(readdirSync(lib)).toEqual(["other"]);
  });
  it("the temporary folder is one the catalog never lists", async () => {
    expect(IMPORT_TEMP_PREFIX.startsWith(".")).toBe(true);
    const lib = library();
    mkdirSync(join(lib, IMPORT_TEMP_PREFIX + "probe", "new"), { recursive: true });
    writeFileSync(join(lib, IMPORT_TEMP_PREFIX + "probe", "new", "lesson.json"), JSON.stringify(lesson("probe", "Probe")));
    const catalog = await scanCatalog([{ kind: "library", dir: lib }]);
    expect(catalog.lessons.map((l) => l.bundle_id)).toEqual(["other"]);
  });
});

describe("review 2026-11-27: the shared name rules", () => {
  it.each([
    "assets/a*b.png", "assets/a?b.png", 'assets/a"b.png', "assets/a<b.png", "assets/a>b.png", "assets/a|b.png",
    "assets/dir./x.png", "assets/x.png ", "assets/x\x1f.png", "assets/x\x7f.png",
    "assets/CON", "assets/con.txt", "assets/sub/LPT9.png", "assets/Com1.tar.gz", "assets/nul",
    "assets/" + "é".repeat(128),
    "assets/" + ("a".repeat(200) + "/").repeat(6) + "x",
  ])("an asset name the rules refuse: %s", async (name) => {
    await refusal(lessonZip({ extra: [{ name, content: "x" }] }).bytes, "unsafe_member");
  });
  it("names the rules allow are kept: COM10, console, a 255-byte segment", async () => {
    const lib = library();
    const long = "a".repeat(255);
    const outcome = await installLessonArchive(writeArchive(lessonZip({ assets: { "COM10.png": "1", "console.png": "2", [long]: "3" } }).bytes), lib);
    expect(outcome.summary.assetCount).toBe(3);
    expect(readdirSync(join(lib, "chem-l1", "assets")).sort()).toEqual(["COM10.png", "console.png", long].sort());
  });
  it.each(["demo.", "CON", "nul.txt", "Lesson.JSON", "approval.json", "assets", "Reviews", "Dist", "DATA", "community"])(
    "a bundle_id the rules refuse: %s", async (id) => {
      await refusal(lessonZip({ data: lesson(id) }).bytes, "bad_bundle_id");
    });
  it("two asset names one folding of case makes equal (straße, STRASSE) are a duplicate", async () => {
    await refusal(lessonZip({ assets: { "straße.png": "a", "STRASSE.png": "b" } }).bytes, "duplicate_member");
  });
});

describe("review 2026-11-27: the install is the lesson the student confirmed", () => {
  it("the summary carries the sha256 of the whole archive file", async () => {
    const { bytes } = lessonZip();
    expect((await inspectLessonArchive(writeArchive(bytes))).archiveSha256).toBe(sha(bytes));
  });
  it("a file swapped after the check is refused (changed_since_check), nothing written", async () => {
    const lib = library();
    const path = writeArchive(lessonZip().bytes);
    const checked = await inspectLessonArchive(path);
    writeFileSync(path, lessonZip({ data: lesson("other-lesson", "Other") }).bytes);
    const before = snapshot(lib);
    const error = await installLessonArchive(path, lib, { expectedArchiveSha256: checked.archiveSha256 }).catch((e) => e);
    expect(error).toBeInstanceOf(LessonArchiveError);
    expect(error.code).toBe("changed_since_check");
    expect(snapshot(lib)).toBe(before);
    expect((await installLessonArchive(path, lib, { expectedArchiveSha256: sha(readFileSync(path)) })).status).toBe("installed");
  });
  it("replace answers conflict again, writing nothing, when the library no longer holds the lesson the prompt showed", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip({ data: lesson("chem-l1", "v1") }).bytes), lib);
    const v2 = writeArchive(lessonZip({ data: lesson("chem-l1", "v2") }).bytes);
    const first = await installLessonArchive(v2, lib);
    if (first.status !== "conflict") throw new Error("expected a conflict");
    // Meanwhile another import put v3 there.
    const v3 = await installLessonArchive(writeArchive(lessonZip({ data: lesson("chem-l1", "v3") }).bytes), lib, { replace: true });
    const before = snapshot(lib);
    const again = await installLessonArchive(v2, lib, { replace: true, expectedExistingSha256: first.existingSha256 });
    expect(again.status).toBe("conflict");
    if (again.status !== "conflict") throw new Error("expected a conflict");
    expect(again.existingSha256).toBe(v3.summary.lessonSha256);
    expect(snapshot(lib)).toBe(before);
    const done = await installLessonArchive(v2, lib, { replace: true, expectedExistingSha256: again.existingSha256 });
    expect(done.status).toBe("replaced");
  });
});

describe("review 2026-11-27: the same lesson.json, another approval or other figures", () => {
  it("writes the archive's approval.json into the folder that lacks it: refreshed, nothing else touched", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip({ approval: false, assets: { "fig.png": "fig" } }).bytes), lib);
    writeFileSync(join(lib, "chem-l1", "notes.txt"), "mine");
    const { bytes, lessonBytes } = lessonZip({ assets: { "fig.png": "fig" } });
    const outcome = await installLessonArchive(writeArchive(bytes), lib);
    expect(outcome.status).toBe("refreshed");
    expect(readFileSync(join(lib, "chem-l1", "approval.json"), "utf8")).toBe(approvalFor(lessonBytes));
    expect(readFileSync(join(lib, "chem-l1", "notes.txt"), "utf8")).toBe("mine");
    expect(readdirSync(join(lib, "chem-l1")).sort()).toEqual(["approval.json", "assets", "lesson.json", "notes.txt"]);
    const catalog = await scanCatalog([{ kind: "library", dir: lib }]);
    expect(catalog.lessons.find((l) => l.bundle_id === "chem-l1")?.validated).toBe(true);
  });
  // Changed (second review, items 3 and 4): a refresh needs an approval in the archive that matches the lesson.json; an
  // archive without one, or with a stale one, writes nothing (the earlier test wrote figures without any approval).
  it("with a matching approval, updates a changed asset and writes a missing one, and keeps the others", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip({ approval: false, assets: { "fig.png": "old", "keep.png": "keep" } }).bytes), lib);
    const outcome = await installLessonArchive(writeArchive(lessonZip({ assets: { "fig.png": "new", "sub/more.png": "more" } }).bytes), lib);
    expect(outcome.status).toBe("refreshed");
    expect(readFileSync(join(lib, "chem-l1", "assets", "fig.png"), "utf8")).toBe("new");
    expect(readFileSync(join(lib, "chem-l1", "assets", "sub", "more.png"), "utf8")).toBe("more");
    expect(readFileSync(join(lib, "chem-l1", "assets", "keep.png"), "utf8")).toBe("keep");
    expect(readdirSync(join(lib, "chem-l1")).filter((n) => n.startsWith("."))).toEqual([]);
  });
  it("without an approval, other figures write nothing: already_present", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip({ assets: { "fig.png": "approved figure" } }).bytes), lib);
    const before = snapshot(lib);
    const outcome = await installLessonArchive(writeArchive(lessonZip({ approval: false, assets: { "fig.png": "other figure", "new.png": "x" } }).bytes), lib);
    expect(outcome.status).toBe("already_present");
    expect(snapshot(lib)).toBe(before);
  });
  it("a stale approval in the archive never overwrites a valid one: already_present", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip().bytes), lib);
    const before = snapshot(lib);
    const outcome = await installLessonArchive(writeArchive(lessonZip({ approval: approvalFor(Buffer.from("another lesson")), assets: { "fig.png": "x" } }).bytes), lib);
    expect(outcome.status).toBe("already_present");
    expect(snapshot(lib)).toBe(before);
    const catalog = await scanCatalog([{ kind: "library", dir: lib }]);
    expect(catalog.lessons.find((l) => l.bundle_id === "chem-l1")?.validated).toBe(true);
  });
  it("never writes through a link the lesson folder holds in place of assets/", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip({ approval: false }).bytes), lib);
    const elsewhere = tempDir("elsewhere");
    symlinkSync(elsewhere, join(lib, "chem-l1", "assets"));
    const before = snapshot(lib);
    const error = await installLessonArchive(writeArchive(lessonZip({ assets: { "fig.png": "fig" } }).bytes), lib).catch((e) => e);
    expect(error).toBeInstanceOf(LessonArchiveError);
    expect(error.code).toBe("write_failed");
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(snapshot(lib)).toBe(before);
  });
});

describe("review 2026-11-27: the library around the install", () => {
  // Changed (second review, item 1): only a real folder named exactly as the install names its staging folders, older
  // than an hour, with no entry named « previous » is removed; anything else is never touched.
  it("removes only its own old staging folders that hold no previous lesson", async () => {
    const lib = library();
    const staging = (hex: string) => join(lib, IMPORT_TEMP_PREFIX + hex);
    const removed = staging("0123456789abcdef");
    const withPrevious = staging("1123456789abcdef");
    const withPreviousFile = staging("2123456789abcdef");
    const recent = staging("3123456789abcdef");
    const nearMiss = join(lib, IMPORT_TEMP_PREFIX + "mynotes");
    const nearMissHex = staging("0123456789abcdeg");
    const link = staging("4123456789abcdef");
    const target = tempDir("link-target");
    expect(STAGING_NAME_PATTERN.test(IMPORT_TEMP_PREFIX + "0123456789abcdef")).toBe(true);
    expect(STAGING_NAME_PATTERN.test(IMPORT_TEMP_PREFIX + "mynotes")).toBe(false);
    mkdirSync(join(removed, "new"), { recursive: true });
    mkdirSync(join(withPrevious, "previous"), { recursive: true });
    mkdirSync(withPreviousFile, { recursive: true });
    writeFileSync(join(withPreviousFile, "previous"), "not a folder");
    for (const dir of [recent, nearMiss, nearMissHex]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(nearMiss, "notes.txt"), "mine");
    symlinkSync(target, link);
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    for (const dir of [removed, withPrevious, withPreviousFile, nearMiss, nearMissHex, target]) utimesSync(dir, twoHoursAgo, twoHoursAgo);
    await installLessonArchive(writeArchive(lessonZip().bytes), lib);
    expect(readdirSync(lib).sort()).toEqual(
      [withPrevious, withPreviousFile, recent, nearMiss, nearMissHex, link].map((p) => p.slice(lib.length + 1)).concat(["chem-l1", "other"]).sort());
    expect(readFileSync(join(nearMiss, "notes.txt"), "utf8")).toBe("mine");
  });
  it("replace carries the old folder's community/ into the new one", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip({ data: lesson("chem-l1", "v1") }).bytes), lib);
    mkdirSync(join(lib, "chem-l1", "community"));
    writeFileSync(join(lib, "chem-l1", "community", "community-item1.zip"), "contribution");
    const outcome = await installLessonArchive(writeArchive(lessonZip({ data: lesson("chem-l1", "v2") }).bytes), lib, { replace: true });
    expect(outcome.status).toBe("replaced");
    expect(readFileSync(join(lib, "chem-l1", "community", "community-item1.zip"), "utf8")).toBe("contribution");
    expect(readdirSync(lib).sort()).toEqual(["chem-l1", "other"]);
  });
  it("a community/ that is a link is not carried, and the conflict says it will not be", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip({ data: lesson("chem-l1", "v1") }).bytes), lib);
    const elsewhere = tempDir("contributions");
    writeFileSync(join(elsewhere, "community-item1.zip"), "contribution");
    symlinkSync(elsewhere, join(lib, "chem-l1", "community"));
    const v2 = writeArchive(lessonZip({ data: lesson("chem-l1", "v2") }).bytes);
    const conflict = await installLessonArchive(v2, lib);
    expect(conflict).toMatchObject({ status: "conflict", carriesCommunity: false });
    expect((await installLessonArchive(v2, lib, { replace: true })).status).toBe("replaced");
    expect(existsSync(join(lib, "chem-l1", "community"))).toBe(false);
    expect(readdirSync(elsewhere)).toEqual(["community-item1.zip"]);
  });
  it("a real community/ is announced as carried", async () => {
    const lib = library();
    await installLessonArchive(writeArchive(lessonZip({ data: lesson("chem-l1", "v1") }).bytes), lib);
    expect(await installLessonArchive(writeArchive(lessonZip({ data: lesson("chem-l1", "v2") }).bytes), lib)).toMatchObject({ carriesCommunity: false });
    mkdirSync(join(lib, "chem-l1", "community"));
    expect(await installLessonArchive(writeArchive(lessonZip({ data: lesson("chem-l1", "v2") }).bytes), lib)).toMatchObject({ status: "conflict", carriesCommunity: true });
  });
  it("a lesson folder that is a link: replace never moves the community/ out of what it names", async () => {
    const lib = library();
    const elsewhere = tempDir("linked-course");
    mkdirSync(join(elsewhere, "community"));
    writeFileSync(join(elsewhere, "community", "c.zip"), "c");
    symlinkSync(elsewhere, join(lib, "chem-l1"));
    expect(await installLessonArchive(writeArchive(lessonZip().bytes), lib)).toMatchObject({ status: "conflict", carriesCommunity: false });
    expect((await installLessonArchive(writeArchive(lessonZip().bytes), lib, { replace: true })).status).toBe("replaced");
    expect(readdirSync(join(elsewhere, "community"))).toEqual(["c.zip"]);
  });
  it("a folder whose name differs from the bundle_id only by case is taken (folder_taken), nothing written", async () => {
    const lib = library();
    mkdirSync(join(lib, "demo"));
    writeFileSync(join(lib, "demo", "lesson.json"), JSON.stringify(lesson("demo", "Demo")));
    const error = await refusal(lessonZip({ data: lesson("Demo") }).bytes, "folder_taken", lib);
    expect(error.member).toBe("demo");
  });
});
