// packages/lesson-session-host/src/index.ts
export {
  SessionHost, SessionHostNotFoundError, RunRequiredError, RUN_REQUIRED_MESSAGE, PeerRoomError,
  type SessionHostOptions, type SessionStartOptions, type SessionStartResult, type SessionResume,
  type ServedPresentation, type ServedTransition, type ServedVerdict, type ReviewPlan, type RecallRating,
  type ListedLesson, type LessonListing, type ReviewItem, type ReviewStartResult,
  type ReinforcementStatus, type RoutedReinforcementTarget, type ForgetReport, type ForgetItem, type ConceptMapExport, type ContestStart,
  type PromptSurface, type ServeOptions,
} from "./host.js";
// The 2026-10-30 verification fixes: a session's clock and now_ms (L-1), one time zone for every date
// (RFR-13), the review scene choice (L-8).
export { NowMsSchema, NOW_MS_MAX, checkNowMs, OffsetClock } from "./session-clock.js";
export { calendarDate, checkTimeZone, localTimeZone } from "./calendar.js";
export { pickReviewScene, isDiagnosticScene, DEFAULT_REVIEW_ITEMS, MAX_REVIEW_ITEMS } from "./review-session.js";
// The study loop (sprint 2026-10-30, W2): where lessons and learner data live (C6), the chat text of
// every presentation and transition (HJ-4), a chat reply as an answer, the self-rating grades (C4).
export { resolvePersistence, persistenceInfo, DEFAULT_LEARNER_ID, type PersistenceConfig, type PersistenceInfo } from "./persistence.js";
export { STATUS_FILE, STATUS_SCHEMA, statusFilePath, type StatusFile } from "./status-file.js";
export {
  presentationMarkdown, replyHintMarkdown, transitionMarkdown, verdictMarkdown, recallRatedMarkdown, nothingToReviewMarkdown, formatReviewDate,
  lessonListMarkdown, forgetMarkdown, promptsMarkdown, promptAnswerMarkdown, contestOpenedMarkdown, type DisplayLocale, type ListedLessonLine, type ForgetDisplayItem,
} from "./chat-display.js";
export { replyToInput, checkDisplayedChoice, ResponseInputError } from "./reply-mapping.js";
export { type SelfRating } from "./fsrs-memory.js";
export { type StudyPlan, type StudyItem, DEFAULT_REVIEW_SECONDS } from "./study-plan.js";
export { type CatalogLesson, type LessonRoot } from "./lesson-catalog.js";
export { operatorContext } from "./operator-context.js";
// INT-STUDIUM-058: where the learner is, as data and as one status line (every surface reads these).
export {
  orientationOf, orientationFrom, statusLine, STATUS_LINE_MAX, voicesOf, authorVoice, verdictVoice, voiceLine, VOICE_LINE_MAX,
  helpOf, helpFrom,
  type Orientation, type OrientationFacts, type Waiting, type LastNavigation, type Voice, type Voices, type Help, type HelpRung,
} from "./orientation.js";
// INT-STUDIUM-058 § 2.5: what the learner did since the agent last looked.
export { BRIEF_ACTS_MAX, COMPANION_RULES, type ActKind, type ActReceived, type CompanionAct, type CompanionBrief, type InteractionAct, type Lane } from "./companion.js";
export {
  NOTICE_KINDS, PROMPT_BUDGET, PROMPT_KINDS, PromptBook, PromptRefusedError, noticeCandidate, promptCandidates, resumeNoticeCandidate,
  type PromptAttention, type PromptCandidate, type PromptKind, type PromptOutcome, type PromptRecord, type PromptWaiting, type TriggerFacts,
} from "./prompts.js";
export {
  CONTEST_QUESTIONS, ContestRefusedError, checkScenes, claimFor, contestOutcome,
  type ContestClaim, type ContestOutcome, type RecordContest,
} from "./contest.js";
export {
  buildConceptMap, type ConceptMap, type ConceptMapNode, type ConceptMapEdge, type ConceptMapState, type ConceptMapMoment,
} from "./concept-map.js";
export {
  buildConceptMapRecord, CONCEPT_MAP_RECORD_SCHEMA, type ConceptMapRecord, type RecordScene, type RecordSource,
  type RecordSourceOrigin, type RecordStep,
} from "./concept-map-record.js";
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
// INT-STUDIUM-058 § 2.9: the review inbox (host.js already exports a ReviewItem: the FSRS review queue).
export {
  buildReviewInbox, canonicalJson, readLastReceipt, sceneFingerprint, sceneHoldsKey, scenePreview, CONSEQUENCES, REVIEW_RECEIPT_SCHEMA,
  type BuildReviewInboxInput, type Consequence, type ReceiptSummary, type ReviewInbox, type ReviewItem as ReviewInboxItem,
  type ReviewReceipt, type ScenePreview, type WhatChanged,
} from "./review-inbox.js";
// The conversational author (sprint 2026-10-30, W1; C1, C2): apps/lesson-mcp/src/authoring-tools.ts
// binds these to the get_authoring_guide, prepare_sources and create_lesson tools.
export {
  AuthoringInputError, GUIDE_VERSION, LessonDraftSchema, authoringGuide, createLesson, guideLanguageOf, prepareSources,
  MAX_SOURCES, MAX_SOURCE_CHARS, MAX_TOTAL_SOURCE_CHARS, SOURCE_KINDS, lintBundleData, placeholderPaths,
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
