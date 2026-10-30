// packages/lesson-session-host/src/learner-files.ts
//
// L-11 (CC-1, SEC-8): how the host writes the learner files it owns — profile.json and study.json,
// which every server opening the same data folder shares (D4: ~/.studium/data by default, so a
// VS Code server, Claude Code and Codex may all use it at once).
//   - whole or not at all: a file is written to a temporary file of its own folder, then renamed over
//     the old one (atomic on one file system), so a crash never leaves a torn file;
//   - private: folders 0700, files 0600 — the data folder holds the learners' answers and progress;
//   - one writer at a time per learner, across processes: withFileLock holds a lock file around the
//     load, merge and save, and takes it over only when its owner process is gone;
//   - read strictly: an absent file is null, but a file that exists and does not parse is a
//     LearnerDataError, never « no profile » — a fresh profile saved over it would erase the
//     learner's history.
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, statSync } from "node:fs";
import { chmod, link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
const LEARNER_LOCKS_DIR = ".learner-locks";
const TOMBSTONE_FILE = "tombstone";
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MAX_MS = 50;

/** SEC-8: take group and other access away from `dir` when this user owns it — the data folder a
 * server starts on may have been created 0755 by an older version. Absent, or not ours: left alone. */
export function tightenFolder(dir: string): void {
  try {
    const st = statSync(dir);
    if (!st.isDirectory() || (typeof process.getuid === "function" && st.uid !== process.getuid())) return;
    if ((st.mode & 0o077) !== 0) chmodSync(dir, st.mode & PRIVATE_DIR_MODE);
  } catch { /* absent: created 0700 when first needed */ }
}

/** Create `dir` privately, also tightening a directory left by an older installation. */
export async function ensurePrivateDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await chmod(dir, PRIVATE_DIR_MODE);
}

/** A learner file that exists and cannot be read as what it should hold. */
export class LearnerDataError extends Error {
  constructor(public readonly path: string, reason: string) {
    super(`${path} exists but cannot be read (${reason}): fix it or move it away; Studium never saves a fresh ` +
      "profile over it");
    this.name = "LearnerDataError";
  }
}

/** Write `text` to `path` whole: a temporary file of the same folder (0600, in a 0700 folder), then a
 * rename over the old file. On failure the old file is untouched and the temporary file removed. */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const dir = dirname(path);
  await ensurePrivateDirectory(dir);
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, text, { encoding: "utf8", mode: PRIVATE_FILE_MODE, flag: "wx" });
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

type SafeParse<T> = (value: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } };

/** The record in `path`: null when there is no file, else what `parse` accepts — or a LearnerDataError
 * naming the file when it cannot be read, is not JSON, or is not such a record. */
export async function readJsonFile<T>(path: string, parse: SafeParse<T>): Promise<T | null> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new LearnerDataError(path, (error as Error).message);
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { throw new LearnerDataError(path, `not JSON: ${(error as Error).message}`); }
  const parsed = parse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new LearnerDataError(path, `not a valid record${issue ? `: ${issue.path.join(".") || "(root)"} ${issue.message}` : ""}`);
}

export interface FileLockOptions {
  /** How long to wait for another holder before giving up (default 10 s). */
  timeoutMs?: number;
  /** Retained for callers of the earlier API. Age no longer proves that a lock is abandoned. */
  staleMs?: number;
}

export const LOCK_FILE = ".lock";

/** Run `fn` holding `<dir>/.lock` across local processes. Publish a complete owner record exclusively;
 * recover only a dead process's lock, never a live or unknown owner based on file age. Recovery is
 * itself exclusive: a crash during recovery leaves `.lock.reap` and fails closed until repaired.
 * Timeout bounds waiting, not the duration of a holder's transaction. */
