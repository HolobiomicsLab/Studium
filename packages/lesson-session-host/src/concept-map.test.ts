import { describe, expect, it } from "vitest";
import { buildConceptMap, type ConceptMapInput } from "./concept-map.js";

// a -> b -> d, a -> c -> d (d needs b and c). One question per concept, plus a closing one on a and d.
const concepts = [
  { id: "a", title: "Alpha" }, { id: "b", title: "Beta" }, { id: "c", title: "Gamma \"g\"" }, { id: "d", title: "Delta" },
];
const scenes = [
  { id: "intro", type: "intro", concept_refs: [] },
  { id: "c-a", type: "concept", concept_refs: ["a"] }, { id: "q-a", type: "quiz", concept_refs: ["a"] },
  { id: "c-b", type: "concept", concept_refs: ["b"] }, { id: "q-b", type: "quiz", concept_refs: ["b"] },
  { id: "c-c", type: "concept", concept_refs: ["c"] }, { id: "q-c", type: "quiz", concept_refs: ["c"] },
  { id: "c-d", type: "concept", concept_refs: ["d"] }, { id: "q-ad", type: "quiz", concept_refs: ["d", "a"] },
];
const edge = (dependent: string, prerequisite: string) =>
  ({ id: `${dependent}-${prerequisite}`, relation: "prerequisite_for", source: `concept:${dependent}`, target: `concept:${prerequisite}` });
const lwg = {
  schema_version: "1.0", course_id: "c",
  nodes: concepts.map((c) => ({ id: `concept:${c.id}`, node_kind: "concept", title: c.title })),
  edges: [edge("b", "a"), edge("c", "a"), edge("d", "b"), edge("d", "c")],
} as unknown as NonNullable<ConceptMapInput["lwg"]>;

const ack = (step: number, scene_id: string) => ({ step, scene_id, answered: false, correct: null });
const answer = (step: number, scene_id: string, correct: boolean | null) => ({ step, scene_id, answered: true, correct });
function mapAt(steps: ConceptMapInput["path"]["steps"], currentSceneId: string | null, extra: Partial<ConceptMapInput> = {}) {
  return buildConceptMap({
    concepts, scenes, lwg, path: { steps, passed_prerequisites: [] }, currentSceneId, moment: "on_request", locale: "fr", ...extra,
  });
}
const stateOf = (map: ReturnType<typeof mapAt>) => Object.fromEntries(map.nodes.map((n) => [n.id, n.state]));

