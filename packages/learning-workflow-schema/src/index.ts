import { z } from "zod";

export const BloomLevelSchema = z.enum([
  "remember", "understand", "apply", "analyze", "evaluate", "create",
]);
export type BloomLevel = z.infer<typeof BloomLevelSchema>;

export const KnowledgeDimensionSchema = z.enum([
  "factual", "conceptual", "procedural", "metacognitive",
]);
export type KnowledgeDimension = z.infer<typeof KnowledgeDimensionSchema>;

export const SceneTypeSchema = z.enum([
  "intro", "concept", "quiz", "simulation", "reproduction", "discussion", "meta_checkpoint", "ai_critique",
  // active-learning task nodes (assess the learner via a free-response active scene):
  "spot_the_flaw", "explain_back",
]);
export type SceneType = z.infer<typeof SceneTypeSchema>;

export const EdgeRelationSchema = z.enum([
  "prerequisite_for", "part_of", "decomposes_into", "assesses", "aligns_with",
]);
export type EdgeRelation = z.infer<typeof EdgeRelationSchema>;

export const ReproducibilityTierSchema = z.enum([
  "certified", "type-checked", "bypassed", "manual-only", "experimental",
]);
export type ReproducibilityTier = z.infer<typeof ReproducibilityTierSchema>;

export const TaskOpennessSchema = z.enum(["closed", "open", "mixed"]);
export type TaskOpenness = z.infer<typeof TaskOpennessSchema>;

export const SuterAxesSchema = z.object({
  coupling: z.enum(["tight", "loose", "ad_hoc"]),
  composition_modularity: z.enum(["flat", "hierarchical"]),
  abstraction_level: z.enum(["abstract", "intermediate", "concrete", "implicit"]),
  orchestration_planning: z.enum(["static", "dynamic", "event_driven"]),
  data_transport: z.enum(["file", "streaming", "in_memory"]),
});
export type SuterAxes = z.infer<typeof SuterAxesSchema>;

export const WorkflowCharacterizationSchema = z.object({
  suter: SuterAxesSchema,
  reproducibility_tier: ReproducibilityTierSchema,
  task_openness: TaskOpennessSchema,
  scaffolding_level: z.enum(["light", "moderate", "heavy", "exploratory"]).optional(),
});
export type WorkflowCharacterization = z.infer<typeof WorkflowCharacterizationSchema>;

export const ConceptNodeSchema = z.object({
  id: z.string().min(1),
  node_kind: z.literal("concept"),
  title: z.string().min(1),
  bloom_level: BloomLevelSchema,
  knowledge_dimension: KnowledgeDimensionSchema.optional(),
  description: z.string().optional(),
});
export type ConceptNode = z.infer<typeof ConceptNodeSchema>;

export const TaskNodeSchema = z.object({
  id: z.string().min(1),
  node_kind: z.literal("task"),
  title: z.string().min(1),
  scene_type: SceneTypeSchema,
  objective_refs: z.array(z.string()).optional(),
  characterization: WorkflowCharacterizationSchema.optional(),
});
export type TaskNode = z.infer<typeof TaskNodeSchema>;

export const GraphNodeSchema = z.discriminatedUnion("node_kind", [
  ConceptNodeSchema, TaskNodeSchema,
]);
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEvidenceSchema = z.object({
  doi: z.string().optional(),
  artifact: z.string().optional(),
  quote: z.string().optional(),
  page: z.number().int().optional(),
  confidence: z.number().min(0).max(1).optional(),
  decision_context: z.array(z.string()).optional(),
});
export type GraphEvidence = z.infer<typeof GraphEvidenceSchema>;

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
  evidence: z.array(GraphEvidenceSchema).optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const LearningWorkflowGraphSchema = z.object({
  schema_version: z.literal("1.0"),
  course_id: z.string().min(1),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
}).superRefine((g, ctx) => {
  const dup = (ids: string[]) => { const s = new Set<string>(); return ids.find((x) => s.size === s.add(x).size); };
  const ndup = dup(g.nodes.map((n) => n.id));
  if (ndup) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate node id: ${ndup}`, path: ["nodes"] });
  const edup = dup(g.edges.map((e) => e.id));
  if (edup) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate edge id: ${edup}`, path: ["edges"] });
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
