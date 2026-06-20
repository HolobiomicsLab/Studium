// packages/typed-graph-lens/src/schema.ts
//
// A project-agnostic, normalized "typed graph + live state" interchange. Studium's Learning
// Workflow Graph, indicium's claim/evidence graph, and Astra's reasoning trace are all the same
// shape — a typed, directed, attributed graph with per-node live state. A single viewer renders
// any of them: each project ships an adapter that emits a GraphView, plus a type→style registry.
import { z } from "zod";

/** Live per-node state overlay. `neutral` = no live state (e.g. a task node, or a non-Studium domain). */
export const NodeStateSchema = z.enum([
  "locked", "available", "in_progress", "current", "mastered", "neutral",
]);
export type NodeState = z.infer<typeof NodeStateSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1), // domain node type: "concept" | "task" | "claim" | "reasoning_step" …
  label: z.string(),
  group: z.string().optional(), // a sub-category that drives styling: bloom level / claim status / lens
  state: NodeStateSchema.optional(),
  value: z.number().optional(), // a scalar to surface (mastery 0..1, confidence, evidence strength)
  attrs: z.record(z.unknown()).optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().min(1), // relation: "prerequisite_for" | "assesses" | "supports" | "refutes" …
  attrs: z.record(z.unknown()).optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const LegendEntrySchema = z.object({ swatch: z.string(), label: z.string() });

export const GraphViewSchema = z.object({
  schema: z.literal("typed-graph-lens/1.0"),
  domain: z.string(), // "studium-lwg" | "indicium-claims" | "astra-trace" …
  title: z.string().optional(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  focus: z.string().optional(), // the "current"/active node to spotlight
  legend: z.array(LegendEntrySchema).optional(),
});
export type GraphView = z.infer<typeof GraphViewSchema>;

/** A single node's state change between two overlays — the unit of the live "state channel". */
export const StateDeltaSchema = z.object({
  nodeId: z.string(),
  prevState: NodeStateSchema.nullable(),
  newState: NodeStateSchema,
  value: z.number().optional(),
});
export type StateDelta = z.infer<typeof StateDeltaSchema>;

/** Diff two GraphViews (same topology, evolving state) → the deltas to animate. Pure. */
export function diffStates(prev: GraphView, next: GraphView): StateDelta[] {
  const prevById = new Map(prev.nodes.map((n) => [n.id, n]));
  const out: StateDelta[] = [];
  for (const n of next.nodes) {
    const before = prevById.get(n.id);
    const a = before?.state ?? null;
    const b = n.state ?? "neutral";
    if (a !== b || before?.value !== n.value) {
      out.push({ nodeId: n.id, prevState: a, newState: b, ...(n.value !== undefined ? { value: n.value } : {}) });
    }
  }
  return out;
}
