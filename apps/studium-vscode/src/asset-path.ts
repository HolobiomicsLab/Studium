// asset-path.ts — shared helpers for rendering image/executed_result assets in the notebook and pane.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

type ImageAsset = { kind?: string | undefined; path?: string | undefined; [key: string]: unknown };

function isInside(baseDir: string, candidate: string): boolean {
  const rel = relative(baseDir, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Resolve a readable asset under the selected bundle's canonical directory.
 * Relative and in-bundle absolute paths are accepted; missing files and lexical/symlink escapes throw. */
export function assetPathFor(bundlesRoot: string, bundleRef: string, p: string): string {
  const bundleDir = realpathSync(resolve(bundlesRoot, dirname(bundleRef)));
  const candidate = isAbsolute(p) ? p : resolve(bundleDir, p);
  const canonical = realpathSync(candidate);
  if (!isInside(bundleDir, canonical)) throw new Error("figure path escapes selected bundle");
  return canonical;
}

/** Best-effort image MIME from a file extension (defaults to PNG). */
export function imageMime(p: string): string {
  const e = p.toLowerCase();
  if (e.endsWith(".svg")) return "image/svg+xml";
  if (e.endsWith(".jpg") || e.endsWith(".jpeg")) return "image/jpeg";
  if (e.endsWith(".gif")) return "image/gif";
  if (e.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/** Inline an image-like render asset for the lesson pane. Unreadable or out-of-bundle paths remain
 * unchanged so the renderer can show its existing graceful fallback. */
export function inlineImageAsset<T extends ImageAsset>(bundlesRoot: string, bundleRef: string, asset: T): T & { dataUri?: string } {
  if (!asset.path || (asset.kind !== "image" && asset.kind !== "executed_result")) return asset;
  try {
    const path = assetPathFor(bundlesRoot, bundleRef, asset.path);
    const payload = readFileSync(path).toString("base64");
    return { ...asset, dataUri: `data:${imageMime(path)};base64,${payload}` };
  } catch {
    return asset;
  }
}
