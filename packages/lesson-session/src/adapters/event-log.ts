import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { EventLog, EventLogRecord } from "../ports.js";
export class JsonlEventLog implements EventLog {
  constructor(private readonly file: string) {}
  async append(record: EventLogRecord): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(record) + "\n", "utf8");
  }
}
