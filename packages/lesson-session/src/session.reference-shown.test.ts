// Audit 2026-11-10 A2 (proposal C2): the register of shown keys. A scene whose reference the host
// released to the learner is recorded in the lesson state (`reference_shown`), saved with it, and never
// served again by the routing as a graded question: a prerequisite gate whose only item was shown is
// reported unassessable (gate_unassessable) instead of being passed from memory.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryStateStore } from "./testing.js";
import { graphAwareNextIndex } from "./graph-nav.js";

function quiz(id: string, concept: string) {
  return {
    id, type: "quiz", title: id, objective_refs: [concept], concept_refs: [concept],
    estimated_seconds: 0, adaptation_hooks: [], question: "?",
    choices: [{ id: "wrong", text: "W", correct: false }, { id: "right", text: "R", correct: true }],
    feedback_correct: "correct", feedback_incorrect: "incorrect", hints: [],
  };
}
const concept = (id: string, ref: string) =>
  ({ id, type: "concept", title: id, objective_refs: [ref], concept_refs: [ref], estimated_seconds: 0, adaptation_hooks: [], markdown: "concept" });

/** dep needs a: q-a (the only item on a), then c-dep, gated on a. */
function gatedBundle(scenes = [quiz("q-a", "a"), concept("c-dep", "dep")]): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "shown-keys", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: ["a", "dep"].map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: "teacher", validated_at: "2026-11-10T00:00:00Z",
    learning_workflow_graph: {
      schema_version: "1.0", course_id: "c",
      nodes: ["a", "dep"].map((id) => ({ id: `concept:${id}`, node_kind: "concept", title: id, bloom_level: "understand" })),
      edges: [{ id: "dep-a", relation: "prerequisite_for", source: "concept:dep", target: "concept:a" }],
    },
  } as unknown as LessonBundle;
}

describe("the register of shown keys (C2)", () => {
  it("a gate whose only item had its key shown opens as unassessable instead of asking it again", async () => {
    const bundle = gatedBundle();
    const lwg = bundle.learning_workflow_graph!;
    const scenes = bundle.scenes as unknown as { id: string; concept_refs: string[]; type: string }[];
    // Without the register the gate sends the learner back to q-a, already answered.
    expect(graphAwareNextIndex(scenes, 0, lwg, {}, 0.8, false, {}, {}, new Set(["q-a"]))).toMatchObject({ index: 0, reason: "remediate" });
    // With q-a's key shown, nothing of a can be asked now.
    expect(graphAwareNextIndex(scenes, 0, lwg, {}, 0.8, false, {}, {}, new Set(["q-a"]), new Set(), {}, new Set(), new Set(["q-a"])))
      .toMatchObject({ index: 1, reason: "gate_unassessable", prerequisite: "concept:a" });
  });

  it("prefers another item of the concept whose key was not shown, and passes over a shown one ahead", () => {
    const bundle = gatedBundle([quiz("q-a", "a"), concept("c-dep", "dep"), quiz("q-a2", "a")]);
    const lwg = bundle.learning_workflow_graph!;
    const scenes = bundle.scenes as unknown as { id: string; concept_refs: string[]; type: string }[];
    const seen = new Set(["q-a", "q-a2"]);
    expect(graphAwareNextIndex(scenes, 0, lwg, {}, 0.8, false, {}, {}, seen, new Set(), {}, new Set(), new Set(["q-a"])))
      .toMatchObject({ index: 2, reason: "remediate" });
    // q-a2 lies ahead with its key shown: the lesson does not reach it again.
    const free = { ...lwg, edges: [] };
    expect(graphAwareNextIndex(scenes, 1, free, {}, 0.8, false, {}, {}, seen, new Set(), {}, new Set(), new Set(["q-a2"])))
      .toMatchObject({ index: null });
  });

  it("is saved with the lesson state, restored by a new session, and a state without it loads as an empty register", async () => {
    const store = new InMemoryStateStore();
    const first = new LessonSession(gatedBundle(), buildTestDeps({ stateStore: store }));
    await first.start();
    expect(first.getState().reference_shown).toEqual([]);
    await first.recordReferenceShown("q-a");
    expect((await store.load("shown-keys"))?.reference_shown).toEqual(["q-a"]);
    const resumed = new LessonSession(gatedBundle(), buildTestDeps({ stateStore: store }), (await store.load("shown-keys"))!);
    await resumed.start();
    expect([...resumed.referenceShownScenes()]).toEqual(["q-a"]);
    const { reference_shown: _dropped, ...older } = (await store.load("shown-keys"))!;
    const fresh = new LessonSession(gatedBundle(), buildTestDeps({ stateStore: store }), older);
    await fresh.start();
    expect([...fresh.referenceShownScenes()]).toEqual([]);
  });

  it("the gate routed from a session: unassessable once the only item's key is registered", async () => {
    const session = new LessonSession(gatedBundle([concept("intro", "a"), quiz("q-a", "a"), concept("c-dep", "dep")]), buildTestDeps());
    await session.start();
    await session.respond({ kind: "ack" });
    await session.recordReferenceShown("q-a");         // as the host does once a verdict shows q-a's key
    const t = await session.respond({ kind: "quiz_choice", choiceId: "wrong" });
    expect(t.navigation?.kind).toBe("gate_unassessable");
    expect("presentation" in t && t.presentation.scene.id).toBe("c-dep");
  });
});
