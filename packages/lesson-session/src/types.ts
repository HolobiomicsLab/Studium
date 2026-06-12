// packages/lesson-session/src/types.ts
import type { Scene, LessonBundle } from "@studium/lesson-bundle-schema";
import type { LearnerState, Decision } from "@studium/learner-state";
import type {
  StateStore, EventLog, TelemetrySink, PseudonymProvider,
  ReasoningScorer, CritiqueEvaluator, Clock, IdGen, MasteryClaimSink,
} from "./ports.js";

export interface Explanation { rule_id: string; explanation_short: string; modulator: string; }
export interface HintResult { hint: string; index: number; remaining: number; }
export interface LearnerSnapshot { conceptMastery: Record<string, number>; scenesCompleted: number; }

export interface Presentation {
  scene: Scene;
  index: number;
  total: number;
  lastDecision: Decision | null;
  explanation: Explanation | null;
  learnerSnapshot: LearnerSnapshot;
}

export type ResponseInput =
  | { kind: "ack" }
  | { kind: "quiz_choice"; choiceId: string }
  | { kind: "confidence"; value: 0 | 1 | 2 | 3 | 4 }
  | { kind: "critique"; text: string };

export interface CompletionSummary {
  totalDurationMs: number;
  autonomyRatio: number;
  scenesCompleted: number;
  finalState: LearnerState;
}

export type Transition =
  | { kind: "next"; presentation: Presentation }
  | { kind: "replay"; reason: string; presentation: Presentation }
  | { kind: "remediate_alt"; reason: string; presentation: Presentation }
  | { kind: "calibration"; targetConcept: string; presentation: Presentation }
  | { kind: "complete"; summary: CompletionSummary };

export interface SessionDeps {
  stateStore: StateStore;
  eventLog: EventLog;
  telemetry: TelemetrySink;
  pseudonym: PseudonymProvider;
  reasoningScorer: ReasoningScorer;
  critiqueEvaluator: CritiqueEvaluator;
  clock: Clock;
  idGen: IdGen;
  activeUniverseSelector?: (bundle: LessonBundle) => string;
  masteryClaimSink?: MasteryClaimSink;
}
