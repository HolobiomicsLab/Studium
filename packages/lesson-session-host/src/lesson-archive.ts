// packages/lesson-session-host/src/lesson-archive.ts
//
// Route A, lot 1 (spec 2026-11-27-moodle-etagere-design, plan task 2): a lesson file a teacher packed
// (tools/experience_packet.py pack, « <bundle_id>.studium.zip ») and a student downloaded from a course page is
// checked, then installed into the learner's library as <library>/<bundle_id>/lesson.json, so the catalog, the
// resolver and the pane read it like any lesson of the library.
//
// The archive is untrusted. It is read whole in memory (capped), its central directory checked entry by entry, and
// every accepted member inflated with a hard cap and its CRC verified, all before anything is written. Only three
// kinds of member are ever written: lesson.json, approval.json and regular files under assets/. Any other member is
// ignored and counted. Writes go to a fresh temporary folder inside the library (a dot folder, which the catalog never
// enters), then one rename puts it in place: nothing is written outside <library>/<bundle_id>/ and that folder.
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
// The loader module itself, not the adapters index: the VS Code extension bundles this file, and the index would bring
// every adapter (scorers, telemetry sinks) with it.
import { BundleSchemaError, loadBundleJson, MAX_LESSON_JSON_BYTES } from "../../lesson-session/src/adapters/bundle-loader.js";
import { approvalOfZip, MAX_APPROVAL_BYTES, type ApprovalStatus } from "./authoring.js";

export type LessonArchiveErrorCode =
  | "not_zip" | "unsupported_zip" | "unsafe_member" | "duplicate_member" | "too_many_members"
  | "too_large" | "missing_lesson" | "invalid_lesson" | "bad_bundle_id";

/** Why an archive was refused. Thrown before anything is written. */
export class LessonArchiveError extends Error {
  readonly code: LessonArchiveErrorCode;
  readonly member?: string;
  constructor(code: LessonArchiveErrorCode, message: string, member?: string) {
    super(message);
    this.name = "LessonArchiveError";
    this.code = code;
    if (member !== undefined) this.member = member;
  }
}

export interface LessonArchiveSummary {
  bundleId: string;
  title: string;
  language: string;
  sceneCount: number;
  /** sha256 of the lesson.json member's bytes, the digest an approval record is bound to. */
  lessonSha256: string;
  /** The approval.json member read against those bytes (approvalOfZip): none when the archive has none. */
  approval: ApprovalStatus;
  assetCount: number;
  /** Members neither lesson.json, approval.json nor a file under assets/: never written. */
  ignoredMembers: number;
  /** Bytes the install writes (lesson.json, approval.json and the assets, uncompressed). */
  totalBytes: number;
}

export type InstallOutcome =
  | { status: "installed" | "replaced" | "already_present"; courseDir: string; bundleRef: string; summary: LessonArchiveSummary }
  | { status: "conflict"; courseDir: string; existingSha256: string; summary: LessonArchiveSummary };

export const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const MAX_ARCHIVE_MEMBERS = 2000;
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** The archive file itself: the total plus room for headers and incompressible data. */
export const MAX_ARCHIVE_FILE_BYTES = MAX_TOTAL_BYTES + 16 * 1024 * 1024;
/** The temporary folder an install writes into, inside the library. A dot folder: the catalog never lists it. */
export const IMPORT_TEMP_PREFIX = ".studium-import-";
/** Folder names the catalog skips (lesson-catalog.ts SKIPPED_DIRS): a lesson installed there would never be listed. */
const RESERVED_FOLDERS = new Set(["node_modules", "dist", "data", "_sources", "_drafts", "community"]);

const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const END_OF_CENTRAL = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const END_OF_CENTRAL_SIZE = 22;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const MADE_BY_UNIX = 3;

interface ReadArchive { summary: LessonArchiveSummary; files: Map<string, Buffer>; lessonBytes: Buffer }

/** Reads and checks the archive. Writes nothing. Throws LessonArchiveError. */
export async function inspectLessonArchive(zipPath: string): Promise<LessonArchiveSummary> {
  return (await readLessonArchive(zipPath)).summary;
}

