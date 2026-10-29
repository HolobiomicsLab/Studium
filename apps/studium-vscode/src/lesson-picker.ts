// lesson-picker.ts — host-independent course discovery and QuickPick shaping.
// VS Code orchestration stays in extension.ts; this module is driver-tested without a VS Code host.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);
const MAX_DIRECTORY_DEPTH = 2;

/** One candidate JSON file from a bounded directory snapshot. `ref` uses bundle-style POSIX separators. */
export interface LessonDirectoryEntry {
  ref: string;
  contents: string;
}

/** Course metadata shown in the Studium tree and picker. */
export interface LessonCourse {
  ref: string;
  title: string;
  target: string;
  language: string;
  validatedBy: string;
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
}

const NODE_FILE_SYSTEM: LessonFileSystem = {
  readDirectory: (directory) => readdirSync(directory, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    isFile: entry.isFile(),
  })),
  readText: (file) => readFileSync(file, "utf8"),
};

/** Discover valid courses from an injected, host-independent directory snapshot. */
export function discoverCourses(entries: readonly LessonDirectoryEntry[]): LessonCourse[] {
  const courses: LessonCourse[] = [];
  for (const entry of entries) {
    const ref = normalizeRef(entry.ref);
    if (!isSupportedLessonRef(ref)) continue;
    const course = parseCourse(ref, entry.contents);
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
export function toLessonPickItems(courses: readonly LessonCourse[]): LessonPickItem[] {
  return courses.map((course) => ({
    label: course.title,
    description: courseDescription(course),
    detail: `${course.ref} · validated_by: ${course.validatedBy}`,
    ref: course.ref,
  }));
}

/** Add the always-available folder action to the pure course choices. */
export function toLessonPickerChoices(
  courses: readonly LessonCourse[],
  bundlesRoot: string,
): LessonPickerChoice[] {
  const courseChoices = toLessonPickItems(courses).map((item) => ({ ...item, action: "course" as const }));
  return [...courseChoices, {
    label: "$(folder-opened) Choisir un autre dossier de cours… / Choose another bundles root…",
    description: "Changer studium.bundlesRoot",
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
    const contents = safeReadText(join(root, relativeDirectory, entry.name), fileSystem);
    if (contents !== undefined) output.push({ ref, contents });
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

function parseCourse(ref: string, contents: string): LessonCourse | null {
  try {
    const bundle = JSON.parse(contents) as Record<string, unknown>;
    const metadata = bundle.metadata as Record<string, unknown> | undefined;
    if (!metadata) return null;
    const title = requiredText(metadata.title);
    const target = requiredText(metadata.target);
    const language = requiredText(metadata.language);
    if (!title || !target || !language) return null;
    const validatedBy = requiredText(bundle.validated_by) ?? "non renseigné / not specified";
    return { ref, title, target, language, validatedBy };
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
