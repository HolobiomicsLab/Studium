// packages/typed-graph-lens/src/adapters/studium.ts
//
// Studium adapter: a Learning Workflow Graph + live per-concept mastery → a normalized GraphView.
// This is the ONLY Studium-aware code in the package; indicium / Astra would each add their own
// adapter (claim graph, reasoning trace) and reuse the same schema + cytoscape + style + ego core.
import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";
import { isAvailable, nextConcept, DEFAULT_THETA, type Mastery } from "@studium/adaptation-engine";
import type { GraphView, GraphNode, GraphEdge, NodeState } from "../schema.js";

/** Live status of a concept, read from the runtime LearnerState (masteryOf + total_attempts). */
export interface ConceptStatus {
  mastery: number; // alpha/(alpha+beta) ∈ [0,1]
  attempts: number; // total graded attempts
}

export interface LwgViewOptions {
  theta?: number; // availability threshold (default 0.8)
  minAttempts?: number; // certification floor (default 3) — mastered needs posterior AND attempts
  masteredPosterior?: number; // default DEFAULT_THETA (0.8) — mirrors the engine's mastery certification
  title?: string;
}

const BLOOM_SWATCH: Record<string, string> = {
  remember: "#8957e5", understand: "#6e40c9", apply: "#1f6feb",
  analyze: "#1a7f37", evaluate: "#9e6a03", create: "#bc4c00",
};

/** Map (LWG + concept statuses) → GraphView. prerequisite_for edges are REVERSED for display so the
 * arrow points prereq → dependent (the unlocking direction), giving dagre a clean top-down order. */
export function lwgToGraphView(
  lwg: LearningWorkflowGraph,
  statuses: Record<string, ConceptStatus>,
  opts: LwgViewOptions = {},
): GraphView {
  const theta = opts.theta ?? DEFAULT_THETA;
  const minAtt = opts.minAttempts ?? 3;
  const masteredP = opts.masteredPosterior ?? DEFAULT_THETA;

  // Apply the engine's minimum-attempts floor when building the availability map, so the graph's
  // locked/available gating matches the navigator (a concept below the floor counts as not-mastered).
  const mastery: Mastery = {};
  for (const [id, s] of Object.entries(statuses)) if (s.attempts >= minAtt) mastery[id] = s.mastery;
  const current = nextConcept(lwg, mastery, theta, []);

  const nodes: GraphNode[] = lwg.nodes.map((n) => {
    if (n.node_kind === "concept") {
      const st = statuses[n.id];
      const m = st?.mastery ?? 0;
      const att = st?.attempts ?? 0;
      let state: NodeState;
      if (m >= masteredP && att >= minAtt) state = "mastered";
      else if (n.id === current) state = "current";
      else if (isAvailable(lwg, n.id, mastery, theta)) state = att > 0 ? "in_progress" : "available";
      else state = "locked";
      return {
        id: n.id, type: "concept", label: n.title,
        group: n.bloom_level, state, value: Number(m.toFixed(3)),
        attrs: { attempts: att, bloom: n.bloom_level },
      };
    }
    return {
      id: n.id, type: "task", label: n.title,
      group: n.scene_type, state: "neutral", attrs: { scene_type: n.scene_type },
    };
  });

  const edges: GraphEdge[] = lwg.edges.map((e) =>
    e.relation === "prerequisite_for"
      ? { id: e.id, source: e.target, target: e.source, type: "prerequisite_for" } // reversed for display
      : { id: e.id, source: e.source, target: e.target, type: e.relation },
  );

  return {
    schema: "typed-graph-lens/1.0",
    domain: "studium-lwg",
    title: opts.title ?? lwg.course_id,
    nodes, edges,
    ...(current ? { focus: current } : {}),
    legend: [
      { swatch: "#238636", label: "mastered" },
      { swatch: "#f0883e", label: "current" },
      { swatch: "#1f6feb", label: "in progress" },
      { swatch: "#21262d", label: "available" },
      { swatch: "#161b22", label: "locked" },
    ],
  };
}

export { BLOOM_SWATCH };
