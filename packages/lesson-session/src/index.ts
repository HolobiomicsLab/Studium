export const PACKAGE_NAME = "@studium/lesson-session";
export { matchClaimsAgainstCritique, type MatchResult } from "./grading/ai-audit-matcher.js";

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
} from "./errors.js";

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
