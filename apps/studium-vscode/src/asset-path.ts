// asset-path.ts — pure helpers for rendering a figure render-asset (executed_result / image) in the
// notebook surface. Kept separate from notebook.ts so the path + MIME logic is unit-testable without
// the VS Code Extension Host (notebook.ts itself uses vscode.* and is type-checked only).
import { isAbsolute, resolve, dirname } from "node:path";

/** Resolve a render-asset `path`: an absolute path is used as-is; a relative one (e.g. "decay.png") is
 * resolved against the bundle directory (`<bundlesRoot>/<dirname(bundleRef)>`), where the asset lives. */
export function assetPathFor(bundlesRoot: string, bundleRef: string, p: string): string {
  return isAbsolute(p) ? p : resolve(bundlesRoot, dirname(bundleRef), p);
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