describe("buildConceptMap", () => {
  it("at the start everything is upcoming except the concept being opened", () => {
    const map = mapAt([ack(1, "intro")], "c-a");
    expect(stateOf(map)).toEqual({ a: "current", b: "upcoming", c: "upcoming", d: "upcoming" });
    expect(map.position).toEqual({ from: null, at: "a", next: "b" });
    expect(map.edges.every((e) => !e.travelled)).toBe(true);
  });

  it("draws each state from the answers of the session, with the questions and their step", () => {
    const steps = [
      ack(1, "intro"), ack(2, "c-a"), answer(3, "q-a", true),
      ack(4, "c-b"), answer(5, "q-b", false),
      ack(6, "c-c"), answer(7, "q-c", null),
    ];
    const map = mapAt(steps, "c-d");
    expect(stateOf(map)).toEqual({ a: "acquired", b: "to_review", c: "seen", d: "current" });
    expect(map.nodes.find((n) => n.id === "a")!.questions).toEqual([{ step: 3, scene_id: "q-a", result: "correct" }]);
    expect(map.nodes.find((n) => n.id === "b")!.questions).toEqual([{ step: 5, scene_id: "q-b", result: "wrong" }]);
    expect(map.nodes.find((n) => n.id === "c")!.questions).toEqual([{ step: 7, scene_id: "q-c", result: "recorded" }]);
    expect(map.step).toBe(8);
    expect(map.position).toEqual({ from: "c", at: "d", next: null });
    expect(map.edges).toContainEqual({ from: "a", to: "b", travelled: true });
    expect(map.edges).toContainEqual({ from: "b", to: "d", travelled: true });
  });

  it("the latest graded answer decides, and a credited prerequisite is acquired", () => {
    const recovered = mapAt([answer(1, "q-b", false), answer(2, "q-b", true)], "c-c");
    expect(stateOf(recovered).b).toBe("acquired");
    const lapsed = mapAt([answer(1, "q-b", true), answer(2, "q-b", false)], "c-c");
    expect(stateOf(lapsed).b).toBe("to_review");
    const credited = mapAt([answer(1, "q-b", false)], "c-c", { path: { steps: [answer(1, "q-b", false)], passed_prerequisites: ["b"] } });
    expect(stateOf(credited).b).toBe("acquired");
  });

  it("a question on two concepts counts for both, and an upcoming concept names what it still needs", () => {
    const steps = [answer(1, "q-a", true), answer(2, "q-b", false), answer(3, "q-c", true)];
    const before = mapAt(steps, "q-c");
    expect(before.nodes.find((n) => n.id === "d")).toMatchObject({ state: "upcoming", requires: ["b"] });
    const after = mapAt([...steps, ack(4, "c-d"), answer(5, "q-ad", false)], null, { moment: "complete" });
    expect(stateOf(after)).toEqual({ a: "to_review", b: "to_review", c: "acquired", d: "to_review" });
    expect(after.position.at).toBeNull();
  });

  it("writes a text list and a Mermaid graph in the lesson's language, state in words", () => {
    const steps = [ack(1, "c-a"), answer(2, "q-a", true), ack(3, "c-b"), answer(4, "q-b", false)];
    const fr = mapAt(steps, "c-c", { moment: "detour" });
    expect(fr.display_markdown).toContain("**Carte des notions**");
    expect(fr.display_markdown).toContain("- Alpha (`a`) : acquise (Q2 juste)");
    expect(fr.display_markdown).toContain("- Beta (`b`) : à revoir (Q4 faux)");
    expect(fr.display_markdown).toContain("- **Gamma \"g\" (`c`) : en cours**");
    expect(fr.display_markdown).toContain("- Delta (`d`) : à venir (demande Beta)");
    expect(fr.position_line).toBe("Tu viens de « Beta », tu es sur « Gamma \"g\" », ensuite « Delta ».");
    expect(fr.mermaid).toContain("flowchart TD");
    expect(fr.mermaid).toContain('n_a["Alpha<br/>acquise · Q2 juste"]:::acquired');
    expect(fr.mermaid).toContain('n_c["Gamma #quot;g#quot;<br/>en cours"]:::current');
    expect(fr.mermaid).toContain("n_a --> n_b");
    expect(fr.mermaid).toContain("n_b -.-> n_d");
    const en = mapAt(steps, "c-c", { locale: "en" });
    expect(en.display_markdown).toContain("- Alpha (`a`): acquired (Q2 correct)");
    expect(en.position_line).toBe("You come from “Beta”, you are on “Gamma \"g\"”, next “Delta”.");
  });

  it("recommends the whole map at structural moments and one line at a new concept", () => {
    expect(mapAt([], "c-a", { moment: "start" }).show).toBe("map");
    expect(mapAt([], "c-a", { moment: "new_concept" }).show).toBe("line");
    expect(mapAt([], "c-a", { moment: "detour" }).show).toBe("map");
  });

  it("on a screen that names no concept, says what comes next and never that the lesson is finished", () => {
    // The introduction names no concept: the lesson has not ended, it has not begun.
    const start = mapAt([], "intro", { moment: "start" });
    expect(start.position).toEqual({ from: null, at: null, next: "a" });
    expect(start.position_line).toBe("La leçon commence par « Alpha ».");
    expect(start.display_markdown).not.toContain("terminée");
    expect(mapAt([], "intro", { moment: "start", locale: "en" }).position_line).toBe("The lesson starts with “Alpha”.");
    // The same kind of screen later in the lesson: where the learner comes from, and what is next.
    const later = mapAt([ack(1, "intro"), ack(2, "c-a"), answer(3, "q-a", true)], "intro");
    expect(later.position_line).toBe("Tu viens de « Alpha », ensuite « Beta ».");
    // Only a finished lesson says so.
    const done = mapAt([ack(1, "intro"), ack(2, "c-a"), answer(3, "q-a", true)], null, { moment: "complete" });
    expect(done.position).toMatchObject({ at: null, next: null });
    expect(done.position_line).toBe("Tu viens de « Alpha », la leçon est terminée.");
  });

  it("works without a graph: the concepts in lesson order, no edge", () => {
    const map = buildConceptMap({ concepts, scenes, path: { steps: [], passed_prerequisites: [] }, currentSceneId: "c-a", moment: "start", locale: "fr" });
    expect(map.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
    expect(map.edges).toEqual([]);
  });
});
