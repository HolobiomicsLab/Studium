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
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
// The loader module itself, not the adapters index: the VS Code extension bundles this file, and the index would bring
// every adapter (scorers, telemetry sinks) with it.
import { BundleSchemaError, loadBundleJson, MAX_LESSON_JSON_BYTES } from "../../lesson-session/src/adapters/bundle-loader.js";
import { approvalOfZip, MAX_APPROVAL_BYTES, type ApprovalStatus } from "./authoring.js";

export type LessonArchiveErrorCode =
  | "not_zip" | "unsupported_zip" | "unsafe_member" | "duplicate_member" | "too_many_members"
  | "too_large" | "missing_lesson" | "invalid_lesson" | "bad_bundle_id"
  // Review 2026-11-27: found at install, after the checks of the archive.
  | "changed_since_check" | "folder_taken" | "write_failed" | "restore_failed";

/** Why an archive was refused or could not be installed. Every code but restore_failed means nothing was changed in
 * the library; restore_failed names, in `member`, the folder that holds the old lesson. */
export class LessonArchiveError extends Error {
  readonly code: LessonArchiveErrorCode;
  /** The member, or the library folder (folder_taken, restore_failed), the error is about. */
  readonly member?: string;
  /** write_failed, restore_failed: the system error code (EACCES, ENOSPC…), never a path. */
  readonly systemCode?: string;
  constructor(code: LessonArchiveErrorCode, message: string, member?: string, systemCode?: string) {
    super(message);
    this.name = "LessonArchiveError";
    this.code = code;
    if (member !== undefined) this.member = member;
    if (systemCode !== undefined) this.systemCode = systemCode;
  }
}

