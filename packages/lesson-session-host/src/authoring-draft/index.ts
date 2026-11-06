// packages/lesson-session-host/src/authoring-draft/index.ts
//
// The conversational author over MCP (sprint 2026-10-30, W1; contracts C1, C2, C3): sources →
// passages (prepare_sources), the brief (get_authoring_guide), a checked draft → a lesson in the
// learner's library (create_lesson). apps/lesson-mcp/src/authoring-tools.ts binds them to MCP.
export { chunkText, DEFAULT_MAX_CHARS, DEFAULT_MIN_CHARS, type ChunkedText } from "./passages.js";
export {
  AuthoringInputError, MAX_SOURCE_CHARS, MAX_SOURCES, MAX_TOTAL_SOURCE_CHARS, prepareSources, SOURCE_KINDS, type SourceKind, readSourceSet, SOURCE_SET_ID_PATTERN, SOURCES_DIR,
  type Passage, type PrepareOptions, type SourceInput, type SourceSet,
} from "./source-set.js";
export { checkQuote, MAX_QUOTE_CHARS, MIN_QUOTE_CHARS, normalizeQuoteText, sourceSpan, type QuoteCheck } from "./quotes.js";
export { DraftSceneSchema, LessonDraftSchema, type DraftScene, type LessonDraft } from "./draft-schema.js";
export { authoringGuide, GUIDE_VERSION, guideLanguageOf, type AuthoringGuide, type GuideLanguage, type GuideMode } from "./guide.js";
export {
  createLesson, keyClassesOf, LESSON_FILENAME, SELF_STUDY_VALIDATED_BY,
  type CreateLessonInput, type CreateLessonOptions, type CreateLessonResult, type KeyClasses, type LessonOutline,
} from "./build.js";
export { lintBundleData, placeholderPaths, type LintFinding } from "./lint.js";
