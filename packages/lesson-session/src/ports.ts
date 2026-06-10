// packages/lesson-session/src/ports.ts
import type { LearnerState } from "@studium/learner-state";
import type { TelemetryEvent } from "@studium/telemetry-events";
import type { ClassifyResult } from "@studium/reasoning-scorer";
import type { Scene } from "@studium/lesson-bundle-schema";

type AICritiqueScene = Extract<Scene, { type: "ai_critique" }>;
export type Claim = AICritiqueScene["claims"][number];
export type AICritiqueRubric = AICritiqueScene["rubric"];

export interface StateStore {
  load(lessonId: string): Promise<LearnerState | null>;
  save(lessonId: string, state: LearnerState): Promise<void>;
}

export interface EventLogRecord {
  event_id: string;
  session_id: string;
  pseudonyme: string;
  lesson_id: string;
  schema_version: string;
  timestamp: string;
  event_type: string;
  payload: unknown;
}
export interface EventLog { append(record: EventLogRecord): Promise<void>; }

export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
  flush(): Promise<void>;
}

export interface PseudonymProvider { get(lessonId: string): Promise<string>; }

export interface ReasoningScorer { score(turn: string, topic: string): Promise<ClassifyResult | null>; }

export interface CritiqueEvaluation { score: number; feedback: string; }
export interface CritiqueEvaluator {
  evaluate(input: { claims: Claim[]; rubric: AICritiqueRubric; critique: string }): Promise<CritiqueEvaluation>;
}

export interface Clock { now(): string; }   // ISO 8601 string
export interface IdGen { uuid(): string; }
