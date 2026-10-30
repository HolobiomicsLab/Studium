// lesson-uri.ts — VSC-7 / C7: turn the learner's "open this lesson" intent into a bundles root + bundle
// ref, whether it comes from vscode://holobiomicslab.studium-vscode/open?bundle=<path of lesson.json>
// (a harness runs `code --open-url …`) or from the explorer's "Open this lesson" on a lesson.json.
// Pure: file existence is injected, so a driver can test every refusal without a disk.
import { basename, dirname, isAbsolute } from "node:path";
import type { HostPhraseKey } from "./host-phrases.js";

export interface LessonLocation { bundlesRoot: string; bundleRef: string; }

export type OpenLessonResult =
  | ({ ok: true } & LessonLocation)
  | { ok: false; error: { key: HostPhraseKey; path?: string } };

/** Split the path of a lesson file into the BUNDLES_ROOT the server resolves against and the ref inside
 * it: `<root>/<course>/lesson.json` → (`<root>`, `<course>/lesson.json`); any other json sitting directly
 * in a folder → (that folder, its file name), the layout course discovery also accepts. */
export function lessonLocation(lessonPath: string): LessonLocation {
  const folder = dirname(lessonPath);
  if (basename(lessonPath) === "lesson.json") {
    return { bundlesRoot: dirname(folder), bundleRef: `${basename(folder)}/lesson.json` };
  }
  return { bundlesRoot: folder, bundleRef: basename(lessonPath) };
}

/** Validate a lesson path from outside the extension: absolute, no `..`, no NUL, a .json file that exists. */
export function checkLessonPath(lessonPath: string, exists: (path: string) => boolean): OpenLessonResult {
  if (!isAbsolute(lessonPath) || lessonPath.split(/[\\/]+/).includes("..")) {
    return { ok: false, error: { key: "uri_not_absolute", path: lessonPath } };
  }
  if (lessonPath.includes("\0") || !lessonPath.toLowerCase().endsWith(".json")) {
    return { ok: false, error: { key: "uri_not_lesson", path: lessonPath.replace(/\0/g, "") } };
  }
  if (!exists(lessonPath)) return { ok: false, error: { key: "uri_not_found", path: lessonPath } };
  return { ok: true, ...lessonLocation(lessonPath) };
}

/** Parse the query string of the extension's URI (`bundle=<path of lesson.json>`). Never throws. */
export function parseOpenLessonQuery(query: string, exists: (path: string) => boolean): OpenLessonResult {
  const bundle = new URLSearchParams(query).get("bundle");
  if (!bundle) return { ok: false, error: { key: "uri_missing_bundle" } };
  return checkLessonPath(bundle, exists);
}

/** The still-percent-encoded query of a URI string (`uri.toString()`), without any fragment. VS Code's
 * `uri.query` is already decoded, which would split a path that contains `&` or `+`, so the handler
 * re-reads the query from the encoded string instead. */
export function rawQuery(uri: string): string {
  const afterQuestionMark = uri.split("?")[1] ?? "";
  return afterQuestionMark.split("#")[0] ?? "";
}
