// learnerPath(): the session facts a learner-facing concept map is drawn from.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";

const quiz = (id: string, concept: string) => ({
  id, type: "quiz", title: id, objective_refs: [concept], concept_refs: [concept], estimated_seconds: 0, adaptation_hooks: [],
  question: "?", choices: [{ id: "wrong", text: "W", correct: false }, { id: "right", text: "R", correct: true }],
  feedback_correct: "correct", feedback_incorrect: "incorrect", hints: [],
});
const concept = (id: string, ref: string) =>
  ({ id, type: "concept", title: id, objective_refs: [ref], concept_refs: [ref], estimated_seconds: 0, adaptation_hooks: [], markdown: "concept" });
const lesson = () => ({
  schema_version: "1.4", bundle_id: "learner-path", source_plan_id: "p",
  metadata: { title: "T", target: "L1", duration_minutes: 10, language: "en", discipline: "x" },
  concepts: ["a", "dep"].map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
  scenes: [concept("c-a", "a"), quiz("q-a", "a"), concept("c-dep", "dep"), quiz("q-a2", "a")],
  rules: [], validated_by: "teacher", validated_at: "2026-11-06T00:00:00Z",
  learning_workflow_graph: {
    schema_version: "1.0", course_id: "c",
    nodes: ["a", "dep"].map((id) => ({ id: `concept:${id}`, node_kind: "concept", title: id, bloom_level: "understand" })),
    edges: [{ id: "dep-a", relation: "prerequisite_for", source: "concept:dep", target: "concept:a" }],
  },
}) as unknown as LessonBundle;

describe("learnerPath", () => {
  it("records each step in the order served, with its outcome, and the prerequisites credited", async () => {
    const session = new LessonSession(lesson(), buildTestDeps());
    await session.start();
    expect(session.learnerPath()).toEqual({ steps: [], passed_prerequisites: [] });
    await session.respond({ kind: "ack" });                                  // c-a
    await session.respond({ kind: "quiz_choice", choiceId: "wrong" });       // q-a wrong → detour q-a2
    await session.respond({ kind: "quiz_choice", choiceId: "right" });       // q-a2 right → gate passed
    expect(session.learnerPath()).toEqual({
      steps: [
        { step: 1, scene_id: "c-a", answered: false, correct: null },
        { step: 2, scene_id: "q-a", answered: true, correct: false },
        { step: 3, scene_id: "q-a2", answered: true, correct: true },
      ],
      passed_prerequisites: ["a"],
    });
  });

  it("is rebuilt from the saved history when a lesson is resumed part-way", async () => {
    const first = new LessonSession(lesson(), buildTestDeps());
    await first.start();
    await first.respond({ kind: "ack" });
    await first.respond({ kind: "quiz_choice", choiceId: "right" });
    const resumed = new LessonSession(lesson(), buildTestDeps(), first.getState());
    await resumed.start();
    expect(resumed.learnerPath().steps).toEqual([
      { step: 1, scene_id: "c-a", answered: false, correct: null },
      { step: 2, scene_id: "q-a", answered: true, correct: true },
    ]);
  });
});
