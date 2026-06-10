// packages/lesson-session-host/src/index.ts
export { SessionHost, SessionHostNotFoundError, type SessionHostOptions } from "./host.js";
export { SessionRegistry, type SessionEntry } from "./registry.js";
export { buildHostDeps } from "./deps.js";
export { resolveBundle } from "./bundle-resolver.js";
export { ResponseInputSchema } from "./response-input-schema.js";
