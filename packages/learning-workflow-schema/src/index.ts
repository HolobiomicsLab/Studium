import { z } from "zod";

export const BloomLevelSchema = z.enum([
  "remember", "understand", "apply", "analyze", "evaluate", "create",
]);
export type BloomLevel = z.infer<typeof BloomLevelSchema>;

export const KnowledgeDimensionSchema = z.enum([
  "factual", "conceptual", "procedural", "metacognitive",
]);

export const SceneTypeSchema = z.enum([
  "intro", "concept", "quiz", "simulation", "reproduction", "discussion", "meta_checkpoint", "ai_critique",
]);

export const EdgeRelationSchema = z.enum([
  "prerequisite_for", "part_of", "decomposes_into", "assesses", "aligns_with",
]);
export type EdgeRelation = z.infer<typeof EdgeRelationSchema>;

export const ReproducibilityTierSchema = z.enum([
  "certified", "type-checked", "bypassed", "manual-only", "experimental",
]);
export const TaskOpennessSchema = z.enum(["closed", "open", "mixed"]);

export const SuterAxesSchema = z.object({
  coupling: z.enum(["tight", "loose", "ad_hoc"]),
  composition_modularity: z.enum(["flat", "hierarchical"]),
  abstraction_level: z.enum(["abstract", "intermediate", "concrete", "implicit"]),
  orchestration_planning: z.enum(["static", "dynamic", "event_driven"]),
  data_transport: z.enum(["file", "streaming", "in_memory"]),
});

export const WorkflowCharacterizationSchema = z.object({
  suter: SuterAxesSchema,
  reproducibility_tier: ReproducibilityTierSchema,
  task_openness: TaskOpennessSchema,
  scaffolding_level: z.enum(["light", "moderate", "heavy", "exploratory"]).optional(),
});

export const ConceptNodeSchema = z.object({
  id: z.string().min(1),
  node_kind: z.literal("concept"),
  title: z.string().min(1),
  bloom_level: BloomLevelSchema,
  knowledge_dimension: KnowledgeDimensionSchema.optional(),
  description: z.string().optional(),
});

export const TaskNodeSchema = z.object({
  id: z.string().min(1),
  node_kind: z.literal("task"),
  title: z.string().min(1),
  scene_type: SceneTypeSchema,
  objective_refs: z.array(z.string()).optional(),
  characterization: WorkflowCharacterizationSchema.optional(),
});

export const GraphNodeSchema = z.discriminatedUnion("node_kind", [
  ConceptNodeSchema, TaskNodeSchema,
]);
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  relation: EdgeRelationSchema,
  source: z.string().min(1),
  target: z.string().min(1),
  objective_id: z.string().optional(),
  bloom_level: BloomLevelSchema.optional(),
  aligns_uri: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  quality_flags: z.array(z.string()).optional(),
  astra_insight_ref: z.string().optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const LearningWorkflowGraphSchema = z.object({
  schema_version: z.literal("1.0"),
  course_id: z.string().min(1),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type LearningWorkflowGraph = z.infer<typeof LearningWorkflowGraphSchema>;

export function validateGraph(data: unknown): { valid: boolean; errors: string[] } {
  const r = LearningWorkflowGraphSchema.safeParse(data);
  if (r.success) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: r.error.issues.map((i) => `${i.path.join(".") || "/"} ${i.message}`),
  };
}
