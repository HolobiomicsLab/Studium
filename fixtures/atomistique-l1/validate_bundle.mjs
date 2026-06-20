// Validate the authored bundle against the FULL TS schema (scenes + render_assets + LWG).
// Run from repo root:  node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/validate_bundle.mjs
import { readFileSync } from "node:fs";
import { LessonBundleSchema, sceneRenderAssets } from "../../packages/lesson-bundle-schema/src/index.ts";

const data = JSON.parse(readFileSync(new URL("./lesson.json", import.meta.url), "utf8"));
const r = LessonBundleSchema.safeParse(data);
if (!r.success) {
  console.error("FAIL — LessonBundleSchema:");
  console.error(JSON.stringify(r.error.issues.slice(0, 25), null, 2));
  process.exit(1);
}
const b = r.data;
const kinds = b.scenes.flatMap((s) => sceneRenderAssets(s).map((a) => a.kind));
const tally = kinds.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
console.log("OK — TS LessonBundleSchema");
console.log("  bundle:", b.bundle_id, "scenes:", b.scenes.length);
console.log("  LWG:", b.learning_workflow_graph?.nodes.length, "nodes /", b.learning_workflow_graph?.edges.length, "edges");
console.log("  render manifest kinds:", JSON.stringify(tally));
