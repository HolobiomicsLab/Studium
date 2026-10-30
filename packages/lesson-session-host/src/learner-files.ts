// packages/lesson-session-host/src/learner-files.ts
//
// L-11 (CC-1, SEC-8): how the host writes the learner files it owns — profile.json and study.json,
// which every server opening the same data folder shares (D4: ~/.studium/data by default, so a
// VS Code server, Claude Code and Codex may all use it at once).
//   - whole or not at all: a file is written to a temporary file of its own folder, then renamed over
//     the old one (atomic on one file system), so a crash never leaves a torn file;
//   - private: folders 0700, files 0600 — the data folder holds the learners' answers and progress;
//   - one writer at a time per learner, across processes: withFileLock holds a lock file around the
//     load, merge and save, and takes it over when the process that left it is gone, or it is stale;
//   - read strictly: an absent file is null, but a file that exists and does not parse is a
//     LearnerDataError, never « no profile » — a fresh profile saved over it would erase the
//     learner's history.
import { randomBytes } from "node:crypto";
import { chmodSync, statSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** SEC-8: take group and other access away from `dir` when this user owns it — the data folder a
 * server starts on may have been created 0755 by an older version. Absent, or not ours: left alone. */
export function tightenFolder(dir: string): void {
  try {
    const st = statSync(dir);
    if (!st.isDirectory() || (typeof process.getuid === "function" && st.uid !== process.getuid())) return;
    if ((st.mode & 0o077) !== 0) chmodSync(dir, st.mode & PRIVATE_DIR_MODE);
  } catch { /* absent: created 0700 when first needed */ }
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
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
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
  /** A lock older than this is taken over even when its process looks alive (default 30 s): every
   * critical section it guards takes milliseconds. */
  staleMs?: number;
}

export const LOCK_FILE = ".lock";

/** Run `fn` holding `<dir>/.lock`, created exclusively (O_EXCL), across processes and within one. A lock
 * left by a process that is gone, or older than staleMs, is taken over; after timeoutMs of waiting on a
 * live holder the call fails in one line. The folder is created 0700 when absent. */
export async function withFileLock<T>(dir: string, fn: () => Promise<T>, opts: FileLockOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const staleMs = opts.staleMs ?? 30_000;
  const file = join(dir, LOCK_FILE);
  const deadline = Date.now() + timeoutMs;
  for (let wait = 2; ; wait = Math.min(wait * 2, 50)) {
    try {
      await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
      const handle = await open(file, "wx", PRIVATE_FILE_MODE);
      try { await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`, "utf8"); }
      finally { await handle.close(); }
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // ENOENT: the folder was removed between mkdir and open (a forget emptied it): make it again.
      if (code !== "EEXIST" && code !== "ENOENT") throw error;
      if (code === "EEXIST" && await takeOverStale(file, staleMs)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`${file}: another Studium server has held this learner's files for ${timeoutMs} ms; try again`);
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  try { return await fn(); }
  finally { await rm(file, { force: true }); }
}

/** Remove the lock at `file` when the process named in it is gone or it is older than `staleMs`;
 * true when the caller should try to take the lock again at once. */
async function takeOverStale(file: string, staleMs: number): Promise<boolean> {
  let text: string;
  let modifiedAt: number;
  try {
    text = await readFile(file, "utf8");
    modifiedAt = (await stat(file)).mtimeMs;
  } catch { return true; } // released meanwhile
  const pid = Number.parseInt(text, 10);
  const gone = Number.isInteger(pid) && pid > 0 && !processAlive(pid);
  if (!gone && Date.now() - modifiedAt < staleMs) return false;
  // Remove only the lock judged stale: another process may have replaced it since it was read.
  try { if ((await readFile(file, "utf8")) === text) await rm(file, { force: true }); }
  catch { /* released meanwhile */ }
  return true;
}

/** Whether a process of this machine with this pid runs (EPERM: it runs, under another user). */
function processAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
