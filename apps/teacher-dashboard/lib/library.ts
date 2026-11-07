/** Server filesystem boundary for the teacher library. Never return a raw bundle to a page. */
// The linter's own placeholder rule (the module declares its types by pattern; this reference brings them in).
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../../packages/lesson-session-host/src/authoring-draft/bundle-lint.d.ts" />
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { LessonBundleSchema } from "../../../packages/lesson-bundle-schema/src";
import { keyClassOf, type KeyClass } from "../../../packages/lesson-session-host/src/key-class";
import { lintBundleData, placeholderPaths } from "../../../tools/bundle_lint.mjs";
import { buildReviewInbox, readLastReceipt, type Consequence, type ReviewReceipt, type ReviewInbox, type ScenePreview, type WhatChanged } from "../../../packages/lesson-session-host/src/review-inbox";

export type LessonStatus = "draft" | "checked" | "approved";
export type ReviewSource = { title: string; url?: string };
export type OutlineScene = { id: string; title: string; type: string; concepts: string[]; sources: ReviewSource[] };
/** An inbox item as a page sees it: never a sha256 (a key-holding scene's hash is an answer oracle).
 * `preview` is the scene's public face (title, kind, learner text, choice texts), never a key. */
export type InboxItem = {
  id: string; consequence: Consequence; whatChanged: WhatChanged; holdsKey: boolean;
  checks: Array<{ check: "schema" | "todo" | "lint"; passed: boolean }>;
  preview: ScenePreview;
};
/** Linter findings as the inbox reads them: located by their message, never copied to a page. */
export type LintFindings = ReadonlyArray<{ level: string; code?: string; message: string }>;
export type InboxReceipt = { reviewer: string; decidedAt: string; decision: "approved" | "returned"; opened: number; notOpened: number };
export type LessonInbox = { items: InboxItem[]; lastReceipt: InboxReceipt | null; counts: ReviewInbox["counts"]; unreadableReceipts: number };
export type LessonInspection = {
  title: string; language: string; bundleId: string; sourcePlanId: string;
  authoringMode: string; sceneCount: number; conceptCount: number; durationMinutes: number | null;
  keyClasses: Record<KeyClass | "unknown", number>; status: LessonStatus; todoCount: number;
  schemaIssueCount: number; outline: OutlineScene[]; conceptTitles: Record<string, string>;
  approval: { recorded: boolean; matches: boolean; reviewer?: string; reviewedAt?: string };
  inbox: LessonInbox;
  /** True when readLesson tried to run the bundle linter and it did not complete: the lint check is then
   * left out of every item, and the page says so in one line. */
  lintUnavailable: boolean;
};
export type LibraryLesson = LessonInspection & { ref: string; routeId: string; bundlePath: string };
export type LibraryIndex = { lessons: LibraryLesson[]; issues: string[]; root: string };

export class LibraryReadError extends Error {
  constructor(readonly kind: "not-found" | "unreadable" | "root-unavailable") {
    super(`Library read failed: ${kind}`);
    this.name = "LibraryReadError";
  }
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 8;
const MAX_LESSONS = 500;
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "__pycache__"]);

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

/** C5 receipts are complete audit records, not just a claimed digest. */
function validApproval(receipt: Record<string, unknown>): boolean {
  const lint = record(receipt.lint);
  const reviewedAt = text(receipt.reviewed_at);
  return receipt.schema === "studium-approval/1"
    && text(receipt.reviewer).trim().length > 0
    && /^\d{4}-\d{2}-\d{2}T/.test(reviewedAt) && Number.isFinite(Date.parse(reviewedAt))
    && receipt.checklist !== null && typeof receipt.checklist === "object" && !Array.isArray(receipt.checklist)
    && lint.errors === 0 && Number.isInteger(lint.warnings) && Number(lint.warnings) >= 0
    && text(receipt.tool).trim().length > 0;
}

function sourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** A whitelist projection: evidence excerpts and grading fields stay on the server. The inbox preview
 * carries each scene's public face (title, learner text, choice texts in authored order), what a learner
 * reads, never which choice is correct, a feedback, a hint or a reveal. `lint` is the linter's findings
 * (null: not run, the lint check is left out; "unavailable": it was run and did not complete). */
