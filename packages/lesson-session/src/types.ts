// packages/lesson-session/src/types.ts
import type { Scene, LessonBundle } from "@studium/lesson-bundle-schema";
import type { LearnerState, Decision } from "@studium/learner-state";
import type {
  StateStore, EventLog, TelemetrySink, PseudonymProvider,
  ReasoningScorer, CritiqueEvaluator, AuditJudge, Clock, IdGen, MasteryClaimSink, SocraticTutor,
} from "./ports.js";
import type { PublicDeckItem } from "./grading/deck.js";

/** A client-safe projection of a Scene: structurally a Scene with the answer-bearing fields
 * (quiz `correct` flags, `claims`, `key_points`, `model_*` reveals) removed by the host's
 * `publicScene` redaction before the scene leaves the server. The learner-facing fields the
 * webview renders are a subset of Scene, so a partial Scene types it without naming each variant.
 * `deck` is the ADDED verdict-deck projection (opaque-token, label-stripped) — a client-only field,
 * never an authorable Scene field, so it lives on the projection type, not on Scene. */
export type PublicScene = Partial<Scene> & { deck?: PublicDeckItem[] };

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
  | { kind: "flaw_report"; text: string; confidence?: 0 | 1 | 2 | 3 | 4 }    // spot_the_flaw (free text)
  | { kind: "flaw_verdicts"; verdicts: Array<{ token: string; flagged: boolean }>; confidence?: 0 | 1 | 2 | 3 | 4 } // spot_the_flaw (verdict deck)
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

/** What the engine concluded about the response that was just submitted. Carried on the
 * transition because the public scene no longer ships `feedback_correct` / `feedback_incorrect`
 * (they were an answer key readable before answering): the feedback the learner is owed travels
 * with the verdict, after the answer, and only the matching half. `graded: false` on ack-only
 * scenes (intro, concept, meta_checkpoint…). `correct` is set for choice-graded answers only;
 * free-text graders report their signal kind in `signal` and no boolean. */
export interface Verdict {
  scene_id: string;
  graded: boolean;
  signal: string;
  correct?: boolean;
  feedback?: string;
}

/** The ONE navigation decision behind a transition, stated once. Before this field the same
 * decision was spread over three places that could disagree: `transition.kind`, the rule engine's
 * `presentation.lastDecision` (which says `advance_to_next_scene` even when the graph gate routed
 * back) and `explain_last_adaptation`. `kind` is the routing outcome; `rule_id` / `modulator` name
 * the rule that produced it (null for a plain advance); `returns_to` is the scene the learner is
 * owed once the detour is over (graph remediation), `scene_id` the scene being presented. */
export interface Navigation {
  kind: "advance" | "replay" | "remediate_alt" | "remediate" | "gate_passed" | "gate_released"
      | "gate_unassessable" | "skip_mastered" | "skip_concept" | "calibration" | "complete";
  scene_id: string | null;
  rule_id: string | null;
  reason: string | null;
  modulator: string | null;
  returns_to?: string;
}

interface TransitionMeta { verdict?: Verdict; navigation?: Navigation }

export type Transition =
  | ({ kind: "next"; presentation: Presentation } & TransitionMeta)
  | ({ kind: "replay"; reason: string; presentation: Presentation } & TransitionMeta)
  | ({ kind: "remediate_alt"; reason: string; presentation: Presentation } & TransitionMeta)
  // Graph prerequisite gate: the learner is routed to a graded scene of an UNMET prerequisite
  // (a different scene, not an alternate item for the same concept). Was reported as `next`
  // until the 2026-10-29 trial, where two harnesses read the detour as an ordinary advance.
  | ({ kind: "remediate"; reason: string; presentation: Presentation } & TransitionMeta)
  | ({ kind: "calibration"; targetConcept: string; presentation: Presentation } & TransitionMeta)
  // `calibration` rides on completion when a show_calibration_panel action fires on
  // the LAST scene (end-of-lesson self-check): there is no next scene to attach a
  // standalone `calibration` transition to, so the M3 feedback is surfaced here
  // instead of being silently dropped.
  | ({ kind: "complete"; summary: CompletionSummary; calibration?: { targetConcept: string } } & TransitionMeta);

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