export interface LessonArchiveSummary {
  /** sha256 of the whole archive file as read: an install given it refuses a file that changed since. */
  archiveSha256: string;
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
  | { status: "installed" | "replaced" | "already_present" | "refreshed"; courseDir: string; bundleRef: string; summary: LessonArchiveSummary }
  | {
    status: "conflict"; courseDir: string; existingSha256: string; summary: LessonArchiveSummary;
    /** The folder in place holds a real community/ folder (class contributions), which a replace carries over; a link
     * there, or a lesson folder that is itself a link, carries nothing. */
    carriesCommunity: boolean;
  };

export const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const MAX_ARCHIVE_MEMBERS = 2000;
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** The archive file itself: the total plus room for headers and incompressible data. */
export const MAX_ARCHIVE_FILE_BYTES = MAX_TOTAL_BYTES + 16 * 1024 * 1024;
/** The temporary folder an install writes into, inside the library. A dot folder: the catalog never lists it. */
export const IMPORT_TEMP_PREFIX = ".studium-import-";
/** The exact name of a staging folder: the prefix and 16 hex digits. The install creates its staging folder with this
 * name and the clean-up removes nothing else (a user's .studium-import-notes is never touched). */
export const STAGING_NAME_PATTERN = /^\.studium-import-[0-9a-f]{16}$/;
function stagingName(): string {
  return IMPORT_TEMP_PREFIX + randomBytes(8).toString("hex");
}
/** A leftover temporary folder older than this is removed at the next install (unless it holds a previous lesson). */
export const LEFTOVER_MAX_AGE_MS = 60 * 60 * 1000;
/** Names a bundle_id may not take (any case): the archive's own members, and the folders the catalog skips. */
const RESERVED_BUNDLE_IDS = new Set(["lesson.json", "approval.json", "assets", "reviews", "community", "data", "node_modules", "dist"]);
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const FORBIDDEN_CHARACTERS = new Set(["\\", ":", "*", "?", "\"", "<", ">", "|"]);
const MAX_SEGMENT_BYTES = 255;
const MAX_NAME_BYTES = 1024;

export interface InstallOptions {
  /** Replace a different lesson under the same bundle_id. */
  replace?: boolean;
  /** The archiveSha256 the student confirmed: a file that reads otherwise now is refused (changed_since_check). */
  expectedArchiveSha256?: string;
  /** With replace: the existingSha256 of the conflict the student answered. Another lesson there now: conflict again. */
  expectedExistingSha256?: string;
}

// ------------------------------------------------------------------------------------------- the shared name rules
// tools/experience_packet.py pack applies the same rules: a file pack writes is one this import accepts.

/** Why one segment of an asset path cannot name a file on every system, or null when it can. */
export function assetSegmentProblem(segment: string): string | null {
  if (segment === "" || segment === "." || segment === "..") return "an empty, « . » or « .. » segment";
  for (const char of segment) {
    const code = char.codePointAt(0)!;
    if (FORBIDDEN_CHARACTERS.has(char) || code < 0x20 || code === 0x7f) return "one of \\ : * ? \" < > | or a control character";
  }
  if (segment.endsWith(".") || segment.endsWith(" ")) return "a segment that ends with a dot or a space";
  if (WINDOWS_DEVICE.test(segment)) return "a Windows device name";
  if (Buffer.byteLength(segment, "utf8") > MAX_SEGMENT_BYTES) return "a segment over " + MAX_SEGMENT_BYTES + " bytes";
  return null;
}

/** Why a bundle_id cannot name the lesson's folder in the library, or null when it can. */
export function bundleIdProblem(id: string): string | null {
  if (!BUNDLE_ID_PATTERN.test(id)) return "it must match " + BUNDLE_ID_PATTERN.source;
  if (id.endsWith(".")) return "it ends with a dot";
  if (WINDOWS_DEVICE.test(id)) return "it is a Windows device name";
  if (RESERVED_BUNDLE_IDS.has(id.toLowerCase())) return "it is a reserved name";
  return null;
}

/** One name for every spelling a case-insensitive, normalisation-insensitive file system takes as the same. */
function folded(name: string): string {
  return name.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");
}

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
 * Installs into <libraryDir>/<bundleId>/.
 * - Same lesson.json bytes already there, with the archive's approval.json (when it has one) and every asset byte for
 *   byte: already_present, nothing written. Some of those missing or different: they are written into the folder, each
 *   through a temporary name then a rename, nothing else in it touched: refreshed.
 * - Another lesson.json there (or a folder of that name without one) and replace !== true, or with replace another one
 *   than expectedExistingSha256: conflict, nothing written.
 * - A folder whose name differs from the bundle_id only by case or normalisation: folder_taken, nothing written.
 * New folders are written into a temporary folder inside libraryDir that the catalog does not list, then one rename;
 * with replace, the folder in place is first moved into that temporary folder, its community/ carried into the new
 * one, then removed with it. A file-system failure is a LessonArchiveError write_failed, after the library was put
 * back as it was; restore_failed when the old lesson could not be put back, which is then never deleted.
 */
export async function installLessonArchive(zipPath: string, libraryDir: string, options: InstallOptions = {}): Promise<InstallOutcome> {
  const archive = await readLessonArchive(zipPath);
  const { summary } = archive;
  if (options.expectedArchiveSha256 !== undefined && options.expectedArchiveSha256 !== summary.archiveSha256)
    throw new LessonArchiveError("changed_since_check", "the lesson file changed after it was checked");
  const library = resolve(libraryDir);
  await refuseTakenFolder(library, summary.bundleId);
  const courseDir = join(library, summary.bundleId);
  const bundleRef = summary.bundleId + "/lesson.json";
  const existing = await existingLesson(courseDir);
  if (existing !== null && existing === summary.lessonSha256) {
    // Refreshed only by an approval of this very lesson.json: without one (or with a stale one), the folder in place is
    // kept as it is, its approval and figures included.
    if (!summary.approval.matches) return { status: "already_present", courseDir, bundleRef, summary };
    const stale = await staleFiles(courseDir, archive.files);
    if (stale.length === 0) return { status: "already_present", courseDir, bundleRef, summary };
    await asWriteFailure(async () => {
      await removeLeftovers(library);
      await refreshFiles(courseDir, stale);
    });
    return { status: "refreshed", courseDir, bundleRef, summary };
  }
  const conflict = async (): Promise<InstallOutcome> =>
    ({ status: "conflict", courseDir, existingSha256: existing ?? "", summary, carriesCommunity: await carriesCommunity(courseDir) });
  if (existing !== null && options.replace !== true) return conflict();
  if (existing !== null && options.expectedExistingSha256 !== undefined && existing !== options.expectedExistingSha256) return conflict();
  const status = await asWriteFailure(() => writeFolder(library, courseDir, archive.files, existing !== null));
  return { status, courseDir, bundleRef, summary };
}

/** Any failure but a LessonArchiveError becomes write_failed, carrying the system code and no path. */
async function asWriteFailure<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (error instanceof LessonArchiveError) throw error;
    const code = typeof (error as NodeJS.ErrnoException)?.code === "string" ? (error as NodeJS.ErrnoException).code! : "EUNKNOWN";
    throw new LessonArchiveError("write_failed", "the lesson could not be written into the library (" + code + "); nothing was changed", undefined, code);
  }
}

