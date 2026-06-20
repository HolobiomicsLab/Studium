// packages/typed-graph-lens/src/style.ts
//
// The type→style registry. Cytoscape renders to a <canvas>, so styles use CONCRETE colors (CSS
// variables don't resolve on canvas). The palette is chosen to read on both light and dark editor
// themes (mid/dark fills + light labels). A project can override per-state / per-type colors.

export interface StyleRegistry {
  /** node fill + border per live state */
  state: Record<string, { bg: string; border: string; label: string; borderWidth?: number }>;
  /** node shape per domain type */
  typeShape: Record<string, string>;
  edge: { line: string; arrow: string };
  edgeType?: Record<string, { line: string; style?: string }>;
}

export const DEFAULT_REGISTRY: StyleRegistry = {
  state: {
    mastered: { bg: "#238636", border: "#3fb950", label: "#f0fff4" },
    current: { bg: "#9e6a03", border: "#f0883e", label: "#fff8f0", borderWidth: 4 },
    in_progress: { bg: "#1f6feb", border: "#58a6ff", label: "#f0f6ff" },
    available: { bg: "#21262d", border: "#58a6ff", label: "#c9d1d9" },
    locked: { bg: "#161b22", border: "#30363d", label: "#6e7681" },
    neutral: { bg: "#30363d", border: "#484f58", label: "#c9d1d9" },
  },
  typeShape: {
    concept: "round-rectangle",
    task: "round-tag",
  },
  edge: { line: "#484f58", arrow: "#484f58" },
  edgeType: {
    assesses: { line: "#6e7681", style: "dashed" },
    prerequisite_for: { line: "#484f58" },
  },
};

/** Build a Cytoscape stylesheet (array of {selector, style}) from a registry. Reusable across domains. */
export function buildStylesheet(reg: StyleRegistry = DEFAULT_REGISTRY): unknown[] {
  const neutral = reg.state["neutral"] ?? { bg: "#30363d", border: "#484f58", label: "#c9d1d9" };
  const sheet: unknown[] = [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": "10px",
        "font-family": "sans-serif",
        "text-wrap": "wrap",
        "text-max-width": "130px",
        "text-valign": "center",
        "text-halign": "center",
        color: neutral.label,
        "background-color": neutral.bg,
        "border-color": neutral.border,
        "border-width": 1,
        shape: "round-rectangle",
        width: "label",
        height: "label",
        padding: "8px",
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.5,
        "line-color": reg.edge.line,
        "target-arrow-color": reg.edge.arrow,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        "curve-style": "bezier",
      },
    },
    { selector: "node.focus", style: { "border-color": "#f0883e", "border-width": 4 } },
    { selector: ":selected", style: { "border-color": "#f0883e", "border-width": 4 } },
  ];
  for (const [type, shape] of Object.entries(reg.typeShape)) {
    sheet.push({ selector: `node.type-${cssSafe(type)}`, style: { shape } });
  }
  for (const [state, c] of Object.entries(reg.state)) {
    sheet.push({
      selector: `node.state-${cssSafe(state)}`,
      style: {
        "background-color": c.bg,
        "border-color": c.border,
        color: c.label,
        ...(c.borderWidth ? { "border-width": c.borderWidth } : {}),
      },
    });
  }
  for (const [type, c] of Object.entries(reg.edgeType ?? {})) {
    sheet.push({
      selector: `edge.type-${cssSafe(type)}`,
      style: { "line-color": c.line, "target-arrow-color": c.line, ...(c.style ? { "line-style": c.style } : {}) },
    });
  }
  return sheet;
}

/** Make an arbitrary domain token safe for a CSS class fragment (Cytoscape selectors). */
export function cssSafe(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}
