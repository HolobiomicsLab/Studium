// community.ts — learner-facing "Contributions de la classe / Community contributions" discovery.
//
// A3 — wire approved community bundles into the live student runtime. After a teacher
// decide_item-approves a learner-authored item, the scene-synth emit path writes a single-scene
// `community-<item_id>.zip` into `<courseRoot>/community/` (services/scene-synth/learner_review.py,
// community_emit_dir()). The TS runtime's discoverCommunityBundles(courseRoot) scans that same
// `community/` subdir. This module is the EXTENSION's thin, host-independent mirror of that one
// discovery convention, plus the picker-item shaping — so the command logic is unit-testable from a
// tsx driver with no VS Code host and no MCP server.
//
// The canonical course is NEVER mutated: community bundles are SEPARATE files in a sibling subdir.
// A chosen community ref is opened through the SAME open-bundle path as the canonical bundle
// (extension.ts overrides studium.bundleRef with the community ref and reuses openLesson).
//
// Kept dep-free (esbuild only bundles vscode + the MCP SDK + typed-graph-lens) — discovery here
// mirrors discoverCommunityBundles (community-bundles.ts) the same way host.ts mirrors fsrs.ts; we
// cannot import @studium/lesson-session-host (a dep we must not add) into the extension bundle.

import { readdirSync } from "node:fs";
import { join, posix } from "node:path";

/** The per-course subdir holding approved community bundles, alongside the canonical bundle.
 * MIRRORS COMMUNITY_DIR in packages/lesson-session-host/src/community-bundles.ts AND
 * services/scene-synth/learner_review.py — keep the literal in lockstep across all three. */
export const COMMUNITY_DIR = "community";

const COMMUNITY_PREFIX = "community-";

/** A discovered community-bundle entry: a runtime `ref` (relative to the COURSE bundles root, so it
 * loads through the unchanged resolveBundle / start_lesson_session path) plus the bare item id. */
export interface CommunityBundle {
  /** e.g. "atomistique-l1/community/community-<item>.zip" — directly usable as a bundle_ref. */
  ref: string;
  /** the `<item_id>` parsed out of `community-<item_id>.zip`. */
  itemId: string;
}

/** True only for the decide_item naming convention `community-<id>.zip`; hidden/temp files
 * (leading dot: ".DS_Store", ".community-*.tmp.zip") and other extensions are excluded. */
export function isCommunityBundleFile(name: string): boolean {
  if (name.startsWith(".")) return false;
  return name.startsWith(COMMUNITY_PREFIX) && name.endsWith(".zip");
}

/** The course bundles root for the bound course = the dir holding the canonical lesson.json.
 * Given the runtime `bundlesRoot` (BUNDLES_ROOT) and the canonical `bundleRef`
 * ("<courseDir>/lesson.json"), the course root segment is `dirname(bundleRef)` (POSIX-style refs).
 * Returns the relative course dir (may be "." when the canonical bundle sits at the root). */
export function courseDirOf(bundleRef: string): string {
  return posix.dirname(bundleRef.replace(/\\/g, "/"));
}

/**
 * Discover the approved community bundles for the bound course.
 *
 * `bundlesRoot` is the runtime BUNDLES_ROOT; `bundleRef` is the canonical bundle ref
 * ("<courseDir>/lesson.json"). Scans `<bundlesRoot>/<courseDir>/community/` for `community-*.zip`,
 * skipping hidden/temp files and other extensions, and returns refs RELATIVE to `bundlesRoot` so
 * each feeds straight into `start_lesson_session({ bundle_ref })` exactly like the canonical bundle.
 * A course with no `community/` subdir (canonical-only) returns []. Deterministically sorted.
 *
 * Pure except for the `readdir` injected via `opts.readdir` (defaults to node:fs readdirSync) so a
 * unit test can drive it with an in-memory directory listing.
 */
export function discoverCommunityBundles(
  bundlesRoot: string,
  bundleRef: string,
  opts: { readdir?: (dir: string) => string[] } = {},
): CommunityBundle[] {
  const readdir = opts.readdir ?? ((dir: string) => readdirSync(dir));
  const courseDir = courseDirOf(bundleRef);
  const communityFsDir = join(bundlesRoot, courseDir, COMMUNITY_DIR);
  let names: string[];
  try {
    names = readdir(communityFsDir);
  } catch {
    // No community/ subdir (or unreadable) → canonical-only course.
    return [];
  }
  const out: CommunityBundle[] = [];
  for (const name of names) {
    if (!isCommunityBundleFile(name)) continue;
    const itemId = name.slice(COMMUNITY_PREFIX.length, -".zip".length);
    // refs are joined with the course dir using POSIX separators (bundle refs are POSIX-style),
    // collapsing a "." course dir so the root case yields "community/<name>".
    const ref = courseDir === "." ? `${COMMUNITY_DIR}/${name}` : `${courseDir}/${COMMUNITY_DIR}/${name}`;
    out.push({ ref, itemId });
  }
  out.sort((a, b) => a.ref.localeCompare(b.ref));
  return out;
}

/** One VS Code QuickPick item for a community bundle. `label` is learner-facing; `ref` is the
 * bundle_ref the command opens. No author identity is ever surfaced (the emitted bundle is already
 * pseudonym-scrubbed); only the neutral item id is shown. */
export interface CommunityPickItem {
  label: string;
  description: string;
  ref: string;
  itemId: string;
}

/** Shape discovered community bundles into bilingual QuickPick items (FR-leading, per the UI).
 * Pure + host-independent so the command logic is unit-testable without a VS Code window. */
export function toPickItems(bundles: readonly CommunityBundle[]): CommunityPickItem[] {
  return bundles.map((b, i) => ({
    label: `Contribution de la classe ${i + 1}`,
    description: `${b.itemId} — proposée par un·e camarade (community contribution)`,
    ref: b.ref,
    itemId: b.itemId,
  }));
}
