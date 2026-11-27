// The lesson archive check and install (route A, lot 1), re-exported for the VS Code extension: the extension reaches the
// host's code through this package (as present.ts does), and its type-check cannot import a file outside its own
// sources by a relative path. One implementation: packages/lesson-session-host/src/lesson-archive.ts.
export * from "../../lesson-session-host/src/lesson-archive.js";
