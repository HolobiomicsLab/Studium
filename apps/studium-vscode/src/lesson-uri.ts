// lesson-uri.ts — VSC-7 / C7: turn the learner's "open this lesson" intent into a bundles root + bundle
// ref, whether it comes from vscode://holobiomicslab.studium-vscode/open?bundle=<path of lesson.json>
// (a harness runs `code --open-url …`) or from the explorer's "Open this lesson" on a lesson.json.
// Pure: file existence is injected, so a driver can test every refusal without a disk.
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
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

/** Validate a lesson path from outside the extension: absolute, no `..`, no NUL, a .json file that exists. With
 * `roots` (a link: review finding 7), it must also lie inside one of them, which is checked before its existence, so
 * that a link cannot ask whether any other file exists. Without (a file the learner picked), any folder will do. */
export function checkLessonPath(lessonPath: string, exists: (path: string) => boolean, roots?: readonly string[]): OpenLessonResult {
  if (!isAbsolute(lessonPath) || lessonPath.split(/[\\/]+/).includes("..")) {
    return { ok: false, error: { key: "uri_not_absolute", path: lessonPath } };
  }
  if (lessonPath.includes("\0") || !lessonPath.toLowerCase().endsWith(".json")) {
    return { ok: false, error: { key: "uri_not_lesson", path: lessonPath.replace(/\0/g, "") } };
  }
  if (roots && !roots.some((root) => insideFolder(root, lessonPath))) {
    return { ok: false, error: { key: "uri_outside_lessons", path: lessonPath } };
  }
  if (!exists(lessonPath)) return { ok: false, error: { key: "uri_not_found", path: lessonPath } };
  return { ok: true, ...lessonLocation(lessonPath) };
}

/** Whether `path` lies inside the folder `root` (at any depth, never the folder itself). */
export function insideFolder(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** The lesson path in the query VS Code hands the URI handler (`uri.query`, decoded once): what follows "bundle=",
 * all of it when that is a .json path (a path may hold & + # % = ? or spaces, which the link encoded once:
 * lesson-session-host open-link.ts), else up to the last "&" that ends a .json path (a link with more parameters).
 * Null when there is no bundle or it is empty. Never decodes again: a "%" in it is part of the path. */
export function bundleOfQuery(query: string): string | null {
  const found = /(?:^|&)bundle=/.exec(query);
  if (!found) return null;
  const value = query.slice(found.index + found[0].length);
  if (!value) return null;
  if (/\.json$/i.test(value)) return value;
  for (let at = value.lastIndexOf("&"); at > 0; at = value.lastIndexOf("&", at - 1)) {
    if (/\.json$/i.test(value.slice(0, at))) return value.slice(0, at);
  }
  return value;
}

/** D2 (owner decision 1): open the lesson of a vscode://<publisher>.studium-vscode/open?bundle=… link from the query
 * VS Code hands the handler (`uri.query`). VS Code decodes the link's query once and `uri.toString()` encodes all of it
 * again, "=" included, so the handler reads the decoded query. Review finding 7: any page or program can hand VS Code
 * such a link, so it opens a lesson only from `roots` — the extension's library, studium.bundlesRoot and the lessons
 * shipped with Studium — and refuses any other file (uri_outside_lessons). Never throws. */
export function parseOpenLessonLink(query: string, exists: (path: string) => boolean, roots: readonly string[]): OpenLessonResult {
  const bundle = bundleOfQuery(query);
  if (!bundle) return { ok: false, error: { key: "uri_missing_bundle" } };
  // No folder given (a caller from plain JavaScript): nothing opens, rather than anything.
  return checkLessonPath(bundle, exists, roots ?? []);
}

/** Parse a query string that is still percent-encoded (`bundle=<path of lesson.json>`), as a link is written. Never throws. */
export function parseOpenLessonQuery(query: string, exists: (path: string) => boolean): OpenLessonResult {
  const bundle = new URLSearchParams(query).get("bundle");
  if (!bundle) return { ok: false, error: { key: "uri_missing_bundle" } };
  return checkLessonPath(bundle, exists);
}

/** The query of a URI string as written, without any fragment. Not for what VS Code hands the URI handler: its
 * `uri.toString()` encodes "=" too (%3D), so no "bundle=" is left in it; the handler reads `uri.query` with
 * parseOpenLessonLink. */
export function rawQuery(uri: string): string {
  const afterQuestionMark = uri.split("?")[1] ?? "";
  return afterQuestionMark.split("#")[0] ?? "";
}
