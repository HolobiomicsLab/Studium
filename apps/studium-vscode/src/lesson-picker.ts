// lesson-picker.ts — host-independent course discovery and QuickPick shaping.
// VS Code orchestration stays in extension.ts; this module is driver-tested without a VS Code host.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hostPhrase } from "./host-phrases.js";
import { phrase, type Locale } from "./phrases.js";

const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);
const MAX_DIRECTORY_DEPTH = 2;

/** One candidate JSON file from a bounded directory snapshot. `ref` uses bundle-style POSIX separators. */
export interface LessonDirectoryEntry {
  ref: string;
  contents: string;
  /** SHA-256 (hex) of the exact bytes of the file; derived from `contents` (UTF-8) when absent. */
  sha256?: string;
  /** Text of `approval.json` in the same folder, when the folder has one. */
  approvalText?: string;
}

/**
 * What the approval record says about a lesson (the only source of "validated"; the lesson's free-text
 * `validated_by` is never shown). Mirrors packages/lesson-session-host/src/authoring.ts `parseApproval`,
 * which the extension bundle cannot import.
 */
export type ApprovalState =
  | { state: "approved"; reviewer: string }
  | { state: "changed" }
  | { state: "none" };

/** Course metadata shown in the Studium tree and picker. */
export interface LessonCourse {
  ref: string;
  title: string;
  target: string;
  language: string;
  approval: ApprovalState;
}

/** Host-neutral QuickPick item. `ref` is the bundle override opened after selection. */
export interface LessonPickItem {
  label: string;
  description: string;
  detail: string;
  ref: string;
}

/** A complete picker choice: either a course or the action that chooses another bundles root. */
export interface LessonPickerChoice {
  action: "course" | "folder";
  label: string;
  description: string;
  detail: string;
  ref?: string;
}

interface FileSystemEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface LessonFileSystem {
  readDirectory: (directory: string) => readonly FileSystemEntry[];
  readText: (file: string) => string;
  /** The file's bytes, which the approval record is bound to; falls back to the UTF-8 of `readText`. */
  readBytes?: (file: string) => Uint8Array;
}

const NODE_FILE_SYSTEM: LessonFileSystem = {
  readDirectory: (directory) => readdirSync(directory, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    isFile: entry.isFile(),
  })),
  readText: (file) => readFileSync(file, "utf8"),
  readBytes: (file) => readFileSync(file),
};

const MAX_APPROVAL_CHARS = 64 * 1024;

/** Same rules as the server's `parseApproval`: fail-safe to "none"; a well-formed record whose digest
 * differs from the lesson's bytes reads "changed". */
export function parseApprovalState(text: string | undefined, lessonSha256: string): ApprovalState {
  if (text === undefined || text.length > MAX_APPROVAL_CHARS) return { state: "none" };
  let record: unknown;
  try { record = JSON.parse(text); } catch { return { state: "none" }; }
  if (typeof record !== "object" || record === null || Array.isArray(record)) return { state: "none" };
  const r = record as Record<string, unknown>;
  const digest = r["bundle_sha256"];
  const reviewer = typeof r["reviewer"] === "string" ? r["reviewer"].trim() : "";
  if (r["schema"] !== "studium-approval/1" || typeof digest !== "string" || !reviewer) return { state: "none" };
  return digest === lessonSha256 ? { state: "approved", reviewer: reviewer.slice(0, 200) } : { state: "changed" };
}

/** The approval state in the reader's language: the line shown by the picker and the tree tooltip. */
export function approvalLabel(approval: ApprovalState, locale: Locale = "fr"): string {
  if (approval.state === "approved") return hostPhrase("approval_by", { reviewer: approval.reviewer }, locale);
  return hostPhrase(approval.state === "changed" ? "approval_changed" : "approval_none", {}, locale);
}

/** Discover valid courses from an injected, host-independent directory snapshot. */
export function discoverCourses(entries: readonly LessonDirectoryEntry[]): LessonCourse[] {
  const courses: LessonCourse[] = [];
  for (const entry of entries) {
    const ref = normalizeRef(entry.ref);
    if (!isSupportedLessonRef(ref)) continue;
    const sha256 = entry.sha256 ?? createHash("sha256").update(entry.contents, "utf8").digest("hex");
    const course = parseCourse(ref, entry.contents, parseApprovalState(entry.approvalText, sha256));
    if (course) courses.push(course);
  }
  return courses.sort((left, right) => left.ref.localeCompare(right.ref));
}

/** Read a bundles root through a thin, injectable filesystem adapter, bounded to two directories deep. */
export function listLessonDirectory(
  bundlesRoot: string,
  fileSystem: LessonFileSystem = NODE_FILE_SYSTEM,
): LessonDirectoryEntry[] {
  const entries: LessonDirectoryEntry[] = [];
  collectLessonFiles(bundlesRoot, "", 0, fileSystem, entries);
  return entries;
}

