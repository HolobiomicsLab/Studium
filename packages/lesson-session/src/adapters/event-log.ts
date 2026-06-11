import { appendFile, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { EventLog, EventLogRecord } from "../ports.js";
export class JsonlEventLog implements EventLog {
  constructor(private readonly file: string) {}
  async append(record: EventLogRecord): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(record) + "\n", "utf8");
  }
  /** RGPD erasure (#4): the host gives each session its own log file, so the whole file is this
   * learner's data — safe to unlink. `force` makes a missing file a no-op. */
  async purge(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
