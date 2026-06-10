import type { TelemetryEvent } from "@studium/telemetry-events";
import type { LearnerState } from "@studium/learner-state";
import type { ClassifyResult } from "@studium/reasoning-scorer";
import type {
  StateStore, EventLog, EventLogRecord, TelemetrySink, PseudonymProvider,
  ReasoningScorer, CritiqueEvaluator, CritiqueEvaluation, Clock, IdGen,
} from "./ports.js";
import type { SessionDeps } from "./types.js";

export class InMemoryStateStore implements StateStore {
  saved = new Map<string, LearnerState>();
  async load(id: string): Promise<LearnerState | null> { return this.saved.get(id) ?? null; }
  async save(id: string, state: LearnerState): Promise<void> { this.saved.set(id, state); }
}
export class InMemoryEventLog implements EventLog {
  records: EventLogRecord[] = [];
  async append(r: EventLogRecord): Promise<void> { this.records.push(r); }
}
export class InMemoryTelemetrySink implements TelemetrySink {
  events: TelemetryEvent[] = [];
  emit(e: TelemetryEvent): void { this.events.push(e); }
  async flush(): Promise<void> {}
}
export class StaticPseudonym implements PseudonymProvider {
  constructor(private readonly value = "anon-test") {}
  async get(): Promise<string> { return this.value; }
}
export class StubReasoningScorer implements ReasoningScorer {
  calls: Array<{ turn: string; topic: string }> = [];
  constructor(private readonly result: ClassifyResult | null = { signal: "justification", confidence: 0.5 }) {}
  async score(turn: string, topic: string): Promise<ClassifyResult | null> {
    this.calls.push({ turn, topic });
    return this.result;
  }
}
export class StubCritiqueEvaluatorT implements CritiqueEvaluator {
  constructor(private readonly score = 0.8) {}
  async evaluate(): Promise<CritiqueEvaluation> { return { score: this.score, feedback: "[test]" }; }
}
export class FixedClock implements Clock {
  private ms: number;
  constructor(startIso = "2026-06-10T00:00:00.000Z", private readonly stepMs = 1000) { this.ms = Date.parse(startIso); }
  now(): string { const v = new Date(this.ms).toISOString(); this.ms += this.stepMs; return v; }
}
export class SeqIdGen implements IdGen {
  private n = 0;
  uuid(): string { return `id-${this.n++}`; }
}

export function buildTestDeps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  return {
    stateStore: new InMemoryStateStore(),
    eventLog: new InMemoryEventLog(),
    telemetry: new InMemoryTelemetrySink(),
    pseudonym: new StaticPseudonym(),
    reasoningScorer: new StubReasoningScorer(),
    critiqueEvaluator: new StubCritiqueEvaluatorT(),
    clock: new FixedClock(),
    idGen: new SeqIdGen(),
    ...overrides,
  };
}
