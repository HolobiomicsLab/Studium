import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { TelemetryEvent } from "@studium/telemetry-events";
import type { TelemetrySink } from "../ports.js";

export interface JsonlTelemetrySinkOptions {
  /** The consent under which this stream is written, recorded as the first event of a NEW stream
   * (`consent_granted` with this scope; ADR 006 scope B is « pedagogical telemetry to the teacher »).
   * The host passes it when the operator declared consent through STUDIUM_TELEMETRY_CONSENT: the
   * event says that, not that the learner clicked anything. A stream already on disk is never given
   * one — not a second one, and not a first one for a stream written before the event existed. */
  consentScope?: "A" | "B" | "C";
}

/** The learner's telemetry stream, one JSON line per event. Each event is appended when it is
 * emitted (audit 2026-11-10, D3): a harness that closes without ending the session, or a process
 * that is killed, loses nothing already emitted. An event that cannot be written then stays pending
 * and is retried, in order, at the next emit or at `flush`, which is where a write error surfaces —
 * the act that emitted it is not undone. `flush` therefore writes only what is still pending: the
 * lesson-end and end_session flushes never write a line twice. */
export class JsonlTelemetrySink implements TelemetrySink {
  private pending: TelemetryEvent[] = [];
  /** Whether this sink has looked at the stream on disk yet (it does so at its first write). */
  private opened = false;
  constructor(private readonly file: string, private readonly options: JsonlTelemetrySinkOptions = {}) {}
  emit(event: TelemetryEvent): void {
    this.pending.push(event);
    try { this.writePendingSync(); } catch { /* kept pending; flush retries and reports */ }
  }
  async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const events = this.withConsent(this.pending, this.streamIsNew());
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 }); // L-11: learner folders 0700, files 0600
    await appendFile(this.file, serialise(events), { encoding: "utf8", mode: 0o600 });
    this.pending = []; this.opened = true;
  }
  /** RGPD erasure (#4): clear what is pending AND delete the telemetry file on disk.
   * The per-session file carries the learner's pseudonym + event refs — erase it for real.
   * Mirrors JsonlEventLog.purge; `force` makes a missing file a no-op. A later event starts a new
   * stream (with its consent event, when the sink has a consent scope). */
  async purge(): Promise<void> {
    this.pending = []; this.opened = false;
    await rm(this.file, { force: true });
  }

  private writePendingSync(): void {
    const events = this.withConsent(this.pending, this.streamIsNew());
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    appendFileSync(this.file, serialise(events), { encoding: "utf8", mode: 0o600 });
    this.pending = []; this.opened = true;
  }
  /** A stream is new when this sink has not written to it yet and the file is absent or empty. */
  private streamIsNew(): boolean {
    if (this.opened) return false;
    try { return statSync(this.file).size === 0; } catch { return true; }
  }
  private withConsent(events: TelemetryEvent[], isNew: boolean): TelemetryEvent[] {
    const scope = this.options.consentScope;
    const first = events[0];
    if (!isNew || scope === undefined || first === undefined) return events;
    const consent: TelemetryEvent = {
      event_id: randomUUID(),
      learner_pseudonym: first.learner_pseudonym,
      lesson_id: first.lesson_id,
      bundle_version: first.bundle_version,
      client_timestamp: first.client_timestamp,   // the stream opens with its first event
      type: "consent_granted",
      scope,
    };
    return [consent, ...events];
  }
}

const serialise = (events: TelemetryEvent[]): string => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

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
