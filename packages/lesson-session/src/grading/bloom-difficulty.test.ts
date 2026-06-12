// packages/lesson-session/src/grading/bloom-difficulty.test.ts
// M1: Bloom level must modulate the IRT difficulty `w` carried on the answer_submitted
// signal (which beta-updater.ts reads). A higher-Bloom quiz must produce a higher `w`
// than a lower-Bloom one; absent bloom must fall back to the legacy flat 0.5 / 0.7.
import { describe, it, expect } from "vitest";
import type { Scene } from "@studium/lesson-bundle-schema";
import { grade } from "./index.js";
import { StubCritiqueEvaluator } from "../adapters/critique-evaluator.js";

const baseDeps = { critiqueEvaluator: new StubCritiqueEvaluator() };

function quiz(conceptRef: string): Extract<Scene, { type: "quiz" }> {
  return {
    id: "q1", type: "quiz", title: "t", objective_refs: [], concept_refs: [conceptRef],
    estimated_seconds: 30, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints: [],
  };
}

function difficultyOf(signal: unknown): number {
  return (signal as { difficulty: number }).difficulty;
}

describe("M1 — quiz difficulty derives from concept Bloom level", () => {
  it("an analyze quiz yields a HIGHER difficulty w than a remember quiz", async () => {
    const remember = await grade(quiz("c"), { kind: "quiz_choice", choiceId: "b" }, { ...baseDeps, bloomLevel: "remember" });
    const analyze = await grade(quiz("c"), { kind: "quiz_choice", choiceId: "b" }, { ...baseDeps, bloomLevel: "analyze" });
    expect(difficultyOf(analyze.signal)).toBeGreaterThan(difficultyOf(remember.signal));
  });

  it("the Bloom ladder is monotone in difficulty (remember < understand < apply < analyze < evaluate < create)", async () => {
    const ladder = ["remember", "understand", "apply", "analyze", "evaluate", "create"] as const;
    const ws: number[] = [];
    for (const b of ladder) {
      const r = await grade(quiz("c"), { kind: "quiz_choice", choiceId: "b" }, { ...baseDeps, bloomLevel: b });
      ws.push(difficultyOf(r.signal));
    }
    for (let i = 1; i < ws.length; i++) expect(ws[i]!).toBeGreaterThan(ws[i - 1]!);
  });

  it("understand maps to exactly 0.5 (backward-compat anchor with the legacy flat model)", async () => {
    const r = await grade(quiz("c"), { kind: "quiz_choice", choiceId: "b" }, { ...baseDeps, bloomLevel: "understand" });
    expect(difficultyOf(r.signal)).toBe(0.5);
  });

  it("absent bloom -> legacy 0.5 quiz default (backward compatible)", async () => {
    const r = await grade(quiz("c"), { kind: "quiz_choice", choiceId: "b" }, baseDeps);
    expect(difficultyOf(r.signal)).toBe(0.5);
  });
});