export async function withFileLock<T>(dir: string, fn: () => Promise<T>, opts: FileLockOptions = {}): Promise<T> {
  await ensurePrivateDirectory(dir);
  const timeoutMs = opts.timeoutMs ?? LOCK_TIMEOUT_MS;
  const file = join(dir, LOCK_FILE);
  const owner = `${process.pid} ${randomBytes(16).toString("hex")}\n`;
  const deadline = performance.now() + timeoutMs;
  for (let wait = 2; !await acquireLock(file, owner); wait = Math.min(wait * 2, LOCK_RETRY_MAX_MS)) {
    await recoverDeadOwner(file, owner);
    if (performance.now() >= deadline) {
      throw new Error(`${file}: another Studium server has held this learner's files for ${timeoutMs} ms; try again`);
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  try { return await fn(); }
  finally { await releaseLock(file, owner); }
}

/** Publish an initialized lock without exposing an empty file to another process. */
async function acquireLock(file: string, owner: string): Promise<boolean> {
  const pending = `${file}.${randomBytes(16).toString("hex")}.tmp`;
  try {
    await writeFile(pending, owner, { encoding: "utf8", mode: PRIVATE_FILE_MODE, flag: "wx" });
    await link(pending, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally { await rm(pending, { force: true }); }
}

async function lockOwner(file: string): Promise<string | null> {
  try { return await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function releaseLock(file: string, owner: string): Promise<void> {
  if (await lockOwner(file) === owner) await rm(file, { force: true });
}

/** Serialize recovery so a second reaper cannot unlink the first successor's lock. */
async function recoverDeadOwner(file: string, owner: string): Promise<void> {
  const recovery = `${file}.reap`;
  if (!await acquireLock(recovery, owner)) return;
  try {
    const current = await lockOwner(file);
    const pid = Number(/^(\d+)(?:\s|$)/.exec(current ?? "")?.[1]);
    if (Number.isSafeInteger(pid) && pid > 0 && pid <= 2 ** 31 - 1 && !processAlive(pid)) {
      await rm(file, { force: true });
    }
  } finally { await releaseLock(recovery, owner); }
}

/** Whether a process of this machine with this pid runs (EPERM: it runs, under another user). */
function processAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function learnerLockDirectory(dataDir: string, pseudonym: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(pseudonym)) throw new Error("invalid learner pseudonym for storage lock");
  return join(dataDir, LEARNER_LOCKS_DIR, pseudonym);
}

/** Serialize a learner's entire load-modify-save or forget transaction. The lock stays outside the
 * erasable learner folder; callers must not acquire it recursively or delete its metadata tree. */
export async function withLearnerLock<T>(dataDir: string, pseudonym: string, fn: () => Promise<T>): Promise<T> {
  const dir = learnerLockDirectory(dataDir, pseudonym);
  await ensurePrivateDirectory(dataDir);
  await ensurePrivateDirectory(dirname(dir));
  return withFileLock(dir, fn);
}

/** Read the latest forget token synchronously, or null before the first forget. Sessions retain the
 * token seen at creation: a different token invalidates them even after a fresh profile is saved. */
export function readLearnerTombstone(dataDir: string, pseudonym: string): string | null {
  const file = join(learnerLockDirectory(dataDir, pseudonym), TOMBSTONE_FILE);
  let token: string;
  try { token = readFileSync(file, "utf8").trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new LearnerDataError(file, "cannot read tombstone");
  }
  if (!/^[0-9a-f]{32}$/.test(token)) throw new LearnerDataError(file, "invalid tombstone");
  return token;
}

/** Rotate the forget token before erasing learner records, while holding withLearnerLock. Never clear
 * it on a fresh session: keeping it distinguishes every old session from later sessions. */
export async function writeLearnerTombstone(dataDir: string, pseudonym: string): Promise<string> {
  const token = randomBytes(16).toString("hex");
  await writeFileAtomic(join(learnerLockDirectory(dataDir, pseudonym), TOMBSTONE_FILE), `${token}\n`);
  return token;
}
