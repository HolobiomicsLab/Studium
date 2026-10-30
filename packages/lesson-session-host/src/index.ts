// packages/lesson-session-host/src/index.ts
export {
  SessionHost, SessionHostNotFoundError, RunRequiredError, RUN_REQUIRED_MESSAGE, PeerRoomError,
  type SessionHostOptions, type SessionStartOptions, type SessionStartResult, type SessionResume,
  type ServedPresentation, type ServedTransition, type ServedVerdict, type ReviewPlan, type RecallRating,
  type ListedLesson, type LessonListing, type ReviewItem, type ReviewStartResult,
  type ReinforcementStatus, type RoutedReinforcementTarget,
} from "./host.js";
// The study loop (sprint 2026-10-30, W2): where lessons and learner data live (C6), the chat text of
// every presentation and transition (HJ-4), a chat reply as an answer, the self-rating grades (C4).
export { resolvePersistence, persistenceInfo, DEFAULT_LEARNER_ID, type PersistenceConfig, type PersistenceInfo } from "./persistence.js";
export {
  presentationMarkdown, transitionMarkdown, verdictMarkdown, recallRatedMarkdown, nothingToReviewMarkdown, formatReviewDate,
  type DisplayLocale,
} from "./chat-display.js";
export { replyToInput, checkDisplayedChoice, ResponseInputError } from "./reply-mapping.js";
export { type SelfRating } from "./fsrs-memory.js";
export { type StudyPlan, type StudyItem } from "./study-plan.js";
export { type CatalogLesson, type LessonRoot } from "./lesson-catalog.js";
export { operatorContext } from "./operator-context.js";
export {
  reviewQueueFromState, conceptMemoryFromState, nextReinforcementFromState, reinforcementSceneFromState,
  dueReinforcementTargetsFromMemory,
  type ReviewQueueItem, type ReinforcementTarget, type CourseStep,
} from "./host.js";
export { SessionRegistry, type SessionEntry } from "./registry.js";
export { buildHostDeps, durableDataDir, durableScopeDir, telemetryConsentGranted } from "./deps.js";
export { resolveBundle, loadResolvedBundle, type ResolvedBundle } from "./bundle-resolver.js";
export {
  discoverCommunityBundles, discoverCommunityBundleEntries, COMMUNITY_DIR, COURSE_ID_PATTERN,
  type CommunityBundleEntry,
} from "./community-bundles.js";
export {
  authoringOf, readApproval, draftedByOf, isTeacherValidated, SELF_STUDY_NOTICE, AGENT_DRAFTED_NOTICE,
  type AuthoringBlock, type ApprovalStatus, type DraftedBy,
} from "./authoring.js";
export { SCENE_KEY_CLASS, keyClassOf, type KeyClass } from "./key-class.js";
// The conversational author (sprint 2026-10-30, W1; C1, C2): apps/lesson-mcp/src/authoring-tools.ts
// binds these to the get_authoring_guide, prepare_sources and create_lesson tools.
export {
  AuthoringInputError, GUIDE_VERSION, LessonDraftSchema, authoringGuide, createLesson, guideLanguageOf, prepareSources,
  MAX_SOURCES, MAX_SOURCE_CHARS, MAX_TOTAL_SOURCE_CHARS, lintBundleData, placeholderPaths,
  type CreateLessonInput, type CreateLessonResult, type LessonDraft, type SourceSet, type LintFinding as BundleLintFinding,
} from "./authoring-draft/index.js";
export { shuffleQuizChoices } from "./shuffle-choices.js";
export { ResponseInputSchema, RESPONSE_KINDS, type HostResponseInput, type ReplyInput, type UnnamedQuizChoice } from "./response-input-schema.js";
export { ExperimentInputSchema, type ExperimentInput, type ExperimentDocument } from "./experiment-journal.js";
export {
  publicScene, publicPresentation, publicTransition, citedSources, REDACTED_SCENE_FIELDS, type PublicScene, type CitedSource,
} from "./public-scene.js";
export {
  SessionWorkspace, type WorkspaceIndex, type WorkspaceStepEntry,
} from "./session-workspace.js";
export { RunResultSchema, parseRunResult, runResultToReferenceRun, type RunResult } from "./run-result.js";
export {
  PROFILE_PSEUDONYM_SCOPE, FileLearnerProfileStore, InMemoryLearnerProfileStore, type LearnerProfileStore,
} from "./learner-profile-store.js";
export { resolveCourse } from "./course-resolver.js";
export {
  StubJudgmentGenerator, HttpLlmJudgmentGenerator,
  type JudgmentGenerator, type JudgmentGenInput, type GeneratedFlaw,
} from "./judgment-generator.js";
export {
  runStudiumSession, stubOperator, watchOperator, makeLlmOperator, writeResponse, writeRunResult,
  type Operator, type OperatorCtx, type OperatorLlm, type SessionRunResult,
} from "./session-runner.js";
export {
  aggregateRatings, distinctRaters, ROOM_K_FLOOR,
  type PeerRating, type RoomEntry, type TargetAggregate, type RoomState,
} from "./room.js";
