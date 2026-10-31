import { mkdir, readFile, writeFile, rm, rename } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { LearnerStateSchema, type LearnerState } from "@studium/learner-state";
import type { StateStore } from "../ports.js";
export class FileStateStore implements StateStore {
  constructor(private readonly dir: string) {}
  /** Defense-in-depth: NEVER trust the caller-controlled key as a path. The durable host scopes a
   * per-learner dir and hands us the RAW bundle_id; a `bundle_id` with `../` or a separator would
   * otherwise escape `this.dir` (cross-learner bleed + arbitrary write outside STUDIUM_DATA_DIR).
   * Mirror FileMasteryClaimSink: collapse the key into a single safe filename segment — stripping
   * `/` and `\` removes every separator, so the result cannot escape `this.dir`. */
  private fileFor(lessonId: string): string {
    const safe = lessonId.replace(/[^A-Za-z0-9_.-]/g, "_");
    return `state-${safe}.json`;
  }
  private path(lessonId: string): string {
    const target = join(this.dir, this.fileFor(lessonId));
    // Belt-and-suspenders: the sanitized segment has no separator, but assert containment anyway —
    // if the resolved target ever leaves `this.dir`, refuse rather than write outside.
    const base = resolve(this.dir);
    const resolved = resolve(target);
    if (resolved !== base && !resolved.startsWith(base + sep)) {
      throw new Error(`FileStateStore: refusing to access path outside store dir: ${resolved}`);
    }
    return target;
  }
  async load(lessonId: string): Promise<LearnerState | null> {
    try { return LearnerStateSchema.parse(JSON.parse(await readFile(this.path(lessonId), "utf8"))); }
    catch { return null; }
  }
  async save(lessonId: string, state: LearnerState): Promise<void> {
    const target = this.path(lessonId);
    await mkdir(this.dir, { recursive: true, mode: 0o700 }); // L-11: learner folders 0700
    // Atomic write: write to a temp file in this.dir then rename over the target, so a mid-write
    // crash never leaves a truncated state file. mkdir above also removes the prior ENOENT crash.
    const tmp = join(this.dir, `.state-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    await writeFile(tmp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 }); // L-11: learner files 0600
    try { await rename(tmp, target); }
    catch (err) { await rm(tmp, { force: true }); throw err; }
  }
  /** RGPD erasure (#4): remove this lesson's state file. `force` makes a missing file a no-op. */
  async delete(lessonId: string): Promise<void> {
    await rm(this.path(lessonId), { force: true });
  }
}
