// packages/lesson-session/src/ports.ts
import type { LearnerState } from "@studium/learner-state";
import type { TelemetryEvent } from "@studium/telemetry-events";
import type { MasteryClaimsDoc } from "./mastery-claims.js";
import type { ClassifyResult } from "@studium/reasoning-scorer";
import type { Scene } from "@studium/lesson-bundle-schema";
import type { TutorMove, TutorInput } from "./socratic-tutor/types.js";

type AICritiqueScene = Extract<Scene, { type: "ai_critique" }>;
export type Claim = AICritiqueScene["claims"][number];
export type AICritiqueRubric = AICritiqueScene["rubric"];

export interface StateStore {
  load(lessonId: string): Promise<LearnerState | null>;
  save(lessonId: string, state: LearnerState): Promise<void>;
  /** RGPD erasure (#4): remove the persisted learner state for this lesson. Optional so existing
   * adapters/tests that predate erasure stay valid; callers guard with `?.`. */
  delete?(lessonId: string): Promise<void>;
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
export interface EventLog {
  append(record: EventLogRecord): Promise<void>;
  /** RGPD erasure (#4): drop this session's appended records. The host gives each session its own
   * log, so purging the whole log is this learner's data only. Optional + `?.`-guarded. */
  purge?(): Promise<void>;
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
  flush(): Promise<void>;
  /** RGPD erasure (#4): drop buffered/recorded telemetry (pseudonymous, but erased for completeness). */
  purge?(): Promise<void>;
}

/** Per-learner SALTED pseudonym (#4): HMAC(secret, learnerId + ':' + lessonId). The learnerId salt
 * makes distinct learners on the same lesson resolve to distinct pseudonyms. */
export interface PseudonymProvider { get(learnerId: string, lessonId: string): Promise<string>; }

export interface ReasoningScorer { score(turn: string, topic: string): Promise<ClassifyResult | null>; }

export interface SocraticTutor { respond(input: TutorInput): Promise<TutorMove | null>; }

export interface CritiqueEvaluation { score: number; feedback: string; }
export interface CritiqueEvaluator {
  evaluate(input: { claims: Claim[]; rubric: AICritiqueRubric; critique: string }): Promise<CritiqueEvaluation>;
}

/** A claim in a flawed AI reading that is actually CORRECT — a good auditor must NOT flag it. The
 * answer key for the OVER-DISTRUST direction (server-side, stripped by publicScene). */
export interface SoundClaim { id: string; text: string; }

/** Structured verdict of a grounded judgment audit. Unlike the keyword matcher (which only carries the
 * planted-flaw key and so can never tell praise from blame), an AuditJudge is told BOTH the planted
 * flaws and the sound claims, so it can report whether the critique CAUGHT real flaws (over-trust
 * direction) AND whether it WRONGLY flagged sound claims (over-distrust direction). */
export interface AuditJudgement {
  /** ids of planted flaws the critique correctly identified. */
  caught_flaw_ids: string[];
  /** ids of SOUND claims the critique wrongly called flawed → feeds over-distrust. */
  wrongly_flagged_sound_ids: string[];
}
export interface AuditInput {
  flawed_content: string;
  flawed_claims: Array<{ id: string; text: string }>;
  sound_claims: SoundClaim[];
  critique: string;
}
/** LLM-backed judge that detects BOTH directions of mis-trust. Optional dep: when absent (the offline
 * default), the grader falls back to the keyword matcher and over-distrust stays structurally 0 (the
 * documented honesty boundary). Injecting a live AuditJudge is what makes over-distrust measurable. */
export interface AuditJudge { judge(input: AuditInput): Promise<AuditJudgement>; }

export interface Clock { now(): string; }   // ISO 8601 string
export interface IdGen { uuid(): string; }

/** Local-only sink for learner mastery claims (RGPD: personal data — there is intentionally NO
 * HTTP/forwarding implementation of this port; only in-memory + file). */
export interface MasteryClaimSink {
  emit(doc: MasteryClaimsDoc): void;
  flush(): Promise<void>;
  /** RGPD erasure (#4): drop any unflushed buffer AND remove this session's already-flushed
   * mastery .jsonld (the personal-data sink). Optional + `?.`-guarded. */
  erase?(): Promise<void>;
}
