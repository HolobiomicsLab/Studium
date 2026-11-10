// Audit 2026-11-10 D6: a restart during a prerequisite detour lost the detour. The learner who had
// just failed a gate resumed on the gated scene (the first scene not completed), past the gate. The
// detour in progress — the remediation served and the scene to return to — is now saved with the
// lesson state and restored on resume. A state saved without it resumes as before.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryStateStore } from "./testing.js";
import type { Transition } from "./types.js";

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

/** dep needs a: q-a, then c-dep (gated on a), then a recall item on a the gate can route to. */
function gatedBundle(): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "detour-resume", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "en", discipline: "x" },
    concepts: ["a", "dep"].map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
    scenes: [quiz("q-a", "a"), concept("c-dep", "dep"), quiz("q-a2", "a")],
    rules: [], validated_by: "teacher", validated_at: "2026-11-10T00:00:00Z",
    learning_workflow_graph: {
      schema_version: "1.0", course_id: "c",
      nodes: ["a", "dep"].map((id) => ({ id: `concept:${id}`, node_kind: "concept", title: id, bloom_level: "understand" })),
      edges: [{ id: "dep-a", relation: "prerequisite_for", source: "concept:dep", target: "concept:a" }],
    },
  } as unknown as LessonBundle;
}
const sceneOf = (t: Transition) => ("presentation" in t ? t.presentation.scene.id : null);

describe("a restart during a prerequisite detour (audit D6)", () => {
  it("saves the detour with the lesson state and resumes on the remediation, then returns to the gate", async () => {
    const store = new InMemoryStateStore();
    const first = new LessonSession(gatedBundle(), buildTestDeps({ stateStore: store }));
    await first.start();
    const detour = await first.respond({ kind: "quiz_choice", choiceId: "wrong" });
    expect(detour.navigation?.kind).toBe("remediate");
    expect(sceneOf(detour)).toBe("q-a2");
    expect(detour.navigation?.returns_to).toBe("c-dep");
    const saved = await store.load("detour-resume");
    expect(saved?.pending_detour).toEqual({ scene_id: "q-a2", returns_to: "c-dep", prerequisite: "concept:a" });

    // The process restarts: a new session on the saved state.
    const resumed = new LessonSession(gatedBundle(), buildTestDeps({ stateStore: store }), saved!);
    expect((await resumed.start()).scene.id).toBe("q-a2");
    const back = await resumed.respond({ kind: "quiz_choice", choiceId: "right" });
    expect(back.navigation?.kind).toBe("gate_passed");
    expect(sceneOf(back)).toBe("c-dep");
    // The detour is over: the saved state no longer carries it.
    expect((await store.load("detour-resume"))?.pending_detour).toBeUndefined();
  });

  it("a state saved without the field resumes as before, on the first scene not completed", async () => {
    const store = new InMemoryStateStore();
    const first = new LessonSession(gatedBundle(), buildTestDeps({ stateStore: store }));
    await first.start();
    await first.respond({ kind: "quiz_choice", choiceId: "wrong" });
    const { pending_detour: _dropped, ...older } = (await store.load("detour-resume"))!;
    const resumed = new LessonSession(gatedBundle(), buildTestDeps({ stateStore: store }), older);
    expect((await resumed.start()).scene.id).toBe("c-dep");
  });

  it("a saved detour naming a scene the lesson no longer has is ignored", async () => {
    const store = new InMemoryStateStore();
    const first = new LessonSession(gatedBundle(), buildTestDeps({ stateStore: store }));
    await first.start();
    await first.respond({ kind: "quiz_choice", choiceId: "wrong" });
    const saved = (await store.load("detour-resume"))!;
    const stale = { ...saved, pending_detour: { scene_id: "gone", returns_to: "c-dep" } };
    const resumed = new LessonSession(gatedBundle(), buildTestDeps({ stateStore: store }), stale);
    expect((await resumed.start()).scene.id).toBe("c-dep");
  });
});
