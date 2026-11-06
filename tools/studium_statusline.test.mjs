// tools/studium_statusline.test.mjs — node --test tools/studium_statusline.test.mjs
//
// INT-STUDIUM-058, task 2.4. The status-line script prints one line: the status of the lesson being
// played, read from the newest <data folder>/<learner>/status.json whose server still runs. With no
// such file it prints nothing and exits 0: a harness status line must never show an error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./studium_statusline.mjs", import.meta.url));
const ANA = "0123456789abcdef";
const BEN = "fedcba9876543210";

function dataDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "statusline-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The pid of a process that has already exited. */
function stoppedPid() {
  const child = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(child.status, 0);
  return child.pid;
}

function status(overrides = {}) {
  return {
    schema: "studium-status/1", status_line: "Les atomes · étape 1/2 · 2 min · à toi de répondre",
    orientation: { step: { index: 1, total: 2 }, reviews_due: 0, waiting: "answer" },
    updated_at: "2026-11-06T17:30:00.000Z", pid: process.pid, ...overrides,
  };
}
function put(dir, learner, content) {
  mkdirSync(join(dir, learner), { recursive: true });
  writeFileSync(join(dir, learner, "status.json"), typeof content === "string" ? content : JSON.stringify(content));
}

/** Run the script with a clean Studium environment plus `env`; stdin is closed, as under a harness
 * that pipes nothing. */
function run(args = [], env = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("STUDIUM_")));
  const out = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8", env: { ...clean, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: out.status, stdout: out.stdout, stderr: out.stderr };
}

test("prints the status line of the learner's status file", (t) => {
  const dir = dataDir(t);
  put(dir, ANA, status());
  assert.deepEqual(run([`--data-dir=${dir}`]), { code: 0, stdout: "Les atomes · étape 1/2 · 2 min · à toi de répondre\n", stderr: "" });
});

test("with several files, prints the line of the most recent one", (t) => {
  const dir = dataDir(t);
  put(dir, ANA, status({ status_line: "ancienne", updated_at: "2026-11-06T10:00:00.000Z" }));
  put(dir, BEN, status({ status_line: "récente", updated_at: "2026-11-06T18:00:00.000Z" }));
  assert.equal(run([`--data-dir=${dir}`]).stdout, "récente\n");
});

test("prints nothing, exit 0, without a status file", (t) => {
  const dir = dataDir(t);
  assert.deepEqual(run([`--data-dir=${dir}`]), { code: 0, stdout: "", stderr: "" });
  mkdirSync(join(dir, ANA));
  writeFileSync(join(dir, ANA, "profile.json"), "{}");
  assert.deepEqual(run([`--data-dir=${dir}`]), { code: 0, stdout: "", stderr: "" });
});

test("prints nothing, exit 0, when the data folder does not exist", (t) => {
  const dir = dataDir(t);
  assert.deepEqual(run([`--data-dir=${join(dir, "absent")}`]), { code: 0, stdout: "", stderr: "" });
});

test("ignores the status of a server that no longer runs", (t) => {
  const dir = dataDir(t);
  put(dir, ANA, status({ status_line: "serveur arrêté", pid: stoppedPid(), updated_at: "2026-11-06T19:00:00.000Z" }));
  assert.deepEqual(run([`--data-dir=${dir}`]), { code: 0, stdout: "", stderr: "" });
  put(dir, BEN, status({ status_line: "serveur en marche", updated_at: "2026-11-06T09:00:00.000Z" }));
  assert.equal(run([`--data-dir=${dir}`]).stdout, "serveur en marche\n");
});

test("ignores a file it cannot read as a status", (t) => {
  const dir = dataDir(t);
  put(dir, ANA, "{ not json");
  put(dir, BEN, status({ status_line: 42 }));
  put(dir, "aaaaaaaaaaaaaaaa", status({ updated_at: "hier" }));
  put(dir, "bbbbbbbbbbbbbbbb", status({ pid: "12" }));
  put(dir, "cccccccccccccccc", status({ schema: "autre/1" }));
  assert.deepEqual(run([`--data-dir=${dir}`]), { code: 0, stdout: "", stderr: "" });
});

test("reads learner folders only: a file elsewhere in the data folder is not a status", (t) => {
  const dir = dataDir(t);
  put(dir, ".learner-locks", status({ status_line: "pas un apprenant" }));
  put(dir, "notes", status({ status_line: "pas un apprenant" }));
  assert.equal(run([`--data-dir=${dir}`]).stdout, "");
});

test("prints one line: control characters of a status line become spaces", (t) => {
  const dir = dataDir(t);
  put(dir, ANA, status({ status_line: "Leçon\n\u001b[31mrouge\u0007 · étape 1/2" }));
  assert.equal(run([`--data-dir=${dir}`]).stdout, "Leçon [31mrouge · étape 1/2\n");
});

test("finds the data folder as the server does", (t) => {
  const home = dataDir(t);
  const explicit = dataDir(t);
  put(join(home, "data"), ANA, status({ status_line: "sous STUDIUM_HOME" }));
  put(explicit, ANA, status({ status_line: "sous STUDIUM_DATA_DIR" }));
  assert.equal(run([], { STUDIUM_HOME: home }).stdout, "sous STUDIUM_HOME\n");
  assert.equal(run([], { STUDIUM_HOME: home, STUDIUM_DATA_DIR: explicit }).stdout, "sous STUDIUM_DATA_DIR\n");
  assert.equal(run([], { STUDIUM_HOME: home, STUDIUM_DATA_DIR: "" }).stdout, "sous STUDIUM_HOME\n"); // empty is unset
  assert.equal(run([`--data-dir=${explicit}`], { STUDIUM_HOME: home }).stdout, "sous STUDIUM_DATA_DIR\n");
  // Memory-only mode keeps nothing on disk: nothing to show, whatever an older run left there.
  assert.equal(run([], { STUDIUM_HOME: home, STUDIUM_EPHEMERAL: "1" }).stdout, "");
  assert.equal(run([], { STUDIUM_HOME: home, STUDIUM_EPHEMERAL: "1", STUDIUM_DATA_DIR: explicit }).stdout, "sous STUDIUM_DATA_DIR\n");
});
