import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MasteryClaimSink } from "../ports.js";
import type { MasteryClaimsDoc } from "../mastery-claims.js";

/** Local-only file sink: writes each mastery-claims doc to <dir>/<sanitized @id>.jsonld on flush.
 * RGPD: stays on local disk; there is no networked variant of this port. */
export class FileMasteryClaimSink implements MasteryClaimSink {
  private buffer: MasteryClaimsDoc[] = [];
  constructor(private readonly dir: string) {}
  emit(doc: MasteryClaimsDoc): void { this.buffer.push(doc); }
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const docs = this.buffer;
    this.buffer = [];
    await mkdir(this.dir, { recursive: true });
    for (const doc of docs) {
      const safe = String(doc["@id"] ?? "mastery").replace(/[^A-Za-z0-9_.-]/g, "_");
      await writeFile(join(this.dir, `${safe}.jsonld`), JSON.stringify(doc, null, 2), "utf8");
    }
  }
}
