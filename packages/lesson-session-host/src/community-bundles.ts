// packages/lesson-session-host/src/community-bundles.ts
//
// P4 — multi-bundle discovery. A course's bundles root holds the IMMUTABLE canonical
// bundle (lesson.json / a .zip) PLUS a `community/` subdirectory of single-scene ZIPs
// emitted by the scene-synth `decide_item()` approve branch, one per approved learner
// item, named `community-<item_id>.zip`. The canonical course is NEVER mutated:
// community bundles are SEPARATE files in a sibling subdir.
//
// discoverCommunityBundles() enumerates ONLY those community ZIPs and returns refs
// RELATIVE to the bundles root, so each ref feeds straight into the unchanged
// `resolveBundle(bundlesRoot, ref)` — a runtime loads a community bundle exactly the
// way it loads the canonical one. resolveBundle keeps its path-traversal guard; the
// canonical path is unaffected.
//
// A bundles root may also hold several courses, one directory each (`<course_id>/lesson.json`,
// scene-synth emitting into `<course_id>/community/`). discoverCommunityBundleEntries() lists
// those per course, plus the legacy root-level `community/`, for list_community_bundles.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** The per-course subdirectory holding community (learner-authored, approved) bundles,
 * alongside the canonical bundle in the bundles root. */
export const COMMUNITY_DIR = "community";

/** Filename prefix decide_item() uses for an emitted community bundle: `community-<item_id>.zip`. */
const COMMUNITY_PREFIX = "community-";
const ZIP_SUFFIX = ".zip";

/** A course id is a directory name under the bundles root (same contract as scene-synth). */
export const COURSE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** One community bundle as list_community_bundles reports it. */
export interface CommunityBundleEntry {
  /** Relative to the bundles root; passes unchanged to `SessionHost.create` / start_lesson_session. */
  bundle_ref: string;
  /** The course directory it extends, or null for the legacy root-level `community/`. */
  course_id: string | null;
  /** The `<item_id>` of `community-<item_id>.zip`. */
  item_id: string;
}

function isCommunityBundleFile(name: string): boolean {
  // Ignore hidden/temp files (a leading dot: ".DS_Store", ".community-*.zip", "._foo"). Only the
  // decide_item naming convention (community-<id>.zip) counts; "notes.txt" / "lesson.json" do not.
  if (name.startsWith(".")) return false;
  return name.startsWith(COMMUNITY_PREFIX) && name.endsWith(ZIP_SUFFIX);
}

/** The community bundle file names directly inside `dir`, sorted; [] when `dir` is absent. */
async function communityFileNames(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // No community/ subdir (or unreadable) → no community bundles. Canonical course is intact.
    return [];
  }
  return entries.filter((e) => e.isFile() && isCommunityBundleFile(e.name)).map((e) => e.name).sort();
}

/**
 * Enumerate the community bundle refs for a course rooted at `bundlesRoot`.
 *
 * Returns refs RELATIVE to `bundlesRoot` (e.g. "community/community-<item_id>.zip"), each
 * directly loadable via `resolveBundle(bundlesRoot, ref)`. The canonical bundle and any
 * hidden/temp or non-`community-*.zip` file are excluded. A course with no `community/`
 * subdir returns `[]` (canonical-only). Results are sorted for deterministic ordering.
 */
export async function discoverCommunityBundles(bundlesRoot: string): Promise<string[]> {
  const names = await communityFileNames(join(bundlesRoot, COMMUNITY_DIR));
  return names.map((name) => `${COMMUNITY_DIR}/${name}`);
}

/**
 * List the community bundles under `bundlesRoot`, sorted by `bundle_ref`.
 *
 * With `courseId`: only `<courseId>/community/` ([] when the course or its community/ is absent).
 * Without: the legacy root-level `community/` (course_id null) plus the `community/` of every
 * depth-1 directory whose name is a course id (hidden and other directories are skipped).
 * Throws when `courseId` does not match COURSE_ID_PATTERN.
 */
export async function discoverCommunityBundleEntries(
  bundlesRoot: string,
  courseId?: string,
): Promise<CommunityBundleEntry[]> {
  if (courseId !== undefined) {
    if (!COURSE_ID_PATTERN.test(courseId)) {
      throw new Error(`invalid course_id ${JSON.stringify(courseId)}: expected ${COURSE_ID_PATTERN.source}`);
    }
    return entriesOf(bundlesRoot, courseId);
  }
  const courses = await courseDirectories(bundlesRoot);
  const lists = await Promise.all([null, ...courses].map((course) => entriesOf(bundlesRoot, course)));
  return lists.flat().sort((a, b) => (a.bundle_ref < b.bundle_ref ? -1 : a.bundle_ref > b.bundle_ref ? 1 : 0));
}

/** The entries of one course's community/ (null = the legacy root-level one). */
async function entriesOf(bundlesRoot: string, courseId: string | null): Promise<CommunityBundleEntry[]> {
  const dir = courseId === null ? COMMUNITY_DIR : `${courseId}/${COMMUNITY_DIR}`;
  const names = await communityFileNames(join(bundlesRoot, dir));
  return names.map((name) => ({
    bundle_ref: `${dir}/${name}`,
    course_id: courseId,
    item_id: name.slice(COMMUNITY_PREFIX.length, -ZIP_SUFFIX.length),
  }));
}

/** Depth-1 directories of `bundlesRoot` whose names are course ids; [] when the root is unreadable. */
async function courseDirectories(bundlesRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(bundlesRoot, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && COURSE_ID_PATTERN.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}
