// Found by simulation on atomistique-l1 (6 Nov 2026), once two prerequisites of one concept each had
// an item a gate can route to. Three defects:
//  1. a correct answer on the detour for prerequisite A was credited only if the router then chose A
//     again; with a second unmet prerequisite B it chose B, A stayed unmet, and the learner was sent
//     back and forth between the two until the detour budget released the gate;
//  2. an item answered correctly on a detour, sitting later in the lesson, was served a second time
//     when the lesson reached it;
//  3. an alternate item placed further down the lesson (not the very next scene) made the session
//     resume after it, so the scenes between the question and its alternate were never served.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";
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
const prereq = (dependent: string, prerequisite: string) => ({
  id: `${dependent}-${prerequisite}`, relation: "prerequisite_for", source: `concept:${dependent}`, target: `concept:${prerequisite}`,
});
function bundle(scenes: object[], conceptIds: string[], edges: object[], rules: object[] = []): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "multi-prereq", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "en", discipline: "x" },
    concepts: conceptIds.map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
    scenes, rules, validated_by: "teacher", validated_at: "2026-11-06T00:00:00Z",
    learning_workflow_graph: {
      schema_version: "1.0", course_id: "c",
      nodes: conceptIds.map((id) => ({ id: `concept:${id}`, node_kind: "concept", title: id, bloom_level: "understand" })),
      edges,
    },
  } as unknown as LessonBundle;
}
const sceneOf = (t: Transition) => ("presentation" in t ? t.presentation.scene.id : null);

// dep needs a and b; each has an in-flow item and a later recall item.
const TWO_PREREQS = () => bundle(
  [quiz("q-a", "a"), quiz("q-b", "b"), concept("c-dep", "dep"), quiz("q-a2", "a"), quiz("q-b2", "b")],
  ["a", "b", "dep"], [prereq("dep", "a"), prereq("dep", "b")],
);

describe("a gate with two unmet prerequisites", () => {
  it("credits each prerequisite on its own correct detour answer, then opens", async () => {
    const session = new LessonSession(TWO_PREREQS(), buildTestDeps());
    await session.start();
    await session.respond({ kind: "quiz_choice", choiceId: "wrong" });                 // q-a wrong
    const toA = await session.respond({ kind: "quiz_choice", choiceId: "wrong" });     // q-b wrong → gate
    expect(toA.navigation?.kind).toBe("remediate");
    const firstDetour = sceneOf(toA)!;
    expect(["q-a2", "q-b2"]).toContain(firstDetour);
    const toB = await session.respond({ kind: "quiz_choice", choiceId: "right" });     // first detour right
    expect(toB.navigation?.kind).toBe("remediate");
    const secondDetour = sceneOf(toB)!;
    expect(secondDetour).toBe(firstDetour === "q-a2" ? "q-b2" : "q-a2");               // the OTHER prerequisite
    const open = await session.respond({ kind: "quiz_choice", choiceId: "right" });    // second detour right
    expect(open.navigation?.kind).toBe("gate_passed");
    expect(sceneOf(open)).toBe("c-dep");
  });

  it("does not serve again, further down the lesson, an item answered correctly on a detour", async () => {
    const session = new LessonSession(TWO_PREREQS(), buildTestDeps());
    await session.start();
    await session.respond({ kind: "quiz_choice", choiceId: "wrong" });
    await session.respond({ kind: "quiz_choice", choiceId: "wrong" });
    await session.respond({ kind: "quiz_choice", choiceId: "right" });
    await session.respond({ kind: "quiz_choice", choiceId: "right" });                 // now on c-dep
    const end = await session.respond({ kind: "ack" });                                // q-a2 and q-b2 already right
    expect(end.kind).toBe("complete");
  });

  it("still serves a later item that the learner got wrong on a detour", async () => {
    const session = new LessonSession(bundle(
      [quiz("q-a", "a"), concept("c-dep", "dep"), quiz("q-a2", "a")],
      ["a", "dep"], [prereq("dep", "a")],
    ), buildTestDeps());
    await session.start();
    await session.respond({ kind: "quiz_choice", choiceId: "wrong" });                 // q-a wrong → detour q-a2
    let t = await session.respond({ kind: "quiz_choice", choiceId: "wrong" });         // q-a2 wrong
    for (let i = 0; i < 12 && sceneOf(t) !== "c-dep"; i++) t = await session.respond({ kind: "quiz_choice", choiceId: "wrong" });
    expect(sceneOf(t)).toBe("c-dep");                                                  // budget spent, gate released
    const after = await session.respond({ kind: "ack" });
    expect(sceneOf(after)).toBe("q-a2");                                               // never answered right: served
  });

  it("opens at once when the record of every prerequisite is flawless", async () => {
    const session = new LessonSession(TWO_PREREQS(), buildTestDeps());
    await session.start();
    await session.respond({ kind: "quiz_choice", choiceId: "right" });                 // q-a right
    const open = await session.respond({ kind: "quiz_choice", choiceId: "right" });    // q-b right
    expect(open.navigation?.kind).toBe("gate_passed");
    expect(sceneOf(open)).toBe("c-dep");
  });
});

describe("an alternate item further down the lesson", () => {
  const replayOnFirstError = {
    id: "rule_2err_replay_concept", when: { consecutive_errors_same_concept: ">=1" },
    action: { kind: "replay_current_scene", reason: "errors_threshold" }, modulator: "M1", explanation_short: "retry",
  };
  const scenes = () => [quiz("q-a", "a"), concept("c-1", "a"), concept("c-2", "b"), quiz("q-a2", "a"), concept("c-3", "b")];

  for (const withGraph of [true, false]) {
    it(`resumes after the question it replaced, then passes over it once answered right (${withGraph ? "graph" : "no graph"})`, async () => {
      const lesson = bundle(scenes(), ["a", "b"], [], [replayOnFirstError]);
      if (!withGraph) delete (lesson as { learning_workflow_graph?: unknown }).learning_workflow_graph;
      const session = new LessonSession(lesson, buildTestDeps());
      await session.start();
      const alt = await session.respond({ kind: "quiz_choice", choiceId: "wrong" });   // q-a wrong → alternate
      expect(alt.navigation?.kind).toBe("remediate_alt");
      expect(sceneOf(alt)).toBe("q-a2");
      expect(alt.navigation?.returns_to).toBe("c-1");
      const served: (string | null)[] = [];
      let t = await session.respond({ kind: "quiz_choice", choiceId: "right" });       // q-a2 right
      while (t.kind !== "complete") { served.push(sceneOf(t)); t = await session.respond({ kind: "ack" }); }
      expect(served).toEqual(["c-1", "c-2", "c-3"]);
    });
  }
});
