// packages/lesson-session-host/src/authoring-draft/lint.ts
//
// The repository's bundle linter (tools/bundle_lint.mjs), run in process: the conversational
// author lints the bundle it is about to write with the same rules as `node tools/bundle_lint.mjs`.
// The reference (not an import: the file declares a module by pattern) puts those types in every
// program that compiles this file, apps/lesson-mcp's included.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./bundle-lint.d.ts" />
export { lintBundleData, placeholderPaths, type LintFinding } from "../../../../tools/bundle_lint.mjs";