/**
 * Installs into <libraryDir>/<bundleId>/. Same lesson.json bytes already there: already_present, nothing written.
 * Another lesson.json there (or a folder of that name without one) and replace !== true: conflict, nothing written.
 * Writes go to a temporary folder inside libraryDir that the catalog does not list, then one rename; with replace,
 * the folder in place is first moved into that temporary folder, then removed with it.
 */
export async function installLessonArchive(
  zipPath: string, libraryDir: string, options: { replace?: boolean } = {},
): Promise<InstallOutcome> {
  const archive = await readLessonArchive(zipPath);
  const { summary } = archive;
  const library = resolve(libraryDir);
  const courseDir = join(library, summary.bundleId);
  const bundleRef = summary.bundleId + "/lesson.json";
  const existing = await existingLesson(courseDir);
  if (existing !== null && existing === summary.lessonSha256) return { status: "already_present", courseDir, bundleRef, summary };
  if (existing !== null && options.replace !== true) return { status: "conflict", courseDir, existingSha256: existing, summary };

  await mkdir(library, { recursive: true });
  const staging = await mkdtemp(join(library, IMPORT_TEMP_PREFIX));
  try {
    const fresh = join(staging, "new");
    await mkdir(fresh);
    for (const [name, bytes] of archive.files) {
      const target = resolve(fresh, name);
      if (escapes(fresh, target)) throw new Error("refusing to write outside the lesson folder: " + name); // names were checked
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
    if (existing === null) {
      await rename(fresh, courseDir);
      return { status: "installed", courseDir, bundleRef, summary };
    }
    // Moved, never entered: when the library holds a link in the lesson's place, the link moves, not what it names.
    const previous = join(staging, "previous");
    await rename(courseDir, previous);
    try { await rename(fresh, courseDir); }
    catch (error) { await rename(previous, courseDir); throw error; }
    return { status: "replaced", courseDir, bundleRef, summary };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The sha256 of the lesson.json in place, "" for anything else in that place, null when there is nothing. */
async function existingLesson(courseDir: string): Promise<string | null> {
  let entry;
  try { entry = await lstat(courseDir); } catch { return null; }
  if (!entry.isDirectory()) return "";
  const lessonPath = join(courseDir, "lesson.json");
  try {
    if (!(await lstat(lessonPath)).isFile()) return "";
    return createHash("sha256").update(await readFile(lessonPath)).digest("hex");
  } catch { return ""; }
}

function escapes(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel);
}

async function readLessonArchive(zipPath: string): Promise<ReadArchive> {
  let size: number;
  try { size = (await stat(zipPath)).size; }
  catch { throw new LessonArchiveError("not_zip", "the lesson file cannot be read"); }
  if (size > MAX_ARCHIVE_FILE_BYTES) throw new LessonArchiveError("too_large", "the lesson file is larger than " + MAX_ARCHIVE_FILE_BYTES + " bytes");
  const zip = await readFile(zipPath);
  const entries = centralDirectory(zip);
  const accepted = acceptedEntries(entries);
  const files = new Map<string, Buffer>();
  let totalBytes = 0;
  for (const entry of accepted.list) {
    const bytes = inflateEntry(zip, entry);
    files.set(entry.name, bytes);
    totalBytes += bytes.length;
  }
  const lessonBytes = files.get("lesson.json");
  if (!lessonBytes) throw new LessonArchiveError("missing_lesson", "the archive has no lesson.json at its root");
  const bundle = parseLesson(lessonBytes);
  const lessonSha256 = createHash("sha256").update(lessonBytes).digest("hex");
  const approvalBytes = files.get("approval.json");
  const summary: LessonArchiveSummary = {
    bundleId: bundle.bundle_id,
    title: bundle.metadata.title,
    language: bundle.metadata.language,
    sceneCount: bundle.scenes.length,
    lessonSha256,
    approval: approvalOfZip(approvalBytes ? approvalBytes.toString("utf8") : null, lessonSha256),
    assetCount: [...files.keys()].filter((name) => name.startsWith("assets/")).length,
    ignoredMembers: accepted.ignored,
    totalBytes,
  };
  return { summary, files, lessonBytes };
}

function parseLesson(bytes: Buffer): ReturnType<typeof loadBundleJson> {
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")); }
  catch { throw new LessonArchiveError("invalid_lesson", "lesson.json is not valid JSON", "lesson.json"); }
  let bundle;
  try { bundle = loadBundleJson(raw); }
  catch (error) {
    const why = error instanceof BundleSchemaError ? error.message : "it does not match the bundle schema";
    throw new LessonArchiveError("invalid_lesson", "lesson.json does not match the bundle schema: " + why, "lesson.json");
  }
  const id = bundle.bundle_id;
  if (!BUNDLE_ID_PATTERN.test(id) || RESERVED_FOLDERS.has(id.toLowerCase()))
    throw new LessonArchiveError("bad_bundle_id", "the lesson's bundle_id cannot name a folder of the library: " + JSON.stringify(id.slice(0, 120)));
  return bundle;
}

// ------------------------------------------------------------------------------------------- the zip structure

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  localOffset: number;
  nameBytes: Buffer;
}

function corrupt(why: string): LessonArchiveError {
  return new LessonArchiveError("not_zip", "the file is not a readable zip archive (" + why + ")");
}

/** Every entry of the central directory, checked: no zip64, no multi-disk, no encryption, no symlink, every
 * offset inside the file. */
function centralDirectory(zip: Buffer): CentralEntry[] {
  if (zip.length < END_OF_CENTRAL_SIZE) throw corrupt("too short");
  // The end record is the last 22 bytes plus its comment: the first candidate whose comment ends the file.
  let end = -1;
  for (let at = zip.length - END_OF_CENTRAL_SIZE; at >= 0 && at >= zip.length - END_OF_CENTRAL_SIZE - 0xffff; at--) {
    if (zip.readUInt32LE(at) === END_OF_CENTRAL && at + END_OF_CENTRAL_SIZE + zip.readUInt16LE(at + 20) === zip.length) { end = at; break; }
  }
  if (end < 0) throw corrupt("no end of central directory");
  if (end >= 20 && zip.readUInt32LE(end - 20) === ZIP64_LOCATOR) throw new LessonArchiveError("unsupported_zip", "zip64 archives are not supported");
  const disk = zip.readUInt16LE(end + 4);
  const centralDisk = zip.readUInt16LE(end + 6);
  const onDisk = zip.readUInt16LE(end + 8);
  const count = zip.readUInt16LE(end + 10);
  const centralSize = zip.readUInt32LE(end + 12);
  const centralOffset = zip.readUInt32LE(end + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new LessonArchiveError("unsupported_zip", "zip64 archives are not supported");
  if (disk !== 0 || centralDisk !== 0 || onDisk !== count) throw new LessonArchiveError("unsupported_zip", "split archives are not supported");
  if (count > MAX_ARCHIVE_MEMBERS) throw new LessonArchiveError("too_many_members", "the archive has more than " + MAX_ARCHIVE_MEMBERS + " members");
  if (centralOffset + centralSize > end) throw corrupt("the directory lies outside the file");
  const entries: CentralEntry[] = [];
  let at = centralOffset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL_ENTRY) throw corrupt("damaged directory");
    const madeBy = zip.readUInt16LE(at + 4) >>> 8;
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const external = zip.readUInt32LE(at + 38);
    const localOffset = zip.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw corrupt("damaged directory");
    const nameBytes = zip.subarray(at + 46, at + 46 + nameLength);
    const name = decodeName(nameBytes);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff)
      throw new LessonArchiveError("unsupported_zip", "zip64 members are not supported", name);
    if (flags & 0x41) throw new LessonArchiveError("unsupported_zip", "encrypted members are not supported", name);
    if (madeBy === MADE_BY_UNIX && ((external >>> 16) & S_IFMT) === S_IFLNK)
      throw new LessonArchiveError("unsafe_member", "the archive holds a symbolic link", name);
    entries.push({ name, method, compressedSize, size, crc, localOffset, nameBytes });
    at = next;
  }
  return entries;
}

