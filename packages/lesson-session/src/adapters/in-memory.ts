import type { TelemetryEvent } from "@studium/telemetry-events";
import type { LearnerState } from "@studium/learner-state";
import type { StateStore, EventLog, EventLogRecord, TelemetrySink, MasteryClaimSink } from "../ports.js";
import type { MasteryClaimsDoc } from "../mastery-claims.js";

export class InMemoryStateStore implements StateStore {
  readonly saved = new Map<string, LearnerState>();
  async load(id: string): Promise<LearnerState | null> { return this.saved.get(id) ?? null; }
  async save(id: string, state: LearnerState): Promise<void> { this.saved.set(id, state); }
  async delete(id: string): Promise<void> { this.saved.delete(id); }   // RGPD erasure (#4)
}

export class InMemoryEventLog implements EventLog {
  readonly records: EventLogRecord[] = [];
  async append(r: EventLogRecord): Promise<void> { this.records.push(r); }
  async purge(): Promise<void> { this.records.length = 0; }             // RGPD erasure (#4)
}

export class InMemoryTelemetrySink implements TelemetrySink {
  readonly events: TelemetryEvent[] = [];
  emit(e: TelemetryEvent): void { this.events.push(e); }
  async flush(): Promise<void> {}
  async purge(): Promise<void> { this.events.length = 0; }              // RGPD erasure (#4)
}

export class InMemoryMasteryClaimSink implements MasteryClaimSink {
  readonly docs: MasteryClaimsDoc[] = [];
  private buffer: MasteryClaimsDoc[] = [];
  emit(doc: MasteryClaimsDoc): void { this.buffer.push(doc); this.docs.push(doc); }
  async flush(): Promise<void> { this.buffer = []; }
  async erase(): Promise<void> { this.buffer = []; this.docs.length = 0; } // RGPD erasure (#4): buffer + flushed
}
