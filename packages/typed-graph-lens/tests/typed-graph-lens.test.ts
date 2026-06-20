import { describe, it, expect } from "vitest";
import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";
import { lwgToGraphView, type ConceptStatus } from "../src/adapters/studium";
import { toCytoscape } from "../src/cytoscape";
import { egoFilter } from "../src/ego";
import { diffStates } from "../src/schema";
import { buildStylesheet } from "../src/style";

// A→B→C chain (prerequisite_for: source=dependent, target=prereq), plus a task assessing B.
const LWG: LearningWorkflowGraph = {
  schema_version: "1.0",
  course_id: "test-course",
  nodes: [
    { id: "A", node_kind: "concept", title: "Concept A", bloom_level: "understand" },
    { id: "B", node_kind: "concept", title: "Concept B", bloom_level: "apply" },
    { id: "C", node_kind: "concept", title: "Concept C", bloom_level: "analyze" },
    { id: "tB", node_kind: "task", title: "Quiz B", scene_type: "quiz" },
  ],
  edges: [
    { id: "e1", relation: "prerequisite_for", source: "B", target: "A" },
    { id: "e2", relation: "prerequisite_for", source: "C", target: "B" },
    { id: "e3", relation: "assesses", source: "tB", target: "B" },
  ],
};

const statuses = (): Record<string, ConceptStatus> => ({
  A: { mastery: 0.9, attempts: 3 },
  B: { mastery: 0.4, attempts: 1 },
  C: { mastery: 0.0, attempts: 0 },
});

describe("studium adapter → GraphView", () => {
  it("derives mastered / current / locked node states from live mastery", () => {
    const v = lwgToGraphView(LWG, statuses());
    const byId = Object.fromEntries(v.nodes.map((n) => [n.id, n]));
    expect(byId.A!.state).toBe("mastered");
    expect(byId.B!.state).toBe("current"); // available (A mastered) + the next frontier
    expect(byId.C!.state).toBe("locked"); // prereq B not yet mastered
    expect(byId.tB!.type).toBe("task");
    expect(v.focus).toBe("B");
  });

  it("reverses prerequisite_for edges for display (prereq → dependent)", () => {
    const v = lwgToGraphView(LWG, statuses());
    const e1 = v.edges.find((e) => e.id === "e1")!;
    expect([e1.source, e1.target]).toEqual(["A", "B"]); // unlocking direction
    const assess = v.edges.find((e) => e.id === "e3")!;
    expect([assess.source, assess.target]).toEqual(["tB", "B"]); // assesses kept as-is
  });
});

describe("ego filter (student view)", () => {
  it("keeps reachable nodes + the immediate locked frontier + assessing tasks", () => {
    const ego = egoFilter(lwgToGraphView(LWG, statuses()));
    const ids = new Set(ego.nodes.map((n) => n.id));
    expect(ids.has("A")).toBe(true); // mastered
    expect(ids.has("B")).toBe(true); // current
    expect(ids.has("C")).toBe(true); // immediate locked gate (one hop from B)
    expect(ids.has("tB")).toBe(true); // assesses B
    expect(ego.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });

  it("drops a far locked node that is more than one hop from the frontier", () => {
    const deep: LearningWorkflowGraph = {
      ...LWG,
      nodes: [...LWG.nodes, { id: "D", node_kind: "concept", title: "Concept D", bloom_level: "create" }],
      edges: [...LWG.edges, { id: "e4", relation: "prerequisite_for", source: "D", target: "C" }],
    };
    const ego = egoFilter(lwgToGraphView(deep, statuses()));
    expect(ego.nodes.find((n) => n.id === "D")).toBeUndefined(); // two hops past the frontier
  });
});

describe("cytoscape transform + stylesheet", () => {
  it("emits classes per type/state/focus and drops dangling edges", () => {
    const v = lwgToGraphView(LWG, statuses());
    const cy = toCytoscape(v);
    const a = cy.nodes.find((n) => n.data.id === "A")!;
    expect(a.classes).toContain("type-concept");
    expect(a.classes).toContain("state-mastered");
    const b = cy.nodes.find((n) => n.data.id === "B")!;
    expect(b.classes).toContain("focus");
    expect(cy.edges).toHaveLength(3);
  });

  it("builds a non-empty Cytoscape stylesheet with state selectors", () => {
    const sheet = buildStylesheet() as Array<{ selector: string }>;
    expect(sheet.some((s) => s.selector === "node.state-mastered")).toBe(true);
    expect(sheet.some((s) => s.selector === "node.state-current")).toBe(true);
  });
});

describe("state-delta channel", () => {
  it("diffs two overlays into the nodes that changed", () => {
    const before = lwgToGraphView(LWG, statuses());
    const after = lwgToGraphView(LWG, { ...statuses(), B: { mastery: 0.9, attempts: 4 } });
    const deltas = diffStates(before, after);
    const bDelta = deltas.find((d) => d.nodeId === "B")!;
    expect(bDelta.prevState).toBe("current");
    expect(bDelta.newState).toBe("mastered");
    // C unlocks once B is mastered → also a delta
    expect(deltas.find((d) => d.nodeId === "C")?.newState).toBe("current");
  });
});
