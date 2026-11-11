#!/usr/bin/env node
// tools/release/version.mjs — the product version, in every place that carries it.
//
//   node tools/release/version.mjs --check          # every place carries the extension's version; exit 1 if not
//   node tools/release/version.mjs 0.6.1            # write 0.6.1 everywhere, dated today (UTC)
//   node tools/release/version.mjs 0.6.1 --date 2026-12-01
//
// The version of a release is the `version` of apps/studium-vscode/package.json. Setting a version also
// turns the Unreleased entries of CHANGELOG.md into the section of that version. Every place is read and
// checked before any file is written: a place that no longer reads as expected stops the command, so that
// a file whose layout changed is noticed here and not after a release.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const V = String.raw`\d+\.\d+\.\d+`;
const D = String.raw`\d{4}-\d{2}-\d{2}`;
const manifest = new RegExp(String.raw`^\s*"version": "(?<v>${V})"`, "gmd");

/** Where the product version is written. `count` is how many times `re` must match in the file; the
 * named group `v` is a version, `d` a release date. */
export const PLACES = [
  { file: "apps/studium-vscode/package.json", re: manifest, count: 1 },
  { file: "apps/lesson-mcp/package.json", re: manifest, count: 1 },
  { file: "apps/lesson-panel-ui/package.json", re: manifest, count: 1 },
  { file: ".claude-plugin/plugin.json", re: manifest, count: 1 },
  { file: "server.json", re: manifest, count: 2 },
  { file: "apps/lesson-panel-ui/src/graph-entry.js", re: new RegExp(String.raw`\bversion: "(?<v>${V})"`, "gd"), count: 1 },
  { file: "apps/lesson-panel-ui/src/lesson-entry.js", re: new RegExp(String.raw`\bversion: "(?<v>${V})"`, "gd"), count: 1 },
  { file: "tools/panel-http-dev.mjs", re: new RegExp(String.raw`name: "studium-panel-dev", version: "(?<v>${V})"`, "gd"), count: 1 },
  { file: "CITATION.cff", re: new RegExp(String.raw`^version: (?<v>${V})\ndate-released: (?<d>${D})$`, "gmd"), count: 1 },
  { file: "README.md", re: new RegExp(String.raw`research prototype, version (?<v>${V})\.`, "gd"), count: 1 },
  { file: "README.fr.md", re: new RegExp(String.raw`prototype de recherche, en version (?<v>${V})\.`, "gd"), count: 1 },
  { file: ".github/ISSUE_TEMPLATE/problem.yml", re: new RegExp(String.raw`placeholder: "(?<v>${V}), bundled (?<d>${D})"`, "gd"), count: 1 },
];
const REFERENCE = "apps/studium-vscode/package.json";
const CHANGELOG = "CHANGELOG.md";
const UNRELEASED = "## Unreleased\n\n";
const released = new RegExp(String.raw`^## (${V}) — ${D}$`, "m");

