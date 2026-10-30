export const PACKAGE_NAME = "@studium/lesson-session";
export { matchClaimsAgainstCritique, type MatchResult } from "./grading/ai-audit-matcher.js";

// Verdict deck — the deterministic, opaque-token projection + grader shared with publicScene (host).
export { verdictDeck, publicDeck, scoreVerdictDeck } from "./grading/deck.js";
export type { DeckItem, PublicDeckItem, DeckScore, ClaimText } from "./grading/deck.js";

// Gate-validity harness (Direction 2): synthetic-learner construct validation of the trust gate.
export { runGateValidity, simulateVerdicts, CANONICAL_LEARNERS } from "./gate-validity.js";
export type { Disposition, SyntheticLearner, GateValidityRow } from "./gate-validity.js";

// Core class
export { LessonSession } from "./session.js";

// Grading
export { grade } from "./grading/index.js";

// Errors
export {
  SessionError,
  SessionNotStartedError,
  SessionAlreadyCompleteError,
  SceneGradingError,
  SelfRatingNotRequestedError,
  SelfRatingExpiredError,
  InvalidSelfRatingError,
} from "./errors.js";

// Self-rating after an uncertified production answer (contract C4): FSRS input, never mastery.
export { SELF_RATING_CHOICES } from "./self-rating.js";
export type { SelfRatingRequest, SelfRatingRecord } from "./self-rating.js";

// Telemetry helpers
export { enrichEvent, bundleVersionOf } from "./telemetry.js";

// Types — types.ts
export type {
  Presentation,
  ResponseInput,
  Transition,
  CompletionSummary,
  Explanation,
  LearnerSnapshot,
  SessionDeps,
  HintResult,
} from "./types.js";

// Types — ports.ts
export type {
  StateStore,
  EventLog,
  EventLogRecord,
  TelemetrySink,
  PseudonymProvider,
  ReasoningScorer,
  CritiqueEvaluator,
  CritiqueEvaluation,
  AuditJudge,
  AuditInput,
  AuditJudgement,
  SoundClaim,
  Clock,
  IdGen,
  Claim,
  AICritiqueRubric,
} from "./ports.js";

// Adapters — the over-distrust-capable audit judge (offline stub + LLM-backed).
export { StubAuditJudge, HttpLlmAuditJudge } from "./adapters/audit-judge.js";

// Types — telemetry.ts
export type { TelemetryContext, EmitInput } from "./telemetry.js";
