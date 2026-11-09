// answerFacts(): what each answered step adds for a map that shows its evidence (INT-STUDIUM-058
// § 2.7): when it was answered, with how many hints, and whether the learner then rated their own
// recall. learnerPath() keeps its shape; these facts are read beside it, by step number.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";
import { StubCritiqueEvaluator } from "./adapters/critique-evaluator.js";

const base = (id: string, type: string) =>
  ({ id, type, title: id, objective_refs: ["a"], concept_refs: ["a"], estimated_seconds: 0, adaptation_hooks: [] });
const lesson = () => ({
  schema_version: "1.4", bundle_id: "answer-facts", source_plan_id: "p",
  metadata: { title: "T", target: "L1", duration_minutes: 10, language: "en", discipline: "x" },
  concepts: [{ id: "a", title: "a", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { ...base("c-a", "concept"), markdown: "concept" },
    { ...base("q-a", "quiz"), question: "?", choices: [{ id: "wrong", text: "W", correct: false }, { id: "right", text: "R", correct: true }],
      feedback_correct: "correct", feedback_incorrect: "incorrect", hints: ["first hint", "second hint"] },
    { ...base("e-a", "explain_back"), prompt: "Explain.", key_points: [{ id: "kp", text: "The point", cues: ["point"] }],
      model_explanation: "The model.", rubric: { completeness: 1, evidence_quality: 1, tone: 1 } },
    { ...base("q-b", "quiz"), question: "?", choices: [{ id: "wrong", text: "W", correct: false }, { id: "right", text: "R", correct: true }],
      feedback_correct: "correct", feedback_incorrect: "incorrect", hints: [] },
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-11-06T00:00:00Z",
}) as unknown as LessonBundle;

const deps = () => buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator() });

describe("answerFacts", () => {
  it("is empty until an answer is given: a screen read is not an answer", async () => {
    const session = new LessonSession(lesson(), deps());
    await session.start();
    expect(session.answerFacts()).toEqual([]);
    await session.respond({ kind: "ack" });
    expect(session.answerFacts()).toEqual([]);
  });

  it("records when each answer was given, the hints taken before it, and a self-rating once made", async () => {
    const d = deps();
    const session = new LessonSession(lesson(), d);
    await session.start();
    await session.respond({ kind: "ack" });
    expect(session.requestHint()?.hint).toBe("first hint");
    expect(session.requestHint()).toBeNull();                       // the cap of this scaffolding level: one hint
    await session.respond({ kind: "quiz_choice", choiceId: "right" });
    const written = await session.respond({ kind: "explanation", text: "the point" });
    expect(written.self_rating?.requested).toBe(true);
    const today = d.clock.now().slice(0, 10);                       // the test clock moves on at each reading
    const at = expect.stringMatching(new RegExp(`^${today}T\\d\\d:\\d\\d:\\d\\d`));
    expect(session.answerFacts()).toEqual([
      { step: 2, scene_id: "q-a", at, hints: 1, self_rated: false },
      { step: 3, scene_id: "e-a", at, hints: 0, self_rated: false },
    ]);
    await session.rateRecall("e-a", "good");
    expect(session.answerFacts().map((fact) => fact.self_rated)).toEqual([false, true]);
    // The path itself is unchanged: same steps, same fields.
    expect(session.learnerPath().steps.map((step) => Object.keys(step).sort())).toEqual([
      ["answered", "correct", "navigation", "scene_id", "step"],
      ["answered", "assessed_by", "correct", "navigation", "scene_id", "step"],
      ["answered", "assessed_by", "correct", "navigation", "scene_id", "step"],
    ]);
  });

  it("is rebuilt from the saved history when a lesson is resumed part-way, without the self-ratings", async () => {
    const first = new LessonSession(lesson(), deps());
    await first.start();
    await first.respond({ kind: "ack" });
    first.requestHint();
    await first.respond({ kind: "quiz_choice", choiceId: "right" });
    const before = first.answerFacts();
    const resumed = new LessonSession(lesson(), deps(), first.getState());
    await resumed.start();
    // The history is stamped by the engine a moment after the session read the clock: same day.
    const day = before[0]!.at.slice(0, 10);
    expect(before).toEqual([{ step: 2, scene_id: "q-a", at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), hints: 1, self_rated: false }]);
    expect(resumed.answerFacts()).toEqual([{ step: 2, scene_id: "q-a", at: expect.stringMatching(new RegExp(`^${day}T`)), hints: 1, self_rated: false }]);
  });
});
