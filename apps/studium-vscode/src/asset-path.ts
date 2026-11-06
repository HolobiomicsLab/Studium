// asset-path.ts — shared helpers for rendering image/executed_result assets in the notebook and pane.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

type ImageAsset = { kind?: string; path?: string; [key: string]: unknown };
type EquationAsset = {
  kind?: string;
  title?: unknown;
  payload?: unknown;
  legend?: unknown;
};

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

/** Markdown for the notebook's native equation renderer, including the authored symbol legend. */
export function equationAssetMarkdown(asset: EquationAsset): string {
  if (asset.kind !== "equation_latex" || typeof asset.payload !== "string" || !asset.payload) return "";
  const title = typeof asset.title === "string" && asset.title ? asset.title : asset.kind;
  const legend = Array.isArray(asset.legend)
    ? asset.legend.flatMap((entry) => entry && typeof entry === "object"
      && typeof (entry as { symbol?: unknown }).symbol === "string"
      && typeof (entry as { meaning?: unknown }).meaning === "string"
      ? [`- ${(entry as { symbol: string }).symbol} : ${(entry as { meaning: string }).meaning}`] : [])
    : [];
  return [`**${title}**`, `$$\n${asset.payload}\n$$`, legend.join("\n")].filter(Boolean).join("\n\n");
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