/** The library's folder that a case-insensitive file system would take for <bundleId> without being that name. */
async function refuseTakenFolder(library: string, bundleId: string): Promise<void> {
  let names: string[];
  try { names = await readdir(library); } catch { return; }
  const wanted = folded(bundleId);
  const taken = names.find((name) => name !== bundleId && folded(name) === wanted);
  if (taken !== undefined)
    throw new LessonArchiveError("folder_taken", "the library already has a folder whose name differs from the bundle_id only by case or accents", taken);
}

/** Leftover staging folders of an interrupted install. Removed only when all four hold: a real folder (not a link),
 * named exactly as STAGING_NAME_PATTERN, older than LEFTOVER_MAX_AGE_MS, and holding no entry named « previous » (an old
 * lesson that could not be put back). Anything else is never touched. Best effort. */
async function removeLeftovers(library: string): Promise<void> {
  let names: string[];
  try { names = await readdir(library); } catch { return; }
  const oldest = Date.now() - LEFTOVER_MAX_AGE_MS;
  for (const name of names) {
    if (!STAGING_NAME_PATTERN.test(name)) continue;
    const dir = join(library, name);
    try {
      const entry = await lstat(dir);
      if (!entry.isDirectory() || entry.mtimeMs >= oldest) continue;
      if (await exists(join(dir, "previous"))) continue;
      await rm(dir, { recursive: true, force: true });
    } catch { /* another install may be using it */ }
  }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch { return false; }
}

/** The lesson folder is a real folder holding a real community/ folder: what a replace carries over. */
async function carriesCommunity(courseDir: string): Promise<boolean> {
  return (await isRealDirectory(courseDir)) && (await isRealDirectory(join(courseDir, "community")));
}

async function isRegularFile(path: string): Promise<boolean> {
  try { return (await lstat(path)).isFile(); } catch { return false; }
}
async function isRealDirectory(path: string): Promise<boolean> {
  try { return (await lstat(path)).isDirectory(); } catch { return false; }
}

/** A new lesson folder: written in a temporary folder, then renamed into place. Replacing: the old folder is moved into
 * the temporary folder first, its community/ carried into the new one, and put back if the new one cannot take its
 * place. */
