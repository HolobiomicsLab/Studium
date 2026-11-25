// data-paths.ts — C6 / D4: the default places Studium keeps things, shared by the lesson panel and the
// @studium chat. Pure (file existence and the environment are injected).
import { join } from "node:path";
import type { Locale } from "./phrases.js";

/** STUDIUM_HOME, default `~/.studium`: the personal library lives in `<home>/library`. */
export function studiumHome(env: Record<string, string | undefined>, homedir: string): string {
  const configured = env["STUDIUM_HOME"]?.trim();
  return configured ? configured : join(homedir, ".studium");
}

/** The lessons folder used when `studium.bundlesRoot` is empty: the checkout's `fixtures/` when running
 * from a clone (development), else the personal library, where a lesson an assistant built for the
 * learner lands. An installed VSIX has no checkout, so it must not default to a folder that cannot exist. */
export function defaultBundlesRoot(opts: {
  repoRoot: string;
  exists: (path: string) => boolean;
  env: Record<string, string | undefined>;
  homedir: string;
}): string {
  const fixtures = join(opts.repoRoot, "fixtures");
  return opts.exists(fixtures) ? fixtures : join(studiumHome(opts.env, opts.homedir), "library");
}

/** The lessons shipped with Studium, where the server the extension launches reads them (mcp-connect.ts
 * resolveServerLaunch): a checkout's apps/lesson-mcp/shipped-lessons when the server runs from its sources, else
 * dist/shipped-lessons inside the installed extension, which the build copies there. Null when there is none. */
export function shippedLessonsRoot(opts: { extensionPath: string; repoRoot: string; exists: (path: string) => boolean }): string | null {
  const mcp = join(opts.repoRoot, "apps", "lesson-mcp");
  const candidate = opts.exists(join(mcp, "src", "index.ts")) ? join(mcp, "shipped-lessons") : join(opts.extensionPath, "dist", "shipped-lessons");
  return opts.exists(candidate) ? candidate : null;
}

/** « Discover Studium », the demo shipped with Studium, in the interface's language. */
export function demoLessonRef(locale: Locale): string {
  return `discover-studium-${locale}/lesson.json`;
}
