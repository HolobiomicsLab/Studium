// packages/lesson-session-host/src/bundle-resolver.ts  (moved verbatim)
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { loadBundleZip, loadBundleJson } from "@studium/lesson-session/node";

export async function resolveBundle(bundlesRoot: string, ref: string): Promise<LessonBundle> {
  const root = resolve(bundlesRoot);
  const full = resolve(root, ref);
  const rel = relative(root, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`bundle_ref escapes bundles root: ${ref}`);
  }
  if (full.endsWith(".json")) return loadBundleJson(JSON.parse(await readFile(full, "utf8")));
  return loadBundleZip(full);
}
