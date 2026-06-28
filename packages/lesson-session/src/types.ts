// packages/lesson-session/src/types.ts
import type { Scene, LessonBundle } from "@studium/lesson-bundle-schema";
import type { LearnerState, Decision } from "@studium/learner-state";
import type {
  StateStore, EventLog, TelemetrySink, PseudonymProvider,
  ReasoningScorer, CritiqueEvaluator, AuditJudge, Clock, IdGen, MasteryClaimSink, SocraticTutor,
} from "./ports.js";

/** A client-safe projection of a Scene: structurally a Scene with the answer-bearing fields
 * (quiz `correct` flags, `claims`, `key_points`, `model_*` reveals) removed by the host's
 * `publicScene` redaction before the scene leaves the server. The learner-facing fields the
 * webview renders are a subset of Scene, so a partial Scene types it without naming each variant. */
export type PublicScene = Partial<Scene>;

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

// `confidence?` (0..4) is the optional per-answer self-rating — the path to CONTINUOUS calibration
// (capture-ready but currently UNFED by any UI; the live calibration input today is the meta-checkpoint).
// When present the engine folds it into the concept's confidence_calibration on that graded answer.
export type ResponseInput =
  | { kind: "ack" }
  | { kind: "quiz_choice"; choiceId: string; confidence?: 0 | 1 | 2 | 3 | 4 }
  | { kind: "confidence"; value: 0 | 1 | 2 | 3 | 4 }
  | { kind: "critique"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }
  | { kind: "flaw_report"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }    // spot_the_flaw
  | { kind: "explanation"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }    // explain_back
  | { kind: "comparison"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }     // comparison
  | { kind: "summary_audit"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }  // summary_audit
  | { kind: "prompt_submission"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 } // prompt_practice
  | { kind: "communication"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 };     // communication_sim

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
  // `calibration` rides on completion when a show_calibration_panel action fires on
  // the LAST scene (end-of-lesson self-check): there is no next scene to attach a
  // standalone `calibration` transition to, so the M3 feedback is surfaced here
  // instead of being silently dropped.
  | { kind: "complete"; summary: CompletionSummary; calibration?: { targetConcept: string } };

export interface SessionDeps {
  stateStore: StateStore;
  eventLog: EventLog;
  telemetry: TelemetrySink;
  pseudonym: PseudonymProvider;
  reasoningScorer: ReasoningScorer;
  socraticTutor?: SocraticTutor;   // EV-3a: optional = the flag. Absent → no tutor (default).
  critiqueEvaluator: CritiqueEvaluator;
  /** OPTIONAL LLM audit judge. Absent → the keyword matcher grades audits (over-distrust stays 0, the
   * honesty boundary). Present + a scene with sound_claims → the over-distrust direction is measured. */
  auditJudge?: AuditJudge;
  clock: Clock;
  idGen: IdGen;
  activeUniverseSelector?: (bundle: LessonBundle) => string;
  masteryClaimSink?: MasteryClaimSink;
}