export function inspectLesson(
  bytes: Buffer, receipt: unknown,
  lastReview: { receipt: ReviewReceipt | null; unreadable: number } = { receipt: null, unreadable: 0 },
  lint: LintFindings | null | "unavailable" = null,
): LessonInspection {
  const bundle = record(JSON.parse(bytes.toString("utf8")));
  const metadata = record(bundle.metadata);
  const authoring = record(metadata.authoring);
  const scenes = array(bundle.scenes).map(record);
  const concepts = array(bundle.concepts).map(record);
  const conceptTitles = Object.fromEntries(concepts.map((c) => [text(c.id), text(c.title, text(c.id))]));
  const keyClasses: LessonInspection["keyClasses"] = { ungraded: 0, author_keyed: 0, production: 0, externally_grounded: 0, unknown: 0 };
  const outline = scenes.map((scene) => {
    keyClasses[keyClassOf(text(scene.type)) ?? "unknown"] += 1;
    const evidence = record(scene.evidence);
    const sources = array(evidence.bibliographic_refs).map((item) => {
      const source = record(item);
      return { title: text(source.title, text(source.perspicacite_doc_id)), url: sourceUrl(source.prov_derived_from) ?? (text(source.doi) ? sourceUrl(`https://doi.org/${text(source.doi)}`) : undefined) };
    });
    return {
      id: text(scene.id), title: text(scene.title, text(scene.id)), type: text(scene.type, "unknown"),
      concepts: array(scene.concept_refs).map((id) => conceptTitles[text(id)] ?? text(id)), sources,
    };
  });
  const approval = record(receipt);
  const recorded = receipt !== null && receipt !== undefined;
  const matches = validApproval(approval)
    && approval.bundle_sha256 === createHash("sha256").update(bytes).digest("hex");
  const parsed = LessonBundleSchema.safeParse(bundle);
  // CQ-5: the linter's implementation (tools/bundle_lint.mjs placeholderPaths), the one review_lesson and
  // `experience_packet.py approve` refuse on, so the library cannot call a lesson a draft that they call finished.
  const todo = placeholderPaths(bundle);
  const todoCount = todo.length;
  const todoPerScene = new Map<string, number>();
  for (const path of todo) {
    const match = /^scenes\.(\d+)(?:\.|$)/.exec(path);
    if (!match) continue;
    const index = Number(match[1]);
    const id = text(scenes[index]?.id) || `#${index}`; // buildReviewInbox's id for a scene without one
    todoPerScene.set(id, (todoPerScene.get(id) ?? 0) + 1);
  }
  // readLesson runs the linter (as review_lesson does) and passes its findings; when it was not run or
  // did not complete, lintFindings null leaves the lint check out of each item rather than claiming it passed.
  const built = buildReviewInbox({
    rawScenes: bundle.scenes, lintFindings: lint === "unavailable" ? null : lint, todoPerScene, schemaValid: parsed.success,
    schemaErrors: parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join(".") })),
    lastReceipt: lastReview.receipt, unreadableReceipts: lastReview.unreadable,
  });
  const last = built.last_receipt;
  const inbox: LessonInbox = {
    // Whitelist projection: sha256 is dropped from every item, not only key-holding ones; the page does not need it.
    items: built.items.map((item) => ({ id: item.id, consequence: item.consequence, whatChanged: item.what_changed, holdsKey: item.holds_key, checks: item.checks.map((c) => ({ check: c.check, passed: c.passed })), preview: item.preview })),
    lastReceipt: last ? { reviewer: last.reviewer, decidedAt: last.decided_at, decision: last.decision, opened: last.opened, notOpened: last.not_opened } : null,
    counts: built.counts, unreadableReceipts: built.unreadable_receipts ?? 0,
  };
  return {
    title: text(metadata.title, text(bundle.bundle_id, "Untitled lesson")), language: text(metadata.language, "—"),
    bundleId: text(bundle.bundle_id), sourcePlanId: text(bundle.source_plan_id),
    authoringMode: text(authoring.mode, "teacher"), sceneCount: scenes.length, conceptCount: concepts.length,
    durationMinutes: typeof metadata.duration_minutes === "number" ? metadata.duration_minutes : null,
    keyClasses, todoCount, schemaIssueCount: parsed.success ? 0 : parsed.error.issues.length,
    // C5 records approval independently of legacy validated_by strings. "Checked" is explicitly
    // a schema/placeholder check, not a human verdict or a claim that the full linter ran.
    status: matches ? "approved" : parsed.success && todoCount === 0 ? "checked" : "draft",
    outline, conceptTitles,
    approval: { recorded, matches, ...(matches && text(approval.reviewer) ? { reviewer: text(approval.reviewer) } : {}), ...(matches && text(approval.reviewed_at) ? { reviewedAt: text(approval.reviewed_at) } : {}) },
    inbox,
    lintUnavailable: lint === "unavailable",
  };
}

/** The bundle linter's core (tools/bundle_lint.mjs lintBundleData), in process, as review_lesson runs it by
 * default: Node built-ins only, synchronous. Any failure to run it is "unavailable", never a pass. */
export function lintLesson(bytes: Buffer, bundleDir: string): LintFindings | "unavailable" {
  let bundle: unknown;
  try { bundle = JSON.parse(bytes.toString("utf8")); }
  catch { return [{ level: "ERROR", code: "invalid_json", message: "lesson.json is not valid JSON" }]; }
  try { return lintBundleData(bundle, { bundleDir }).findings; }
  catch { return "unavailable"; }
}

export function bundlesRoot(): string {
  return resolve(process.env.BUNDLES_ROOT || join(process.env.STUDIUM_HOME || join(homedir(), ".studium"), "library"));
}