/** Discover courses from a real bundles root using the thin filesystem adapter. */
export function discoverCoursesInRoot(
  bundlesRoot: string,
  fileSystem: LessonFileSystem = NODE_FILE_SYSTEM,
): LessonCourse[] {
  return discoverCourses(listLessonDirectory(bundlesRoot, fileSystem));
}

/** Shape courses for VS Code's QuickPick without importing vscode. */
export function toLessonPickItems(courses: readonly LessonCourse[], locale: Locale = "fr"): LessonPickItem[] {
  return courses.map((course) => ({
    label: course.title,
    description: courseDescription(course),
    detail: `${course.ref} · ${approvalLabel(course.approval, locale)}`,
    ref: course.ref,
  }));
}

/** Add the always-available folder action to the pure course choices. */
export function toLessonPickerChoices(
  courses: readonly LessonCourse[],
  bundlesRoot: string,
  locale: Locale = "fr",
): LessonPickerChoice[] {
  const courseChoices = toLessonPickItems(courses, locale).map((item) => ({ ...item, action: "course" as const }));
  return [...courseChoices, {
    label: phrase("picker_folder", {}, locale),
    description: phrase("picker_folder_description", {}, locale),
    detail: bundlesRoot,
    action: "folder",
  }];
}

/** Render the compact target/language description shared by the tree and picker. */
export function courseDescription(course: LessonCourse): string {
  return `${course.target} · ${course.language}`;
}

/** Decide whether Open Lesson must hand off to the picker instead of starting a missing/default ref. */
export function needsLessonPicker(
  configuredRef: string | undefined,
  exists: (bundleRef: string) => boolean,
): boolean {
  const bundleRef = configuredRef?.trim();
  return !bundleRef || !exists(bundleRef);
}

function collectLessonFiles(
  root: string,
  relativeDirectory: string,
  depth: number,
  fileSystem: LessonFileSystem,
  output: LessonDirectoryEntry[],
): void {
  for (const entry of safeReadDirectory(join(root, relativeDirectory), fileSystem)) {
    if (entry.isDirectory && !IGNORED_DIRECTORIES.has(entry.name) && depth < MAX_DIRECTORY_DEPTH) {
      collectLessonFiles(root, appendRef(relativeDirectory, entry.name), depth + 1, fileSystem, output);
      continue;
    }
    const ref = appendRef(relativeDirectory, entry.name);
    if (!entry.isFile || !isSupportedLessonRef(ref)) continue;
    const file = join(root, relativeDirectory, entry.name);
    const bytes = safeReadBytes(file, fileSystem);
    const contents = bytes ? Buffer.from(bytes).toString("utf8") : safeReadText(file, fileSystem);
    if (contents === undefined) continue;
    const sha256 = createHash("sha256").update(bytes ?? Buffer.from(contents, "utf8")).digest("hex");
    // The server looks for `approval.json` in the lesson file's own folder, whatever the file is called.
    const approvalText = safeReadText(join(root, relativeDirectory, "approval.json"), fileSystem);
    output.push(approvalText === undefined ? { ref, contents, sha256 } : { ref, contents, sha256, approvalText });
  }
}

function safeReadDirectory(directory: string, fileSystem: LessonFileSystem): readonly FileSystemEntry[] {
  try {
    return [...fileSystem.readDirectory(directory)].sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function safeReadText(file: string, fileSystem: LessonFileSystem): string | undefined {
  try {
    return fileSystem.readText(file);
  } catch {
    return undefined;
  }
}

function safeReadBytes(file: string, fileSystem: LessonFileSystem): Uint8Array | undefined {
  try {
    return fileSystem.readBytes?.(file);
  } catch {
    return undefined;
  }
}

function parseCourse(ref: string, contents: string, approval: ApprovalState): LessonCourse | null {
  try {
    const bundle = JSON.parse(contents) as Record<string, unknown>;
    const metadata = bundle.metadata as Record<string, unknown> | undefined;
    if (!metadata) return null;
    const title = requiredText(metadata.title);
    const target = requiredText(metadata.target);
    const language = requiredText(metadata.language);
    if (!title || !target || !language) return null;
    return { ref, title, target, language, approval };
  } catch {
    return null;
  }
}

function requiredText(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}

function isSupportedLessonRef(ref: string): boolean {
  const parts = ref.split("/");
  if (parts.some((part) => !part || part === ".." || IGNORED_DIRECTORIES.has(part))) return false;
  if (parts.length === 1) return parts[0]!.toLowerCase().endsWith(".json");
  return parts.length <= MAX_DIRECTORY_DEPTH + 1 && parts.at(-1) === "lesson.json";
}

function normalizeRef(ref: string): string {
  return ref.replace(/\\/g, "/").replace(/^\.\//, "");
}

function appendRef(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}
