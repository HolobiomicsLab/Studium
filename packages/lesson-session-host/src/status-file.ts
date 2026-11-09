// packages/lesson-session-host/src/status-file.ts
//
// INT-STUDIUM-058 (N8): where a learner's session stands, kept for a harness status line in
// <dataDir>/<pseudonym>/status.json, beside profile.json and study.json. A harness that shows a status
// line runs tools/studium_statusline.mjs, which prints `status_line` of the newest file whose server
// still runs (`pid`). Durable mode only: the host never calls this without a data folder.
//
// The file holds what the orientation holds (orientation.ts): the lesson's title, the step, a concept
// title, durations, what is expected. No scene text, key, hint or reveal. Written whole (temporary file,
// then rename), 0600 in the learner's 0700 folder, removed when the session that wrote it closes, and
// erased with the learner's other files by forget.
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Orientation } from "./orientation.js";
import { writeFileAtomic } from "./learner-files.js";

export const STATUS_FILE = "status.json";
export const STATUS_SCHEMA = "studium-status/1";

export interface StatusFile {
  schema: typeof STATUS_SCHEMA;
  /** The orientation as one line (orientation.ts statusLine), in the lesson's language. */
  status_line: string;
  orientation: Orientation;
  /** When this status was written, on the machine's clock (never a session's anchored clock): a reader
   * picks the newest file. */
  updated_at: string;
  /** The server process that wrote it: once that process has stopped, the status describes no live
   * session and a reader ignores it. */
  pid: number;
}

function sanitizeSegment(s: string): string { return s.replace(/[^A-Za-z0-9_.-]/g, "_"); }

export function statusFilePath(dataDir: string, pseudonym: string): string {
  return join(dataDir, sanitizeSegment(pseudonym), STATUS_FILE);
}

export async function writeStatusFile(
  dataDir: string, pseudonym: string, status: Pick<StatusFile, "status_line" | "orientation">,
): Promise<void> {
  const file: StatusFile = { schema: STATUS_SCHEMA, ...status, updated_at: new Date().toISOString(), pid: process.pid };
  await writeFileAtomic(statusFilePath(dataDir, pseudonym), JSON.stringify(file, null, 2));
}

/** The pid of the server whose status the learner's folder holds now; null without a file, or with one
 * that does not read as a status. */
export async function statusFileOwner(dataDir: string, pseudonym: string): Promise<number | null> {
  try {
    const value = JSON.parse(await readFile(statusFilePath(dataDir, pseudonym), "utf8")) as { pid?: unknown };
    return typeof value.pid === "number" ? value.pid : null;
  } catch { return null; }
}

export async function removeStatusFile(dataDir: string, pseudonym: string): Promise<void> {
  await rm(statusFilePath(dataDir, pseudonym), { force: true });
}
