import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { MasteryClaimSink } from "../ports.js";
import type { MasteryClaimsDoc } from "../mastery-claims.js";

/** Local-only file sink: writes each mastery-claims doc to <dir>/<sanitized @id>.jsonld on flush.
 * RGPD: stays on local disk; there is no networked variant of this port. */
export class FileMasteryClaimSink implements MasteryClaimSink {
  private buffer: MasteryClaimsDoc[] = [];
  /** filenames this sink has flushed — so erase() removes exactly this session's files and never
   * touches another learner's .jsonld in a shared STUDIUM_MASTERY_DIR (cross-learner data-loss guard). */
  private written: string[] = [];
  constructor(private readonly dir: string) {}
  private fileFor(doc: MasteryClaimsDoc): string {
    const safe = String(doc["@id"] ?? "mastery").replace(/[^A-Za-z0-9_.-]/g, "_");
    return `${safe}.jsonld`;
  }
  emit(doc: MasteryClaimsDoc): void { this.buffer.push(doc); }
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const docs = this.buffer;
    this.buffer = [];
    await mkdir(this.dir, { recursive: true, mode: 0o700 }); // L-11: learner folders 0700, files 0600
    for (const doc of docs) {
      const name = this.fileFor(doc);
      await writeFile(join(this.dir, name), JSON.stringify(doc, null, 2), { encoding: "utf8", mode: 0o600 });
      this.written.push(name);
    }
  }
  /** RGPD erasure (#4): drop the unflushed buffer AND remove ONLY this session's flushed .jsonld
   * files (tracked in `written`) — never a blanket rmdir, which would erase other learners. */
  async erase(): Promise<void> {
    this.buffer = [];
    const names = this.written;
    this.written = [];
    for (const name of names) await rm(join(this.dir, name), { force: true });
  }
}
