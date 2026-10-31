// tools/docs/lib/dump-bundle-schema.mts — print, as JSON on stdout, the JSON Schema of the lesson
// bundle (lesson.json) and of each of its parts, converted from the Zod schemas that every Studium
// reader validates against (packages/lesson-bundle-schema/src). Run through tsx by
// tools/docs/gen-lesson-bundle.mjs.
import { zodToJsonSchema } from "../../../apps/lesson-mcp/node_modules/zod-to-json-schema/dist/esm/index.js";
import {
  SCHEMA_VERSION, LessonBundleSchema, BundleMetadataSchema, BundleAuthoringSchema, ConceptSchema,
  SceneBaseSchema, SceneSchema, SceneTypeSchema, AdaptationRuleSchema, AssessmentBlueprintSchema,
  EvidenceSchema, RenderAssetSchema,
} from "../../../packages/lesson-bundle-schema/src/index.ts";

const json = (schema: Parameters<typeof zodToJsonSchema>[0]) => zodToJsonSchema(schema, { $refStrategy: "none" });

const scenes: Record<string, unknown> = {};
for (const option of SceneSchema.options) {
  const type = (option.shape.type as { value: string }).value;
  scenes[type] = json(option);
}

process.stdout.write(JSON.stringify({
  schema_version: SCHEMA_VERSION,
  scene_types: SceneTypeSchema.options,
  bundle: json(LessonBundleSchema),
  metadata: json(BundleMetadataSchema),
  authoring: json(BundleAuthoringSchema),
  concept: json(ConceptSchema),
  scene_base: json(SceneBaseSchema),
  evidence: json(EvidenceSchema),
  render_asset: json(RenderAssetSchema),
  rule: json(AdaptationRuleSchema),
  blueprint: json(AssessmentBlueprintSchema),
  scenes,
}));