const matches = (text, re) => [...text.matchAll(new RegExp(re.source, re.flags))];
const numbers = (version) => version.split(".").map(Number);
const isAfter = (a, b) => { const [x, y] = [numbers(a), numbers(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

/** `text` with the named groups of every match of `re` replaced by `values` ({v, d}). */
function replaceGroups(text, re, values) {
  const spans = matches(text, re).flatMap((m) => Object.entries(values)
    .filter(([name]) => m.indices.groups[name]).map(([name, value]) => [...m.indices.groups[name], value]));
  return spans.sort((a, b) => b[0] - a[0]).reduce((out, [from, to, value]) => out.slice(0, from) + value + out.slice(to), text);
}

/** What each place reads now: `{ file, versions, problem? }`. */
function readPlaces(root) {
  return PLACES.map(({ file, re, count }) => {
    let text;
    try { text = readFileSync(join(root, file), "utf8"); } catch { return { file, versions: [], problem: `${file}: cannot be read` }; }
    const versions = matches(text, re).map((m) => m.groups.v);
    const problem = versions.length === count ? undefined
      : `${file}: expected the version ${count} time${count > 1 ? "s" : ""}, found ${versions.length}; update PLACES in tools/release/version.mjs if the file changed`;
    return { file, versions, problem };
  });
}

/** The product version and every place that disagrees with it. */
export function checkVersion(root) {
  const places = readPlaces(root);
  const version = places.find((p) => p.file === REFERENCE)?.versions[0];
  const problems = places.flatMap((p) => p.problem ? [p.problem]
    : p.versions.filter((v) => v !== version).map((v) => `${p.file}: carries ${v}, the extension carries ${version}`));
  const log = readFileSync(join(root, CHANGELOG), "utf8");
  const latest = log.match(released)?.[1];
  if (latest !== version) problems.push(`${CHANGELOG}: the latest released section is ${latest ?? "missing"}, the extension carries ${version}`);
  return { version, problems };
}

/** The files to write for `next`, as [file, text] pairs. Throws, before anything is written, on a
 * version that does not move forward, a place that does not read as expected or nothing to release. */
export function planVersion(root, next, date) {
  if (!new RegExp(`^${V}$`).test(next)) throw new Error(`version: « ${next} » is not of the form X.Y.Z`);
  if (!new RegExp(`^${D}$`).test(date) || Number.isNaN(Date.parse(date))) throw new Error(`date: « ${date} » is not of the form YYYY-MM-DD`);
  const { version, problems } = checkVersion(root);
  if (problems.length) throw new Error(`the repository does not carry one version yet:\n  ${problems.join("\n  ")}`);
  if (!isAfter(next, version)) throw new Error(`version: ${next} does not come after the current ${version}`);

  const files = new Map();
  for (const { file, re } of PLACES) {
    const text = files.get(file) ?? readFileSync(join(root, file), "utf8");
    files.set(file, replaceGroups(text, re, { v: next, d: date }));
  }
  const log = readFileSync(join(root, CHANGELOG), "utf8");
  const start = log.indexOf(UNRELEASED);
  if (start < 0 || log.indexOf(UNRELEASED, start + 1) >= 0) throw new Error(`${CHANGELOG}: expected one « ## Unreleased » heading followed by an empty line`);
  const body = log.slice(start + UNRELEASED.length, log.indexOf("\n## ", start + UNRELEASED.length));
  if (!body.trim() || body.startsWith("## ")) throw new Error(`${CHANGELOG}: the Unreleased section is empty; there is nothing to release`);
  files.set(CHANGELOG, log.replace(UNRELEASED, `${UNRELEASED}## ${next} — ${date}\n\n`));
  return [...files];
}

/** Write `next` everywhere. Returns the files written. */
export function setVersion(root, next, date) {
  const plan = planVersion(root, next, date);
  for (const [file, text] of plan) writeFileSync(join(root, file), text);
  return plan.map(([file]) => file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const args = process.argv.slice(2);
  try {
    if (args[0] === "--check" && args.length === 1) {
      const { version, problems } = checkVersion(root);
      if (problems.length) { console.error(`version: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`); process.exit(1); }
      console.log(`version: ${version} in ${PLACES.reduce((n, p) => n + p.count, 0)} places and the changelog`);
    } else if (args[0] && !args[0].startsWith("-") && (args.length === 1 || (args.length === 3 && args[1] === "--date"))) {
      const date = args[2] ?? new Date().toISOString().slice(0, 10);
      const written = setVersion(root, args[0], date);
      console.log(`version: ${args[0]} (${date}) written in ${written.length} files:\n  ${written.join("\n  ")}`);
      console.log("Next: read the new section of CHANGELOG.md, add a sentence that sums the release up, and commit.");
    } else {
      console.error("usage: version.mjs --check | version.mjs X.Y.Z [--date YYYY-MM-DD]");
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
