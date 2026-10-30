// tools/docs/lib/generated.mjs — shared plumbing of the documentation generators: run a TypeScript
// dump script through the workspace's tsx, and replace the generated region of a Markdown page.
//
// A generated page is written by hand around one region the generator owns:
//
//   <!-- BEGIN GENERATED: <name> (tools/docs/gen-<name>.mjs; do not edit by hand) -->
//   ...
//   <!-- END GENERATED: <name> -->
//
// so its prose (and its French version) stays editable while its tables follow the code.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TSX = join(REPO_ROOT, "apps", "lesson-mcp", "node_modules", ".bin", "tsx");

/** Run `script` (a path under tools/docs/lib) through tsx and parse the JSON it prints. The child
 * runs with STUDIUM_EPHEMERAL=1 so no learner state is ever written. */
export function runDump(script) {
  if (!existsSync(TSX)) {
    throw new Error(`tsx not found at ${relative(REPO_ROOT, TSX)}: run \`pnpm install\` first`);
  }
  const out = execFileSync(TSX, [join(REPO_ROOT, "tools", "docs", "lib", script)], {
    cwd: REPO_ROOT,
    env: { ...process.env, STUDIUM_EPHEMERAL: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out);
}

const begin = (name) => new RegExp(`<!-- BEGIN GENERATED: ${name}\\b[^>]*-->`);
const end = (name) => `<!-- END GENERATED: ${name} -->`;

export function beginMarker(name) {
  return `<!-- BEGIN GENERATED: ${name} (tools/docs/gen-${name}.mjs; do not edit by hand) -->`;
}

/** The text between the markers of region `name` in `text`, or null when the region is absent. */
export function readRegion(text, name) {
  const start = text.match(begin(name));
  if (!start) return null;
  const from = start.index + start[0].length;
  const to = text.indexOf(end(name), from);
  if (to < 0) return null;
  return text.slice(from, to);
}

/** `text` with region `name` replaced by `body`; throws when the markers are missing. */
export function replaceRegion(text, name, body) {
  const start = text.match(begin(name));
  const to = start ? text.indexOf(end(name), start.index) : -1;
  if (!start || to < 0) throw new Error(`generated region "${name}" not found (add ${beginMarker(name)} and ${end(name)})`);
  return `${text.slice(0, start.index)}${beginMarker(name)}\n\n${body.trim()}\n\n${text.slice(to)}`;
}

/** The pages (repo-relative) whose region is stale, after optionally writing the fresh version. */
export function syncRegion(pages, name, body, { write }) {
  const stale = [];
  for (const page of pages) {
    const path = join(REPO_ROOT, page);
    if (!existsSync(path)) { stale.push(`${page}: missing`); continue; }
    const current = readFileSync(path, "utf8");
    let next;
    try { next = replaceRegion(current, name, body); }
    catch (error) { stale.push(`${page}: ${error.message}`); continue; }
    if (next === current) continue;
    if (write) writeFileSync(path, next, "utf8");
    else stale.push(`${page}: generated region "${name}" is out of date (run pnpm docs:gen)`);
  }
  return stale;
}

/** The CLI shared by the generators: write by default, `--check` only reports. */
export function generatorMain(pages, name, render) {
  const check = process.argv.includes("--check");
  const problems = syncRegion(pages, name, render(), { write: !check });
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (!check && problems.length === 0) process.stdout.write(`updated ${pages.join(", ")}\n`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

export const isEntry = (url) => process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