function validateReference(ref: string): void {
  if (!ref || isAbsolute(ref) || ref.includes("\\") || ref.includes("\0") || ref.split("/").some((part) => !part || part === ".." || part === ".")) {
    // "." is reserved for a lesson directly at the configured root.
    if (ref !== ".") throw new LibraryReadError("not-found");
  }
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}
export function encodeLessonRef(ref: string): string { validateReference(ref); return Buffer.from(ref).toString("base64url"); }
export function decodeLessonRef(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid lesson route");
  const ref = Buffer.from(id, "base64url").toString("utf8");
  validateReference(ref);
  if (encodeLessonRef(ref) !== id) throw new Error("Non-canonical lesson route");
  return ref;
}

async function confinedDirectory(root: string, ref: string): Promise<string> {
  validateReference(ref);
  let path = root;
  for (const segment of ref === "." ? [] : ref.split("/")) {
    path = join(path, segment);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Linked or invalid lesson directory");
  }
  const canonical = await realpath(path);
  if (!inside(root, canonical)) throw new Error("Lesson leaves BUNDLES_ROOT");
  return canonical;
}

async function readConfinedFile(root: string, directory: string, filename: string): Promise<Buffer> {
  const path = join(directory, filename);
  const directoryBefore = await lstat(directory);
  const canonical = await realpath(path);
  if (!inside(root, canonical) || (await lstat(path)).isSymbolicLink()) throw new Error("Linked file refused");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("Invalid or oversized lesson file");
    // Recheck after opening: O_NOFOLLOW only protects the final component. The
    // opened inode must still be the regular file under the confined directory.
    await confinedDirectory(root, relative(root, directory).split(sep).join("/") || ".");
    const directoryNow = await lstat(directory);
    const fileNow = await lstat(path);
    if (directoryBefore.dev !== directoryNow.dev || directoryBefore.ino !== directoryNow.ino
      || fileNow.isSymbolicLink() || !inside(root, await realpath(path))
      || stat.dev !== fileNow.dev || stat.ino !== fileNow.ino) throw new Error("Lesson changed during open");
    const bytes = await file.readFile();
    const afterRead = await file.stat();
    if (bytes.length > MAX_FILE_BYTES || stat.size !== afterRead.size || stat.mtimeMs !== afterRead.mtimeMs) {
      throw new Error("Lesson changed during read");
    }
    return bytes;
  } finally { await file.close(); }
}

export async function readLesson(root: string, ref: string): Promise<LibraryLesson> {
  validateReference(ref);
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
    if (!(await lstat(canonicalRoot)).isDirectory()) throw new Error("Not a library directory");
  } catch { throw new LibraryReadError("root-unavailable"); }
  try {
    const directory = await confinedDirectory(canonicalRoot, ref);
    const bytes = await readConfinedFile(canonicalRoot, directory, "lesson.json");
    let receipt: unknown = null;
    try { receipt = JSON.parse((await readConfinedFile(canonicalRoot, directory, "approval.json")).toString("utf8")); }
    catch (error) {
      // Distinguish an absent receipt from an existing but unusable record.
      if (record(error).code !== "ENOENT") receipt = {};
    }
    // readLastReceipt keeps its reads inside this (already confined) lesson folder.
    const lastReview = await readLastReceipt(directory);
    return { ...inspectLesson(bytes, receipt, lastReview, lintLesson(bytes, directory)), ref, routeId: encodeLessonRef(ref), bundlePath: join(directory, "lesson.json") };
  } catch (error) {
    if (error instanceof LibraryReadError) throw error;
    const code = record(error).code;
    throw new LibraryReadError(code === "ENOENT" || code === "ENOTDIR" ? "not-found" : "unreadable");
  }
}

export async function listLessons(root = bundlesRoot()): Promise<LibraryIndex> {
  const lessons: LibraryLesson[] = [];
  const issues: string[] = [];
  const canonicalRoot = await realpath(root);
  async function walk(directory: string, depth: number): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.name === "lesson.json" && entry.isFile())) {
      const ref = relative(canonicalRoot, directory).split(sep).join("/") || ".";
      try { lessons.push(await readLesson(canonicalRoot, ref)); }
      catch { issues.push(ref); }
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) continue;
      if (depth >= MAX_DEPTH || lessons.length >= MAX_LESSONS) { issues.push(relative(canonicalRoot, join(directory, entry.name))); continue; }
      try {
        const ref = relative(canonicalRoot, join(directory, entry.name)).split(sep).join("/");
        await walk(await confinedDirectory(canonicalRoot, ref), depth + 1);
      } catch { issues.push(relative(canonicalRoot, join(directory, entry.name))); }
    }
  }
  await walk(canonicalRoot, 0);
  return { lessons: lessons.sort((a, b) => a.title.localeCompare(b.title)), issues, root: canonicalRoot };
}

/** Ambiguous bundle IDs are deliberately not resolved to an arbitrary lesson. */
export async function findLessonByToken(token: string): Promise<LibraryLesson | undefined> {
  try {
    const { lessons } = await listLessons();
    const matches = lessons.filter((lesson) => lesson.bundleId === token || lesson.ref === token || basename(lesson.ref) === token);
    return matches.length === 1 ? matches[0] : undefined;
  } catch { return undefined; }
}
export { approvalCommand, returnCommand } from "./review-commands";
