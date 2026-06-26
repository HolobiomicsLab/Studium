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
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** The per-course subdirectory holding community (learner-authored, approved) bundles,
 * alongside the canonical bundle in the bundles root. */
export const COMMUNITY_DIR = "community";

/** Filename prefix decide_item() uses for an emitted community bundle: `community-<item_id>.zip`. */
const COMMUNITY_PREFIX = "community-";

function isCommunityBundleFile(name: string): boolean {
  // Ignore hidden/temp files (a leading dot: ".DS_Store", ".community-*.zip", "._foo"). Only the
  // decide_item naming convention (community-<id>.zip) counts; "notes.txt" / "lesson.json" do not.
  if (name.startsWith(".")) return false;
  return name.startsWith(COMMUNITY_PREFIX) && name.endsWith(".zip");
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
  const dir = join(bundlesRoot, COMMUNITY_DIR);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // No community/ subdir (or unreadable) → no community bundles. Canonical course is intact.
    return [];
  }
  const refs: string[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!isCommunityBundleFile(e.name)) continue;
    refs.push(`${COMMUNITY_DIR}/${e.name}`);
  }
  refs.sort();
  return refs;
}
