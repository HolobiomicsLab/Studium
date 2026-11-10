import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { LessonBundleSchema, formatBundleError, type BundleIssue, type LessonBundle } from "@studium/lesson-bundle-schema";

const LEGACY_OPTIONAL_NULL_KEYS = new Set(["abs_asset", "doi"]);

/** Remove only nulls written for known legacy optional fields. */
function normalizeLegacyOptionalNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeLegacyOptionalNulls);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null && LEGACY_OPTIONAL_NULL_KEYS.has(k)) continue;
      out[k] = normalizeLegacyOptionalNulls(v);
    }
    return out;
  }
  return value;
}

/** A lesson bundle that does not match the schema (RT-7): its problems as readable issues — path,
 * message and what to change (formatBundleError) — and a one-line message naming the first of them,
 * with the count of the others. Replaces the raw ZodError, whose dump no author could act on. */
export class BundleSchemaError extends Error {
  readonly issues: BundleIssue[];
  constructor(issues: BundleIssue[]) {
    const first = issues[0];
    const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";
    super(first ? `${first.path || "(root)"}: ${first.message} — ${first.hint}${more}` : "the bundle does not match the schema");
    this.name = "BundleSchemaError";
    this.issues = issues;
  }
}

function validated(raw: unknown): LessonBundle {
  const input = normalizeLegacyOptionalNulls(raw);
  const parsed = LessonBundleSchema.safeParse(input);
  if (!parsed.success) throw new BundleSchemaError(formatBundleError(parsed.error, input));
  return parsed.data;
}

/** SEC-5: the largest lesson.json a bundle archive may hold, uncompressed (the extension's cap too). */
export const MAX_LESSON_JSON_BYTES = 8 * 1024 * 1024;

const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const END_OF_CENTRAL = 0x06054b50;

/** The largest `approval.json` member read from a bundle archive (a record is a few hundred bytes). */
export const MAX_APPROVAL_JSON_BYTES = 64 * 1024;

class MemberTooLarge extends Error {}

/** SEC-5: the bytes of the member `member` in a zip archive, inflated with a hard cap — and nothing
 * else; null when the archive has no such member. A community archive is untrusted: unzipping it whole
 * (fflate unzipSync, before 2026-10-30) inflated every entry, so a small file could exhaust the server.
 * This reads the central directory, refuses a member declared larger than `cap`, and inflates it with
 * zlib's `maxOutputLength`, which stops at the cap however the archive lies about the size. Only
 * stored and deflated entries are read. */
function zipMemberOf(zip: Buffer, path: string, member: string, cap: number): Buffer | null {
  let end = -1;
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 22 - 0xffff; i--) {
    if (zip.readUInt32LE(i) === END_OF_CENTRAL) { end = i; break; }
  }
  if (end < 0) throw new Error(`bundle ${path} is not a zip archive`);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== CENTRAL_ENTRY) throw new Error(`bundle ${path}: corrupt zip directory`);
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const declared = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (name !== member) { at = next; continue; }
    if (declared > cap) throw new MemberTooLarge();
    const local = zip.readUInt32LE(at + 42);
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== LOCAL_ENTRY) throw new Error(`bundle ${path}: corrupt zip entry`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, Math.min(zip.length, start + compressed));
    if (method === 0) {
      if (data.length > cap) throw new MemberTooLarge();
      return data;
    }
    if (method !== 8) throw new Error(`bundle ${path}: ${member} uses an unsupported compression (${method})`);
    try { return inflateRawSync(data, { maxOutputLength: cap }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw new MemberTooLarge();
      throw new Error(`bundle ${path}: ${member} does not inflate (${(e as Error).message})`);
    }
  }
  return null;
}

/** SEC-5: the bytes of `lesson.json` in a zip archive, capped at MAX_LESSON_JSON_BYTES. */
function lessonJsonOf(zip: Buffer, path: string): Buffer {
  let bytes: Buffer | null;
  try { bytes = zipMemberOf(zip, path, "lesson.json", MAX_LESSON_JSON_BYTES); }
  catch (e) {
    if (e instanceof MemberTooLarge) throw new Error(`bundle ${path}: lesson.json exceeds ${MAX_LESSON_JSON_BYTES} bytes uncompressed`);
    throw e;
  }
  if (bytes === null) throw new Error(`bundle ${path} missing lesson.json`);
  return bytes;
}

/** A lesson archive as read: the validated bundle, the exact bytes of its `lesson.json` member (an
 * approval record is bound to their sha256) and the text of its `approval.json` member, null when it
 * has none or that member cannot be read (too large, corrupt, unsupported compression): fail-safe,
 * a bad record never stops the lesson from loading, it only reads as no approval. */
export interface BundleZip { bundle: LessonBundle; lessonBytes: Buffer; approvalText: string | null }

/** Load and validate a zipped lesson bundle with its approval member; BundleSchemaError when its
 * lesson.json is invalid. */
export async function readBundleZip(path: string): Promise<BundleZip> {
  const buf = await readFile(path);
  const lessonBytes = lessonJsonOf(buf, path);
  const bundle = validated(JSON.parse(lessonBytes.toString("utf8")));
  let approvalText: string | null = null;
  try { approvalText = zipMemberOf(buf, path, "approval.json", MAX_APPROVAL_JSON_BYTES)?.toString("utf8") ?? null; }
  catch { approvalText = null; }
  return { bundle, lessonBytes, approvalText };
}

/** Load and validate a zipped lesson bundle; BundleSchemaError when its lesson.json is invalid. */
export async function loadBundleZip(path: string): Promise<LessonBundle> {
  return (await readBundleZip(path)).bundle;
}

/** Validate an already decoded lesson bundle; BundleSchemaError when it is invalid. */
export function loadBundleJson(raw: unknown): LessonBundle {
  return validated(raw);
}
