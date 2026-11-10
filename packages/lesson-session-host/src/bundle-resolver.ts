// packages/lesson-session-host/src/bundle-resolver.ts
//
// Turn a bundle_ref into a loaded lesson. A ref is looked up in each root in order — the configured
// bundles root, then the learner's library (C6) — and read from disk on every call, so a lesson
// written into the library after the server started plays without a restart. Each root confines its
// own lookups: a ref that leaves the root lexically, or through a symlink, is refused. Errors name
// the ref the caller gave, never an absolute path, and a missing lesson suggests the closest refs.
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname, join } from "node:path";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { BundleSchemaError, readBundleZip, loadBundleJson } from "@studium/lesson-session/node";
import { approvalOfZip, readApproval, type ApprovalStatus } from "./authoring.js";
import { shuffleQuizChoices } from "./shuffle-choices.js";
import { scanCatalog, nearestRefs, learnerMinutesPerDay } from "./lesson-catalog.js";

export interface ResolvedBundle {
  bundle: LessonBundle;
  /** The root the ref was found under. */
  root: string;
  /** Absolute path of the lesson file (a lesson.json or a .zip). */
  path: string;
  /** Folder relative render-asset paths resolve against: the lesson.json folder; "" for a .zip. */
  baseDir: string;
  /** sha256 of the lesson.json bytes (for a .zip, of its lesson.json member), binding an approval
   * record (C5). */
  sha256: string | null;
  /** C5: the approval record bound to those bytes — `approval.json` next to a lesson.json, or the
   * `approval.json` member of a .zip — read fail-safe (none, malformed or foreign reads as none). */
  approval: ApprovalStatus;
  /** RFR-06: the learner's minutes a day kept in the lesson file (learnerMinutesPerDay); null when none. */
  minutesPerDay: number | null;
}

/** The on-disk directory a bundle's relative render-asset paths (e.g. "assets/orbitals/2pz.cube")
 * resolve against — the folder holding lesson.json for a directory bundle. "" for a .zip bundle
 * (its assets live inside the archive, not on disk). */
export function assetBaseDir(bundlesRoot: string, ref: string): string {
  const full = resolve(resolve(bundlesRoot), ref);
  return full.endsWith(".json") ? dirname(full) : "";
}

function escapes(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel);
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

/** The first root holding `ref` (a lesson file, or a course folder holding lesson.json). */
async function locate(roots: readonly string[], ref: string): Promise<{ root: string; path: string }> {
  let insideSomeRoot = false;
  for (const configured of roots) {
    const root = resolve(configured);
    let full = resolve(root, ref);
    if (escapes(root, full)) continue;
    insideSomeRoot = true;
    if (await isDirectory(full)) full = join(full, "lesson.json");
    if (!(await isFile(full))) continue;
    // Lexically inside, but a symlink may still point out of the root: compare canonical paths.
    if (escapes(await realpath(root), await realpath(full))) throw new Error(`bundle_ref escapes bundles root: ${ref}`);
    return { root, path: full };
  }
  if (!insideSomeRoot) throw new Error(`bundle_ref escapes bundles root: ${ref}`);
  throw await notFound(roots, ref);
}

async function notFound(roots: readonly string[], ref: string): Promise<Error> {
  const catalog = await scanCatalog(roots.map((dir) => ({ kind: "bundles" as const, dir })));
  const closest = nearestRefs(ref, catalog.lessons.map((lesson) => lesson.bundle_ref));
  const hint = closest.length ? ` — closest: ${closest.join(", ")}` : "";
  return new Error(`lesson not found: ${ref}${hint}; call list_lessons for the available lessons`);
}

/** One line naming the first schema problem and what to change (the loader's BundleSchemaError,
 * RT-7), instead of a whole zod dump. */
function invalidLesson(ref: string, error: unknown): Error {
  if (error instanceof BundleSchemaError) return new Error(`lesson ${ref} does not match the bundle schema: ${error.message}`);
  return new Error(`lesson ${ref} could not be loaded`);
}

/** Locate `ref` across `roots`, load and validate it, and shuffle its quiz choices. */
export async function loadResolvedBundle(
  roots: string | readonly string[], ref: string, seedSalt = "",
): Promise<ResolvedBundle> {
  const { root, path } = await locate(typeof roots === "string" ? [roots] : roots, ref);
  let bundle: LessonBundle;
  let sha256: string | null = null;
  let minutesPerDay: number | null = null;
  let approval: ApprovalStatus;
  if (path.endsWith(".json")) {
    const bytes = await readFile(path);
    sha256 = createHash("sha256").update(bytes).digest("hex");
    let raw: unknown;
    try { raw = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error(`lesson ${ref} is not valid JSON`); }
    try { bundle = loadBundleJson(raw); }
    catch (error) { throw invalidLesson(ref, error); }
    minutesPerDay = learnerMinutesPerDay(raw) ?? null;
    approval = await readApproval(dirname(path), sha256);
  } else {
    let zip;
    try { zip = await readBundleZip(path); }
    catch (error) { throw error instanceof BundleSchemaError ? invalidLesson(ref, error) : new Error(`lesson ${ref} could not be read as a bundle archive`); }
    bundle = zip.bundle;
    sha256 = createHash("sha256").update(zip.lessonBytes).digest("hex");
    approval = approvalOfZip(zip.approvalText, sha256);
  }
  // Anti-leak: permute + re-letter quiz choices so the correct answer is not always first/"a".
  // Deterministic per scene id (+ optional per-learner salt), so grading and replay stay
  // reproducible. See shuffle-choices.ts.
  return {
    bundle: shuffleQuizChoices(bundle, seedSalt),
    root,
    path,
    baseDir: path.endsWith(".json") ? dirname(path) : "",
    sha256,
    approval,
    minutesPerDay,
  };
}

export async function resolveBundle(
  bundlesRoot: string | readonly string[], ref: string, seedSalt = "",
): Promise<LessonBundle> {
  return (await loadResolvedBundle(bundlesRoot, ref, seedSalt)).bundle;
}
