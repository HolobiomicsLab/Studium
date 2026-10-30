// data-paths.ts — C6 / D4: the default places Studium keeps things, shared by the lesson panel and the
// @studium chat. Pure (file existence and the environment are injected).
import { join } from "node:path";

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
