// packages/typed-graph-lens/src/ego.ts
//
// Student vs teacher views are the SAME GraphView, filtered. Teacher = the whole graph.
// Student = the ego-graph around the current frontier: what's mastered / in progress / available /
// current, plus the locked nodes that are one prerequisite-hop away (so the learner sees what's next
// and why it's gated) — but not the whole far future.
import type { GraphView, GraphNode, GraphEdge } from "./schema.js";

const REACHABLE = new Set(["mastered", "in_progress", "available", "current"]);

export function egoFilter(view: GraphView): GraphView {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  // `base` is the FROZEN reachable set; frontier expansion reads it (not the growing `keep`) so a
  // node added as the frontier can't itself seed a second hop.
  const base = new Set<string>();
  for (const n of view.nodes) if (REACHABLE.has(n.state ?? "neutral")) base.add(n.id);
  const keep = new Set(base);

  // include the immediate locked frontier: a locked node exactly one prerequisite_for hop
  // downstream of a reachable node, so the learner sees the next gate (and not the whole tail).
  for (const e of view.edges) {
    if (e.type !== "prerequisite_for") continue;
    if (base.has(e.source) && !base.has(e.target)) {
      const t = byId.get(e.target);
      if (t && (t.state ?? "neutral") === "locked") keep.add(t.id);
    }
  }
  // pull in task nodes that assess a reachable concept
  for (const e of view.edges) {
    if (e.type === "assesses" && base.has(e.target)) keep.add(e.source);
  }

  const nodes: GraphNode[] = view.nodes.filter((n) => keep.has(n.id));
  const edges: GraphEdge[] = view.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { ...view, nodes, edges };
}
