// node --test tools/release/version.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLACES, checkVersion, planVersion, setVersion } from "./version.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** A scratch copy of the files that carry the product version, and nothing else. */
function scratch() {
  const root = mkdtempSync(join(tmpdir(), "studium-version-"));
  for (const file of [...new Set([...PLACES.map((p) => p.file), "CHANGELOG.md"])]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(join(REPO, file), join(root, file));
  }
  // Right after a release the repository's Unreleased section is empty: give the copy something to release.
  const log = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  if (log.includes("## Unreleased\n\n## ")) {
    writeFileSync(join(root, "CHANGELOG.md"), log.replace("## Unreleased\n\n", "## Unreleased\n\n### Fixed\n\n- A change waiting for a release.\n\n"));
  }
  return root;
}
const read = (root, file) => readFileSync(join(root, file), "utf8");
const current = () => JSON.parse(read(REPO, "apps/studium-vscode/package.json")).version;
const bumped = () => { const [a, b, c] = current().split(".").map(Number); return `${a}.${b}.${c + 1}`; };

test("the repository carries one product version in every place", () => {
  const { version, problems } = checkVersion(REPO);
  assert.deepEqual(problems, []);
  assert.equal(version, current());
});

test("setVersion writes the new version in every place, and the check then passes", () => {
  const root = scratch();
  const next = bumped();
  const written = setVersion(root, next, "2031-02-03");
  assert.equal(written.length, new Set(PLACES.map((p) => p.file)).size + 1, "every place and the changelog");
  assert.deepEqual(checkVersion(root), { version: next, problems: [] });
  const server = JSON.parse(read(root, "server.json"));
  assert.equal(server.version, next);
  assert.equal(server.packages[0].version, next);
  assert.match(read(root, "CITATION.cff"), new RegExp(`^version: ${next}\\ndate-released: 2031-02-03$`, "m"));
  assert.match(read(root, ".github/ISSUE_TEMPLATE/problem.yml"), new RegExp(`placeholder: "${next}, bundled 2031-02-03"`));
});

test("setVersion turns the Unreleased entries into the section of the new version", () => {
  const root = scratch();
  const next = bumped();
  const before = read(root, "CHANGELOG.md");
  setVersion(root, next, "2031-02-03");
  const after = read(root, "CHANGELOG.md");
  assert.ok(after.includes(`## Unreleased\n\n## ${next} — 2031-02-03\n\n`));
  assert.equal(after.replace(`## ${next} — 2031-02-03\n\n`, ""), before, "nothing else changes in the changelog");
});

test("a version that does not move forward, or is not X.Y.Z, is refused", () => {
  const root = scratch();
  for (const bad of [current(), "0.0.1", "1.2", "v9.9.9", "9.9.9-rc.1", ""]) {
    assert.throws(() => planVersion(root, bad, "2031-02-03"), /version/i, `« ${bad} » must be refused`);
  }
  assert.throws(() => planVersion(root, bumped(), "3 Feb 2031"), /date/i);
});

test("a place that no longer reads as expected stops everything before any write", () => {
  const root = scratch();
  const file = "apps/lesson-panel-ui/src/graph-entry.js";
  writeFileSync(join(root, file), read(root, file).replace(/version: "[^"]+"/, 'release: "none"'));
  const snapshot = read(root, "server.json");
  assert.throws(() => setVersion(root, bumped(), "2031-02-03"), /graph-entry\.js/);
  assert.equal(read(root, "server.json"), snapshot, "no file was written");
  assert.ok(checkVersion(root).problems.some((p) => p.includes("graph-entry.js")));
});

test("a place that carries another version is reported by the check", () => {
  const root = scratch();
  writeFileSync(join(root, ".claude-plugin/plugin.json"), read(root, ".claude-plugin/plugin.json").replace(current(), "0.0.9"));
  const { problems } = checkVersion(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /plugin\.json.*0\.0\.9/);
});

test("nothing to release: an empty Unreleased section is refused", () => {
  const root = scratch();
  const log = read(root, "CHANGELOG.md");
  const start = log.indexOf("## Unreleased\n") + "## Unreleased\n".length;
  const end = log.indexOf("\n## ", start);
  writeFileSync(join(root, "CHANGELOG.md"), `${log.slice(0, start)}\n${log.slice(end + 1)}`);
  assert.throws(() => planVersion(root, bumped(), "2031-02-03"), /Unreleased/);
});
