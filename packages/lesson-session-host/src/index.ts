// packages/lesson-session-host/src/index.ts
export { SessionHost, SessionHostNotFoundError, PeerRoomError, type SessionHostOptions } from "./host.js";
export { operatorContext } from "./operator-context.js";
export {
  reviewQueueFromState, conceptMemoryFromState, nextReinforcementFromState, reinforcementSceneFromState,
  dueReinforcementTargetsFromMemory,
  type ReviewQueueItem, type ReinforcementTarget, type CourseStep,
} from "./host.js";
export { SessionRegistry, type SessionEntry } from "./registry.js";
export { buildHostDeps, durableDataDir, durableScopeDir, telemetryConsentGranted } from "./deps.js";
export { resolveBundle } from "./bundle-resolver.js";
export { discoverCommunityBundles, COMMUNITY_DIR } from "./community-bundles.js";
export { shuffleQuizChoices } from "./shuffle-choices.js";
export { ResponseInputSchema } from "./response-input-schema.js";
export {
  publicScene, publicPresentation, publicTransition, REDACTED_SCENE_FIELDS, type PublicScene,
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
