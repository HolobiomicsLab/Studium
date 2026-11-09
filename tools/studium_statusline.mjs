#!/usr/bin/env node
// tools/studium_statusline.mjs — the lesson's status, on one line, for a harness status line.
//
// INT-STUDIUM-058. In durable mode the Studium server writes where the learner's session stands in
// <data folder>/<learner>/status.json (packages/lesson-session-host/src/status-file.ts). This script
// prints the `status_line` of the newest such file whose server still runs, for example
//
//   Les atomes · étape 2/3 · 3 min · à toi de répondre
//
// and prints nothing, exit 0, when there is none: a status line must never show an error. Node
// built-ins only, so a harness can run it from a checkout without an install. It reads nothing from
// stdin (Claude Code pipes a JSON description of its own session there, which it does not need).
//
// The data folder is found as the server finds it: --data-dir=DIR, else STUDIUM_DATA_DIR, else
// <STUDIUM_HOME or ~/.studium>/data; nothing with STUDIUM_EPHEMERAL=1 and no data folder named.
//
// Claude Code, in ~/.claude/settings.json:
//   { "statusLine": { "type": "command", "command": "node /absolute/path/to/tools/studium_statusline.mjs" } }
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATUS_FILE = "status.json";
const STATUS_SCHEMA = "studium-status/1";
/** A learner's folder is named by a 16-hex pseudonym (pseudonym-secret.ts). */
const LEARNER_FOLDER = /^[0-9a-f]{16}$/;

/** A variable exported empty (`VAR=`) is unset, as for the server (persistence.ts). */
function setting(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function dataDir(argv) {
  const flag = argv.find((arg) => arg.startsWith("--data-dir="))?.slice("--data-dir=".length);
  if (flag) return flag;
  const explicit = setting("STUDIUM_DATA_DIR");
  if (explicit) return explicit;
  if (["1", "true", "yes", "on"].includes((setting("STUDIUM_EPHEMERAL") ?? "").toLowerCase())) return null;
  return join(setting("STUDIUM_HOME") ?? join(homedir(), ".studium"), "data");
}

/** Whether a process with this pid exists. EPERM: it does, under another user. */
function runs(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

/** The status in `path`, or null when it is absent, not a status, or left by a server that stopped. */
function readStatus(path) {
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
  if (value === null || typeof value !== "object" || value.schema !== STATUS_SCHEMA) return null;
  if (typeof value.status_line !== "string" || typeof value.updated_at !== "string") return null;
  const at = Date.parse(value.updated_at);
  if (Number.isNaN(at) || !Number.isInteger(value.pid) || value.pid <= 0 || !runs(value.pid)) return null;
  return { line: value.status_line, at };
}

function newestStatus(dir) {
  let folders;
  try { folders = readdirSync(dir, { withFileTypes: true }); }
  catch { return null; }
  let newest = null;
  for (const folder of folders) {
    if (!folder.isDirectory() || !LEARNER_FOLDER.test(folder.name)) continue;
    const status = readStatus(join(dir, folder.name, STATUS_FILE));
    if (status && (newest === null || status.at > newest.at)) newest = status;
  }
  return newest;
}

/** One line: control characters (a newline, an escape sequence in a lesson title) become spaces. */
function oneLine(text) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

try {
  const dir = dataDir(process.argv.slice(2));
  const status = dir === null ? null : newestStatus(dir);
  const line = status ? oneLine(status.line) : "";
  if (line) process.stdout.write(`${line}\n`);
} catch { /* nothing to show */ }
