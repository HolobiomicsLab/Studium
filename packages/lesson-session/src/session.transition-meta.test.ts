// The transition carries (a) the verdict on the answer just given — the only place the quiz
// feedback reaches the learner now that the public scene withholds it — and (b) ONE navigation
// record, so a harness never has to reconcile transition.kind, lastDecision and
// explain_last_adaptation. Both were missing on the 2026-10-29 web-cases trial: two independent
// harnesses read a graph detour as a plain `next` and found the answer key in the scene.
import { describe, it, expect } from "vitest";
import { LessonSession } from "./session";
import { buildTestDeps } from "./testing";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

function quiz(id: string, conceptRef: string) {
  return { id, type: "quiz", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: `right on ${id}`, feedback_incorrect: `wrong on ${id}`, hints: ["h"] };
}
function intro(id: string, conceptRef: string) {
  return { id, type: "intro", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [], markdown: "intro text" };
}
const LWG = {
  schema_version: "1.0", course_id: "c",
  nodes: [
    { id: "concept:base", node_kind: "concept", title: "Base", bloom_level: "understand" },
    { id: "concept:suite", node_kind: "concept", title: "Suite", bloom_level: "apply" },
  ],
  // engine convention: source = dependent concept, target = its prerequisite
  edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:suite", target: "concept:base" }],
};
function bundle(): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [
      { id: "base", title: "Base", description: "d", bloom_level_target: "understand" },
      { id: "suite", title: "Suite", description: "d", bloom_level_target: "apply" },
    ],
    scenes: [intro("i-base", "base"), quiz("q-base", "base"), intro("i-suite", "suite"), quiz("q-suite", "suite")],
    rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
    learning_workflow_graph: LWG,
  } as unknown as LessonBundle;
}

describe("transition meta — verdict and navigation", () => {
  it("an ack on an intro is ungraded and navigates with kind advance", async () => {
    const s = new LessonSession(bundle(), buildTestDeps());
    await s.start();
    const t = await s.respond({ kind: "ack" });
    expect(t.kind).toBe("next");
    expect(t.verdict).toEqual({ scene_id: "i-base", graded: false, signal: "scene_completed" });
    expect(t.navigation).toMatchObject({ kind: "advance", scene_id: "q-base", rule_id: null });
  });

  it("a wrong quiz answer earns ONLY the incorrect feedback; the scene never carried either", async () => {
    const s = new LessonSession(bundle(), buildTestDeps());
    const pres = await s.start();
    await s.respond({ kind: "ack" });
    const t = await s.respond({ kind: "quiz_choice", choiceId: "a" });
    expect(t.verdict).toMatchObject({ scene_id: "q-base", graded: true, correct: false, feedback: "wrong on q-base" });
    expect(t.verdict?.feedback).not.toContain("right");
    expect(pres.scene.id).toBe("i-base");
  });

  it("a correct answer on the prerequisite's only graded scene PASSES the gate instead of re-serving it", async () => {
    const s = new LessonSession(bundle(), buildTestDeps());
    await s.start();
    await s.respond({ kind: "ack" });
    const t = await s.respond({ kind: "quiz_choice", choiceId: "b" }); // right, but mastery 0.5 -> ~0.54 < theta
    expect(t.verdict).toMatchObject({ correct: true, feedback: "right on q-base" });
    expect(t.kind).toBe("next");
    expect(t.navigation).toMatchObject({ kind: "gate_passed", rule_id: "graph_prereq_gate_passed", scene_id: "i-suite" });
    expect(s.explainLast()?.rule_id).toBe("graph_prereq_gate_passed");
  });

  it("a graph detour from a locked scene is a `remediate` transition that names where it returns to", async () => {
    const s = new LessonSession(bundle(), buildTestDeps());
    await s.start();
    await s.respond({ kind: "ack" });                           // i-base -> q-base
    await s.respond({ kind: "quiz_choice", choiceId: "a" });    // wrong: base unmastered; next (i-suite) is concept-less? no: locked
    // From q-base (wrong) the router wants i-suite, whose concept `suite` needs `base`: it is locked,
    // so the learner is sent back to the graded scene of `base` — q-base itself.
    const state = s.currentPresentation();
    expect(state.scene.id).toBe("q-base");
    const t = await s.respond({ kind: "quiz_choice", choiceId: "a" }); // wrong again, still detouring
    expect(t.kind).toBe("remediate");
    expect(t.navigation).toMatchObject({ kind: "remediate", rule_id: "graph_prereq_gate", modulator: "M6", returns_to: "i-suite", scene_id: "q-base" });
    expect(t.verdict).toMatchObject({ correct: false });
    expect(t.kind === "remediate" ? t.presentation.explanation?.rule_id : null).toBe("graph_prereq_gate");
  });
});
