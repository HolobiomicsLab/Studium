import { appendFile, mkdir } from "node:fs/promises";
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
