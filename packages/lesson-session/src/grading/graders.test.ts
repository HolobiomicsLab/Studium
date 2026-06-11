// packages/lesson-session/src/grading/graders.test.ts
import { describe, it, expect } from "vitest";
import type { Scene } from "@studium/lesson-bundle-schema";
import { grade } from "./index.js";
import { StubCritiqueEvaluator } from "../adapters/critique-evaluator.js"; // used in Task 5 tests

const deps = { critiqueEvaluator: new StubCritiqueEvaluator() };

const quiz: Extract<Scene, { type: "quiz" }> = {
  id: "q1", type: "quiz", title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 30, adaptation_hooks: [],
  question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
  feedback_correct: "ok", feedback_incorrect: "no", hints: [],
};

describe("grade() — simple graders", () => {
  it("intro → scene_completed", async () => {
    const intro = { id: "i", type: "intro", title: "t", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "# hi" } as Extract<Scene, { type: "intro" }>;
    const r = await grade(intro, { kind: "ack" }, deps);
    expect(r.signal).toEqual({ kind: "scene_completed", scene_id: "i", duration_ms: 0 });
    expect(r.telemetry).toEqual([]);
  });
  it("quiz correct → answer_submitted{correct:true} + quiz_answered telemetry", async () => {
    const r = await grade(quiz, { kind: "quiz_choice", choiceId: "b" }, deps);
    expect(r.signal).toMatchObject({ kind: "answer_submitted", concept_id: "c1", scene_id: "q1", correct: true, difficulty: 0.5 });
    expect(r.telemetry[0]).toMatchObject({ type: "quiz_answered", scene_id: "q1", item_id: "b", correct: true });
  });
  it("quiz wrong choice → correct:false", async () => {
    const r = await grade(quiz, { kind: "quiz_choice", choiceId: "a" }, deps);
    expect(r.signal).toMatchObject({ correct: false });
  });
  it("meta_checkpoint → confidence_declared", async () => {
    const meta = { id: "m", type: "meta_checkpoint", title: "t", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], pre_question: "p", post_question: "q", scale_labels: ["1","2","3","4","5"] } as Extract<Scene, { type: "meta_checkpoint" }>;
    const r = await grade(meta, { kind: "confidence", value: 3 }, deps);
    expect(r.signal).toEqual({ kind: "confidence_declared", scene_id: "m", value: 3, concept_id: "c1" });
  });
  it("wrong input kind → SceneGradingError", async () => {
    await expect(grade(quiz, { kind: "ack" }, deps)).rejects.toThrow(/quiz/);
  });
});

const quizWithHints: Extract<Scene, { type: "quiz" }> = {
  id: "q1", type: "quiz", title: "Q", objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0,
  adaptation_hooks: [], question: "?", choices: [{ id: "a", text: "A", correct: true }], feedback_correct: "ok",
  feedback_incorrect: "no", hints: ["h1"],
};
const stubDeps = { critiqueEvaluator: new StubCritiqueEvaluator() };

describe("quizGrader — hintCount in GradeDeps", () => {
  it("quizGrader forwards GradeDeps.hintCount into the signal", async () => {
    const { signal } = await grade(quizWithHints, { kind: "quiz_choice", choiceId: "a" }, { ...stubDeps, hintCount: 2 });
    expect(signal.kind).toBe("answer_submitted");
    expect((signal as any).hint_count).toBe(2);
  });
  it("quizGrader defaults hint_count to 0 when not provided", async () => {
    const { signal } = await grade(quizWithHints, { kind: "quiz_choice", choiceId: "a" }, stubDeps);
    expect((signal as any).hint_count).toBe(0);
  });
});
