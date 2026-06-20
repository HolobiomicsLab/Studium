// packages/typed-graph-lens/src/cytoscape.ts
//
// Pure transform: GraphView → Cytoscape elements (+ classes). The webview host (any project) feeds
// these straight to cytoscape({ elements, style }). No Cytoscape dependency here — just plain JSON.
import type { GraphView } from "./schema.js";
import { cssSafe } from "./style.js";

export interface CyElement {
  data: Record<string, unknown>;
  classes?: string;
}
export interface CyElements {
  nodes: CyElement[];
  edges: CyElement[];
}

export function toCytoscape(view: GraphView): CyElements {
  const ids = new Set(view.nodes.map((n) => n.id));
  const nodes: CyElement[] = view.nodes.map((n) => {
    const classes = [
      `type-${cssSafe(n.type)}`,
      n.state ? `state-${cssSafe(n.state)}` : "state-neutral",
      n.group ? `group-${cssSafe(n.group)}` : "",
      n.id === view.focus ? "focus" : "",
    ].filter(Boolean).join(" ");
    return {
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        group: n.group ?? null,
        state: n.state ?? "neutral",
        value: n.value ?? null,
        ...(n.attrs ?? {}),
      },
      classes,
    };
  });
  // Drop dangling edges (endpoints not in the node set) so Cytoscape never throws on a missing target.
  const edges: CyElement[] = view.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      data: { id: e.id, source: e.source, target: e.target, type: e.type, ...(e.attrs ?? {}) },
      classes: `type-${cssSafe(e.type)}`,
    }));
  return { nodes, edges };
}
