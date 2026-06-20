// packages/lesson-session-host/src/bundle-resolver.ts  (moved verbatim)
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { loadBundleZip, loadBundleJson } from "@studium/lesson-session/node";
import { shuffleQuizChoices } from "./shuffle-choices.js";

/** The on-disk directory a bundle's relative render-asset paths (e.g. "assets/orbitals/2pz.cube")
 * resolve against — the folder holding lesson.json for a directory bundle. "" for a .zip bundle
 * (its assets live inside the archive, not on disk). */
export function assetBaseDir(bundlesRoot: string, ref: string): string {
  const full = resolve(resolve(bundlesRoot), ref);
  return full.endsWith(".json") ? dirname(full) : "";
}

export async function resolveBundle(bundlesRoot: string, ref: string, seedSalt = ""): Promise<LessonBundle> {
  const root = resolve(bundlesRoot);
  const full = resolve(root, ref);
  const rel = relative(root, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`bundle_ref escapes bundles root: ${ref}`);
  }
  const bundle = full.endsWith(".json")
    ? loadBundleJson(JSON.parse(await readFile(full, "utf8")))
    : await loadBundleZip(full);
  // Anti-leak: permute + re-letter quiz choices so the correct answer is not always first/"a".
  // Deterministic per scene id (+ optional per-learner salt), so grading and replay stay
  // reproducible. See shuffle-choices.ts.
  return shuffleQuizChoices(bundle, seedSalt);
}
