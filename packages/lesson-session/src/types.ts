// packages/lesson-session/src/types.ts
import type { Locale } from "./phrases.js";
import type { Scene, LessonBundle, AuthoringMode } from "@studium/lesson-bundle-schema";
import type { LearnerState, Decision } from "@studium/learner-state";
import type {
  StateStore, EventLog, TelemetrySink, PseudonymProvider,
  ReasoningScorer, CritiqueEvaluator, AuditJudge, Clock, IdGen, MasteryClaimSink, SocraticTutor,
} from "./ports.js";
import type { PublicDeckItem } from "./grading/deck.js";
import type { SelfRatingRequest } from "./self-rating.js";

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
  /** Fresh hint requests available on this replay/remediation visit. */
  hints_available?: number;
  /** Learner-facing locale resolved once from `bundle.metadata.language` (fr unless `en`). */
  locale: Locale;
  /** Who wrote the lesson, as every surface states it: the bundle's `metadata.authoring` (absent =
   * teacher), whether `validated_by` names a validating teacher (not a DRAFT / SELF-STUDY
   * placeholder), whether the host has a judge model (without one, production scenes are not
   * certified), and the learner-facing self-study notice (null for a teacher lesson). Set by the
   * session host on every presentation it serves; the engine leaves it unset. Kept as a type
   * literal so packages that only see this barrel can still name it. */
  authoring?: { mode: AuthoringMode; author_is_learner: boolean; validated: boolean; judge: boolean; notice: string | null };
}

// `confidence?` (0..4) is the optional per-answer self-rating — the path to CONTINUOUS calibration
// (capture-ready but currently UNFED by any UI; the live calibration input today is the meta-checkpoint).
// When present the engine folds it into the concept's confidence_calibration on that graded answer.
export type ResponseInput =
  | { kind: "ack" }
  | { kind: "quiz_choice"; choiceId: string; confidence?: 0 | 1 | 2 | 3 | 4 }
  | { kind: "confidence"; value: 0 | 1 | 2 | 3 | 4 }
  | { kind: "confidence"; pre: 0 | 1 | 2 | 3 | 4; post: 0 | 1 | 2 | 3 | 4 }
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
  mastery: Record<string, number>;
  scenes_detoured: Record<string, number>;
}

/** What the engine concluded about the response that was just submitted. Carried on the
 * transition because the public scene no longer ships `feedback_correct` / `feedback_incorrect`
 * (they were an answer key readable before answering): the feedback the learner is owed travels
 * with the verdict, after the answer, and only the matching half. `graded: false` on ack-only
 * scenes (intro, concept, meta_checkpoint…). `correct` is set for choice-graded answers only;
 * free-text graders report their signal kind in `signal` and no boolean. */
export interface Verdict {
  scene_id: string;
  /** An answer was submitted (`answer_submitted`): NOT a claim that anything assessed it — read
   * `assessed_by` for that. */
  graded: boolean;
  signal: string;
  /** Who assessed the answer (L-7): the author's key (a quiz choice, the verdict deck — scored by
   * identity), a judge (an LLM evaluation, or an LLM audit judge's measured counts even when no pass
   * was certified), or nobody (an unjudged production answer, an acknowledgement). Additive. */
  assessed_by: "key" | "judge" | "none";
  correct?: boolean;
  feedback?: string;
  detail?: { caught: number; planted: number; false_positives: number; sound_total: number };
  /** The reference a graded key-point, audit or critique scene is compared against (lead decision
   * I-1): its key points' texts (explain_back, comparison, prompt_practice, communication_sim), the
   * claims that hid a planted flaw (spot_the_flaw, summary_audit), or, for ai_critique, one line per
   * claim that hid a flaw with the flaws its author expected (integration tail T3). Released with the
   * verdict only; `feedback` does not repeat it. */
  key_points?: string[];
  /** The key points (texts, a subset of `key_points`) a judge found the answer did not cover. Set only
   * when a judge measured coverage; part of the reference, so released with it and never repeated
   * in `feedback`, which carries the measured count only. */
  key_points_missing?: string[];
  /** The model answer of a graded key-point scene, or the model correction of an audit (I-1). */
  model_answer?: string;
  /** What `key_points` holds, so a surface can label it: the key points an answer should cover, the
   * planted flaws an audit should have caught, the claims a critique should have challenged
   * (`flawed_claims`, ai_critique), or the text of the correct choice(s) of an author-keyed quiz the
   * learner answered wrong (`correct_choice`, L-2 — held back on a retry of the item like the rest of
   * the reference, I-2). Set whenever `key_points` is. */
  reference_kind?: "key_points" | "planted_flaws" | "flawed_claims" | "correct_choice";
}

/** The ONE navigation decision behind a transition, stated once. Before this field the same
 * decision was spread over three places that could disagree: `transition.kind`, the rule engine's
 * `presentation.lastDecision` (which says `advance_to_next_scene` even when the graph gate routed
 * back) and `explain_last_adaptation`. `kind` is the routing outcome; `rule_id` / `modulator` name
 * the rule that produced it (null for a plain advance); `returns_to` is the scene the learner will
 * actually resume once the detour ends, and `scene_id` is the scene being presented. */
export interface Navigation {
  kind: "advance" | "replay" | "remediate_alt" | "remediate" | "gate_passed" | "gate_released"
      | "gate_unassessable" | "skip_mastered" | "skip_concept" | "calibration" | "complete";
  scene_id: string | null;
  rule_id: string | null;
  reason: string | null;
  modulator: string | null;
  returns_to?: string;
  skipped_scene_ids?: string[];
}

/** `self_rating` (C4): set after a production answer no judge certified — the learner compares
 * their answer with the reference shown in the verdict, then rates their recall with
 * `LessonSession.rateRecall`. FSRS input only; it never moves mastery. */
interface TransitionMeta { verdict?: Verdict; navigation?: Navigation; self_rating?: SelfRatingRequest }

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
