// packages/typed-graph-lens/src/index.ts
//
// A reusable "typed graph + live state" lens. The main entry is the PROJECT-AGNOSTIC core
// (schema + cytoscape transform + ego filter + style registry) — no project deps, so a webview host
// can import it cheaply. Per-project adapters live under their own subpath, e.g.
//   import { lwgToGraphView } from "@studium/typed-graph-lens/adapters/studium"
// (kept off the main entry so consumers that only render don't pull a project's runtime deps).
export * from "./schema.js";
export * from "./style.js";
export * from "./cytoscape.js";
export * from "./ego.js";
