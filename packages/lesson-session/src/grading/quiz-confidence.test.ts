// I-5: `quiz_answered.confidence` is optional. The grader sends the learner's own rating (0..4 → 0..1)
// when there is one and OMITS the key when there is not, so calibration consumers skip the answer
// instead of reading a made-up 0.5 as a measurement.
import { describe, it, expect } from "vitest";
import type { Scene } from "@studium/lesson-bundle-schema";
import { grade } from "./index.js";
import { StubCritiqueEvaluator } from "../adapters/critique-evaluator.js";

const deps = { critiqueEvaluator: new StubCritiqueEvaluator() };
const quiz: Extract<Scene, { type: "quiz" }> = {
  id: "q1", type: "quiz", title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 30, adaptation_hooks: [],
  question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
  feedback_correct: "ok", feedback_incorrect: "no", hints: [],
};

describe("quiz_answered confidence (I-5)", () => {
  it("carries the learner's rating as a 0..1 value", async () => {
    const r = await grade(quiz, { kind: "quiz_choice", choiceId: "b", confidence: 3 }, deps);
    expect(r.telemetry[0]).toMatchObject({ type: "quiz_answered", confidence: 0.75 });
  });
  it("carries a rating of 0 (the lowest confidence is a measurement, not an absence)", async () => {
    const r = await grade(quiz, { kind: "quiz_choice", choiceId: "a", confidence: 0 }, deps);
    expect(r.telemetry[0]).toMatchObject({ type: "quiz_answered", confidence: 0 });
  });
  it("omits the key when the learner did not rate", async () => {
    const r = await grade(quiz, { kind: "quiz_choice", choiceId: "b" }, deps);
    expect(r.telemetry[0]).toMatchObject({ type: "quiz_answered" });
    expect(r.telemetry[0]).not.toHaveProperty("confidence");
  });
});
