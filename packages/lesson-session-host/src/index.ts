// packages/lesson-session-host/src/index.ts
export { SessionHost, SessionHostNotFoundError, type SessionHostOptions } from "./host.js";
export { SessionRegistry, type SessionEntry } from "./registry.js";
export { buildHostDeps, durableDataDir, durableScopeDir, telemetryConsentGranted } from "./deps.js";
export { resolveBundle } from "./bundle-resolver.js";
export { discoverCommunityBundles, COMMUNITY_DIR } from "./community-bundles.js";
export { shuffleQuizChoices } from "./shuffle-choices.js";
export { ResponseInputSchema } from "./response-input-schema.js";
export {
  publicScene, publicPresentation, publicTransition, REDACTED_SCENE_FIELDS, type PublicScene,
} from "./public-scene.js";