async function writeFolder(library: string, courseDir: string, files: Map<string, Buffer>, replacing: boolean): Promise<"installed" | "replaced"> {
  await mkdir(library, { recursive: true });
  await removeLeftovers(library);
  const staging = join(library, stagingName());
  await mkdir(staging);
  let keepStaging = false;
  try {
    const fresh = join(staging, "new");
    await mkdir(fresh);
    for (const [name, bytes] of files) {
      const target = resolve(fresh, name);
      if (escapes(fresh, target)) throw new Error("refusing to write outside the lesson folder: " + name); // names were checked
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
    if (!replacing) {
      await rename(fresh, courseDir);
      return "installed";
    }
    // Moved, never entered: when the library holds a link in the lesson's place, the link moves, not what it names.
    const carry = await carriesCommunity(courseDir); // checked before the move: a link in the lesson's place carries nothing
    const previous = join(staging, "previous");
    await rename(courseDir, previous);
    const community = join(previous, "community");
    const carried = join(fresh, "community");
    let carrying = false;
    try {
      // Approved class contributions (community-bundles.ts) belong to the course, not to one version of its lesson.
      if (carry && (await isRealDirectory(community))) { await rename(community, carried); carrying = true; }
      await rename(fresh, courseDir);
    } catch (error) {
      try {
        if (carrying) await rename(carried, community);
        await rename(previous, courseDir);
      } catch (restoreError) {
        keepStaging = true;
        const code = (restoreError as NodeJS.ErrnoException)?.code ?? "EUNKNOWN";
        throw new LessonArchiveError("restore_failed",
          "the old lesson could not be put back; the old lesson (previous) and its contributions are kept in " + staging, staging, code);
      }
      throw error;
    }
    return "replaced";
  } finally {
    // The new folder in place is success; a staging folder that cannot be removed is a harmless, invisible leftover.
    if (!keepStaging) { try { await rm(staging, { recursive: true, force: true }); } catch { /* left for the next clean-up */ } }
  }
}

interface StaleFile { name: string; target: string; bytes: Buffer }

/** The archive's files, but lesson.json, that the folder lacks or holds with other bytes. */
async function staleFiles(courseDir: string, files: Map<string, Buffer>): Promise<StaleFile[]> {
  const stale: StaleFile[] = [];
  for (const [name, bytes] of files) {
    if (name === "lesson.json") continue;
    const target = join(courseDir, name);
    let same = false;
    try { same = (await lstat(target)).isFile() && (await readFile(target)).equals(bytes); } catch { same = false; }
    if (!same) stale.push({ name, target, bytes });
  }
  return stale;
}

function fsError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

/** Writes the stale files into an existing lesson folder: never through a link (every folder on the way is checked), each
 * file through a temporary name then a rename; on a failure, every file and folder it wrote is taken back. */
async function refreshFiles(courseDir: string, stale: StaleFile[]): Promise<void> {
  const createdDirs: string[] = [];
  const steps: Array<{ tmp: string; target: string; backup?: string; placed: boolean }> = [];
  try {
    for (const file of stale) {
      const segments = file.name.split("/");
      let dir = courseDir;
      for (const segment of segments.slice(0, -1)) {
        dir = join(dir, segment);
        let entry;
        try { entry = await lstat(dir); } catch { entry = null; }
        if (entry === null) { await mkdir(dir); createdDirs.push(dir); }
        else if (!entry.isDirectory()) throw fsError("ENOTDIR", "not a folder");
      }
      try { if (!(await lstat(file.target)).isFile()) throw fsError("EISDIR", "not a file"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const tmp = join(dir, IMPORT_TEMP_PREFIX + randomBytes(6).toString("hex") + ".tmp");
      await writeFile(tmp, file.bytes, { flag: "wx" });
      steps.push({ tmp, target: file.target, placed: false });
    }
    for (const step of steps) {
      if (await isRegularFile(step.target)) {
        step.backup = join(dirname(step.target), IMPORT_TEMP_PREFIX + randomBytes(6).toString("hex") + ".old");
        await rename(step.target, step.backup);
      }
      await rename(step.tmp, step.target);
      step.placed = true;
    }
  } catch (error) {
    for (const step of [...steps].reverse()) {
      try {
        if (step.placed) await rm(step.target, { force: true });
        if (step.backup) await rename(step.backup, step.target);
        await rm(step.tmp, { force: true });
      } catch { /* best effort: the error below says what failed */ }
    }
    for (const dir of createdDirs.reverse()) { try { await rmdir(dir); } catch { /* not empty */ } }
    throw error;
  }
  // The files are in place: a backup that cannot be removed is a harmless, invisible leftover.
  for (const step of steps) { if (step.backup) { try { await rm(step.backup, { force: true }); } catch { /* left */ } } }
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
    archiveSha256: createHash("sha256").update(zip).digest("hex"),
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
  const problem = bundleIdProblem(id);
  if (problem) throw new LessonArchiveError("bad_bundle_id", "the lesson's bundle_id cannot name a folder of the library (" + problem + "): " + JSON.stringify(id.slice(0, 120)));
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
  /** The name's bytes are valid UTF-8. */
  utf8: boolean;
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
    const { name, utf8 } = decodeName(nameBytes);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff)
      throw new LessonArchiveError("unsupported_zip", "zip64 members are not supported", name);
    if (flags & 0x41) throw new LessonArchiveError("unsupported_zip", "encrypted members are not supported", name);
    if (madeBy === MADE_BY_UNIX && ((external >>> 16) & S_IFMT) === S_IFLNK)
      throw new LessonArchiveError("unsafe_member", "the archive holds a symbolic link", name);
    entries.push({ name, method, compressedSize, size, crc, localOffset, nameBytes, utf8 });
    at = next;
  }
  return entries;
}

/** The member name as text, and whether its bytes were UTF-8 (when not, they read as U+FFFD). */
function decodeName(bytes: Buffer): { name: string; utf8: boolean } {
  try { return { name: new TextDecoder("utf-8", { fatal: true }).decode(bytes), utf8: true }; }
  catch { return { name: new TextDecoder("utf-8").decode(bytes), utf8: false }; }
}

/** Why a name under assets/ cannot become a file inside the lesson folder on every system, or null when it can. */
function unsafeAssetName(entry: CentralEntry): string | null {
  if (!entry.utf8) return "a name that is not UTF-8";
  if (entry.nameBytes.length > MAX_NAME_BYTES) return "a name over " + MAX_NAME_BYTES + " bytes";
  for (const segment of entry.name.split("/")) {
    const problem = assetSegmentProblem(segment);
    if (problem) return problem;
  }
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
      const why = unsafeAssetName(entry);
      if (why) throw new LessonArchiveError("unsafe_member", "unsafe member name (" + why + ")", name);
    }
    const key = folded(name);
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