/** The member name as text; bytes that are not UTF-8 read as U+FFFD, which no accepted name holds. */
function decodeName(bytes: Buffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Why a name under assets/ cannot become a file inside the lesson folder, or null when it can. */
function unsafeAssetName(name: string): string | null {
  for (const char of name) {
    const code = char.codePointAt(0)!;
    if (char === "\\" || char === ":" || code < 0x20 || code === 0x7f || code === 0xfffd)
      return "a backslash, a colon, a control character or a byte that is not UTF-8";
  }
  const segments = name.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return "an empty, « . » or « .. » segment";
  return null;
}

/** The members the install writes, checked: safe names, no duplicate (also case-insensitively, or a file that is also
 * a folder), supported compression, within the caps; and the count of the members it ignores. */
function acceptedEntries(entries: CentralEntry[]): { list: CentralEntry[]; ignored: number } {
  const list: CentralEntry[] = [];
  let ignored = 0;
  const seen = new Set<string>();
  let declaredTotal = 0;
  for (const entry of entries) {
    const { name } = entry;
    if (name.endsWith("/")) continue; // a directory entry: folders are made from the file names
    const asset = name.startsWith("assets/");
    if (!asset && name !== "lesson.json" && name !== "approval.json") { ignored++; continue; }
    if (asset) {
      const why = unsafeAssetName(name);
      if (why) throw new LessonArchiveError("unsafe_member", "unsafe member name (" + why + ")", name);
    }
    const key = name.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new LessonArchiveError("duplicate_member", "the archive holds this member twice", name);
    seen.add(key);
    if (entry.method !== 0 && entry.method !== 8)
      throw new LessonArchiveError("unsupported_zip", "unsupported compression method " + entry.method, name);
    const cap = name === "lesson.json" ? MAX_LESSON_JSON_BYTES : asset ? MAX_ASSET_BYTES : MAX_APPROVAL_BYTES;
    if (entry.size > cap) {
      // An oversized approval record is not one (bundle-loader reads it so): left out, the lesson reads as unapproved.
      if (name === "approval.json") { ignored++; continue; }
      throw new LessonArchiveError("too_large", "member larger than " + cap + " bytes", name);
    }
    declaredTotal += entry.size;
    if (declaredTotal > MAX_TOTAL_BYTES) throw new LessonArchiveError("too_large", "the archive holds more than " + MAX_TOTAL_BYTES + " bytes uncompressed");
    list.push(entry);
  }
  // A file that is also a folder ("assets/a" and "assets/a/b"): the second could not be written.
  for (const key of seen) {
    const slash = key.lastIndexOf("/");
    for (let cut = slash; cut > 0; cut = key.lastIndexOf("/", cut - 1)) {
      if (seen.has(key.slice(0, cut))) throw new LessonArchiveError("duplicate_member", "a member is both a file and a folder", key.slice(0, cut));
    }
  }
  return { list, ignored };
}

/** The bytes of one member: exactly its declared size (inflation stops there whatever the data says) and its CRC. */
function inflateEntry(zip: Buffer, entry: CentralEntry): Buffer {
  const local = entry.localOffset;
  if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL_ENTRY) throw corrupt("damaged member " + entry.name);
  const nameLength = zip.readUInt16LE(local + 26);
  const localName = zip.subarray(local + 30, local + 30 + nameLength);
  if (!localName.equals(entry.nameBytes)) throw corrupt("member names disagree for " + entry.name);
  const start = local + 30 + nameLength + zip.readUInt16LE(local + 28);
  if (start + entry.compressedSize > zip.length) throw corrupt("member " + entry.name + " runs past the end");
  const data = zip.subarray(start, start + entry.compressedSize);
  let bytes: Buffer;
  if (entry.method === 0) bytes = Buffer.from(data);
  else {
    try { bytes = inflateRawSync(data, { maxOutputLength: Math.max(entry.size, 1) }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE")
        throw new LessonArchiveError("too_large", "member inflates past its declared size", entry.name);
      throw corrupt("member " + entry.name + " does not inflate");
    }
  }
  if (bytes.length !== entry.size) {
    if (bytes.length > entry.size) throw new LessonArchiveError("too_large", "member is larger than its declared size", entry.name);
    throw corrupt("member " + entry.name + " is shorter than declared");
  }
  if (crc32(bytes) !== entry.crc) throw corrupt("member " + entry.name + " is damaged (CRC)");
  return bytes;
}

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
