// packages/lesson-session-host/src/lesson-catalog.ts
//
// The lessons a learner can open, found on disk at call time (HJ-5). Walked fresh on every call, so a
// lesson written into the library after the server started is listed without a restart.
//
// Same rules as the VS Code pane's lesson picker (apps/studium-vscode/src/lesson-picker.ts): a
// top-level *.json bundle, or a lesson.json at most two folders deep; node_modules, dist and dot
// folders are never entered. Two host-side additions: folders holding learner data or authoring
// inputs (`data`, `_sources`, `community` — community bundles have their own tool) are skipped, and
// so is any directory passed in `exclude` (the configured data dir may sit inside a root).
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CourseSchema, type Course, type AuthoringMode } from "@studium/lesson-bundle-schema";
import { loadBundleJson } from "@studium/lesson-session/node";
import { draftedByOf, isTeacherValidated, type DraftedBy } from "./authoring.js";

export type RootKind = "bundles" | "library";
export interface LessonRoot { kind: RootKind; dir: string }

export interface CatalogLesson {
  /** POSIX path relative to its root; passes unchanged to start_lesson_session. */
  bundle_ref: string;
  root: RootKind;
  bundle_id: string;
  title: string;
  language: string;
  discipline: string;
  authoring: { mode: AuthoringMode; drafted_by: DraftedBy };
  validated: boolean;
  concepts: Array<{ id: string; title: string }>;
  scene_count: number;
  /** File modification time (epoch ms): the most recent lesson of the library comes first. */
  modified_at: number;
}

export interface CatalogCourse { course_ref: string; root: RootKind; course: Course }

export interface Catalog {
  lessons: CatalogLesson[];
  courses: CatalogCourse[];
  /** Files named like a lesson that do not load (invalid JSON or schema): not playable. */
  skipped: number;
}

const MAX_DEPTH = 2;
const MAX_FILES = 2000;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "data", "_sources", "community"]);

export async function scanCatalog(
  roots: readonly LessonRoot[],
  opts: { exclude?: readonly string[] } = {},
): Promise<Catalog> {
  const catalog: Catalog = { lessons: [], courses: [], skipped: 0 };
  const excluded = new Set((opts.exclude ?? []).map((dir) => resolve(dir)));
  const seenRoots = new Set<string>();
  for (const root of roots) {
    const dir = resolve(root.dir);
    if (seenRoots.has(dir)) continue; // BUNDLES_ROOT may be the library itself
    seenRoots.add(dir);
    const files: string[] = [];
    await collectJsonFiles(dir, "", 0, excluded, files);
    for (const ref of files) await readEntry(dir, ref, root.kind, catalog);
  }
  return catalog;
}

async function collectJsonFiles(
  root: string, relDir: string, depth: number, excluded: Set<string>, out: string[],
): Promise<void> {
  let entries;
  try { entries = await readdir(join(root, relDir), { withFileTypes: true }); }
  catch { return; } // a missing root (fresh install) or an unreadable folder lists nothing
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const ref = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (depth >= MAX_DEPTH || entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue;
      if (excluded.has(resolve(root, ref))) continue;
      await collectJsonFiles(root, ref, depth + 1, excluded, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      out.push(ref);
    }
  }
}

async function readEntry(root: string, ref: string, kind: RootKind, catalog: Catalog): Promise<void> {
  const lessonCandidate = !ref.includes("/") || ref.endsWith("/lesson.json");
  let raw: unknown;
  try { raw = JSON.parse(await readFile(join(root, ref), "utf8")); }
  catch { if (ref.endsWith("lesson.json")) catalog.skipped += 1; return; }
  if (isCourseLike(raw)) {
    const parsed = CourseSchema.safeParse(raw);
    if (parsed.success) catalog.courses.push({ course_ref: ref, root: kind, course: parsed.data });
    return;
  }
  if (!lessonCandidate || !isBundleLike(raw)) return;
  try {
    const bundle = loadBundleJson(raw);
    catalog.lessons.push({
      bundle_ref: ref,
      root: kind,
      bundle_id: bundle.bundle_id,
      title: bundle.metadata.title,
      language: bundle.metadata.language,
      discipline: bundle.metadata.discipline,
      authoring: { mode: bundle.metadata.authoring?.mode ?? "teacher", drafted_by: draftedByOf(bundle.metadata) },
      validated: isTeacherValidated(bundle.validated_by),
      concepts: bundle.concepts.map((c) => ({ id: c.id, title: c.title })),
      scene_count: bundle.scenes.length,
      modified_at: (await stat(join(root, ref))).mtimeMs,
    });
  } catch { catalog.skipped += 1; }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isCourseLike(v: unknown): boolean {
  return isRecord(v) && typeof v["course_id"] === "string" && Array.isArray(v["lessons"]);
}
function isBundleLike(v: unknown): boolean {
  return isRecord(v) && typeof v["bundle_id"] === "string" && Array.isArray(v["scenes"]);
}

/** Words of a ref, minus the parts every lesson shares. */
function refTokens(ref: string): string[] {
  return ref.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && t !== "lesson" && t !== "json");
}

/**
 * The refs closest to a ref that does not exist, best first, for a not-found error: a ref scores by
 * the requested words it shares (a word matches when one contains the other, from 3 letters), ties
 * broken by the share of the ref's own words that matched. Refs sharing nothing are left out.
 */
export function nearestRefs(wanted: string, refs: readonly string[], limit = 3): string[] {
  const asked = refTokens(wanted);
  const matches = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)));
  return refs
    .map((ref) => {
      const own = refTokens(ref);
      const shared = asked.filter((t) => own.some((o) => matches(t, o))).length;
      return { ref, shared, ratio: own.length ? shared / own.length : 0 };
    })
    .filter((r) => r.shared > 0)
    .sort((a, b) => b.shared - a.shared || b.ratio - a.ratio || a.ref.localeCompare(b.ref))
    .slice(0, limit)
    .map((r) => r.ref);
}
