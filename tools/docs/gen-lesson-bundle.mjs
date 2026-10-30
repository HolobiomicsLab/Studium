#!/usr/bin/env node
// tools/docs/gen-lesson-bundle.mjs — regenerate the field tables of docs/reference/lesson-bundle.md
// and docs/reference/lesson-bundle.fr.md from the Zod schemas of packages/lesson-bundle-schema (via
// zod-to-json-schema): the bundle, its metadata, concepts, the fields every scene shares, one table
// per scene type, adaptation rules, render assets, evidence and the assessment blueprint.
//
//   node tools/docs/gen-lesson-bundle.mjs           # rewrite the generated region of both pages
//   node tools/docs/gen-lesson-bundle.mjs --check   # exit 1 when a page is out of date
import { generatorMain, isEntry, runDump } from "./lib/generated.mjs";
import { rowsTable, schemaRows } from "./lib/schema-table.mjs";

export const REGION = "lesson-bundle";
export const PAGES = ["docs/reference/lesson-bundle.md", "docs/reference/lesson-bundle.fr.md"];

/** Where each nested part is described, so the top-level tables stay one level deep. */
const SEE = {
  metadata: "[Metadata](#metadata)",
  concepts: "[Concept](#concept)",
  scenes: "[Scene types](#scene-types)",
  rules: "[Adaptation rule](#adaptation-rule)",
  assessment_blueprint: "[Assessment blueprint](#assessment-blueprint)",
  render_assets: "[Render asset](#render-asset)",
  evidence: "[Evidence](#evidence)",
};

function withSee(rows) {
  return rows.map((row) => (SEE[row.path] ? { ...row, description: `See ${SEE[row.path]}.` } : row));
}

export function renderBundle(dump) {
  const out = [];
  const baseFields = Object.keys(dump.scene_base.properties ?? {});
  out.push(`Schema version: \`${dump.schema_version}\`. Field tables are generated from the Zod schemas; ` +
    "rules that span several fields (weights that sum to 1, ids that must exist) are checked by the schema " +
    "and the linter but do not appear here.", "");

  out.push("## Bundle", "");
  out.push(rowsTable(withSee(schemaRows(dump.bundle, { maxDepth: 0 }))), "");

  out.push("## Metadata", "");
  out.push(rowsTable(schemaRows(dump.metadata, { maxDepth: 1 })), "");

  out.push("## Concept", "");
  out.push(rowsTable(schemaRows(dump.concept, { maxDepth: 0 })), "");

  out.push("## Scene fields", "");
  out.push("Every scene, whatever its type, has these fields.", "");
  out.push(rowsTable(withSee(schemaRows(dump.scene_base, { maxDepth: 0 }))), "");

  out.push("## Scene types", "");
  out.push(`${dump.scene_types.length} types. Each table lists the fields a type adds to the [scene fields](#scene-fields).`, "");
  for (const type of dump.scene_types) {
    const schema = dump.scenes[type];
    if (!schema) continue;
    out.push(`### ${type}`, "");
    const rows = schemaRows(schema, { maxDepth: 3, skip: baseFields });
    out.push(rows.length ? rowsTable(rows) : "No field beyond the scene fields.", "");
  }

  out.push("## Adaptation rule", "");
  out.push(rowsTable(schemaRows(dump.rule, { maxDepth: 2 })), "");

  out.push("## Render asset", "");
  out.push(rowsTable(schemaRows(dump.render_asset, { maxDepth: 1 })), "");

  out.push("## Evidence", "");
  out.push(rowsTable(schemaRows(dump.evidence, { maxDepth: 2 })), "");

  out.push("## Assessment blueprint", "");
  out.push(rowsTable(schemaRows(dump.blueprint, { maxDepth: 3 })));
  return out.join("\n");
}

export function dumpSchema() {
  return runDump("dump-bundle-schema.mts");
}

export function render() {
  return renderBundle(dumpSchema());
}

if (isEntry(import.meta.url)) generatorMain(PAGES, REGION, render);
