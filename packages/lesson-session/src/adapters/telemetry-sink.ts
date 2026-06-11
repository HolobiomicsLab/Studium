import { appendFile, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { TelemetryEvent } from "@studium/telemetry-events";
import type { TelemetrySink } from "../ports.js";

export class JsonlTelemetrySink implements TelemetrySink {
  private buffer: TelemetryEvent[] = [];
  constructor(private readonly file: string) {}
  emit(event: TelemetryEvent): void { this.buffer.push(event); }
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer; this.buffer = [];
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  }
  /** RGPD erasure (#4): clear the in-memory buffer AND delete the telemetry file on disk.
   * The per-session file carries the learner's pseudonym + event refs — erase it for real.
   * Mirrors JsonlEventLog.purge; `force` makes a missing file a no-op. */
  async purge(): Promise<void> {
    this.buffer = [];
    await rm(this.file, { force: true });
  }
}

export class HttpTelemetrySink implements TelemetrySink {
  private buffer: TelemetryEvent[] = [];
  constructor(private readonly endpoint: string, private readonly courseToken: string) {}
  emit(event: TelemetryEvent): void { this.buffer.push(event); }
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer; this.buffer = [];
    const r = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Course-Token": this.courseToken },
      body: JSON.stringify({ events }),
    });
    if (!r.ok) throw new Error(`telemetry POST failed: ${r.status}`);
  }
}
