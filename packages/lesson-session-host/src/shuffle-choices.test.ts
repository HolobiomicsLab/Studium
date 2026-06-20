// packages/lesson-session-host/src/shuffle-choices.test.ts
import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { shuffleQuizChoices } from "./shuffle-choices.js";

// Build a minimal bundle whose every quiz has the correct option FIRST with id "a"
// (exactly the leak the author path produces).
function bundleWithLeakyQuizzes(n: number): LessonBundle {
  const scenes = Array.from({ length: n }, (_, i) => ({
    id: `s-quiz-${i}`,
    type: "quiz" as const,
    title: `Q${i}`,
    objective_refs: [],
    concept_refs: ["c1"],
    estimated_seconds: 60,
    adaptation_hooks: [],
    question: `Question ${i}?`,
    choices: [
      { id: "a", text: "CORRECT", correct: true },
      { id: "b", text: "wrong-1", correct: false },
      { id: "c", text: "wrong-2", correct: false },
    ],
    feedback_correct: "ok",
    feedback_incorrect: "no",
    hints: [],
  }));
  // Only the `scenes` shape matters to shuffleQuizChoices; cast through unknown.
  return { scenes } as unknown as LessonBundle;
}

describe("shuffleQuizChoices", () => {
  it("breaks the 'correct is always first / always a' leak across many quizzes", () => {
    const out = shuffleQuizChoices(bundleWithLeakyQuizzes(30));
    const correctPositions = out.scenes.map((s: any) => s.choices.findIndex((c: any) => c.correct));
    const correctLetters = out.scenes.map((s: any) => s.choices.find((c: any) => c.correct).id);
    // The correct answer must NOT be stuck at index 0 / id "a" for every question.
    expect(new Set(correctPositions).size).toBeGreaterThan(1);
    expect(correctLetters.some((l) => l !== "a")).toBe(true);
  });

  it("preserves each choice's text<->correct pairing (only order + id letters change)", () => {
    const out = shuffleQuizChoices(bundleWithLeakyQuizzes(5));
    for (const s of out.scenes as any[]) {
      const correct = s.choices.find((c: any) => c.correct);
      expect(correct.text).toBe("CORRECT"); // the right answer's content is intact
      expect(s.choices.map((c: any) => c.id)).toEqual(["a", "b", "c"]); // clean sequential labels
      expect(s.choices.filter((c: any) => c.correct).length).toBe(1); // still exactly one correct
    }
  });

  it("is deterministic: same scene id => same permutation on every call", () => {
    const a = shuffleQuizChoices(bundleWithLeakyQuizzes(10));
    const b = shuffleQuizChoices(bundleWithLeakyQuizzes(10));
    const texts = (x: LessonBundle) => x.scenes.map((s: any) => s.choices.map((c: any) => c.text).join(","));
    expect(texts(a)).toEqual(texts(b));
  });

  it("seedSalt: same salt is reproducible; different salts can diverge (per-learner order)", () => {
    const texts = (x: LessonBundle) => x.scenes.map((s: any) => s.choices.map((c: any) => c.text).join(","));
    const alice1 = texts(shuffleQuizChoices(bundleWithLeakyQuizzes(30), "alice"));
    const alice2 = texts(shuffleQuizChoices(bundleWithLeakyQuizzes(30), "alice"));
    const bob = texts(shuffleQuizChoices(bundleWithLeakyQuizzes(30), "bob"));
    const noSalt = texts(shuffleQuizChoices(bundleWithLeakyQuizzes(30)));
    expect(alice1).toEqual(alice2);                         // same salt → reproducible
    expect(alice1.some((q, i) => q !== bob[i])).toBe(true); // different learners → at least one differs
    expect(alice1.some((q, i) => q !== noSalt[i])).toBe(true); // salted differs from the default order
  });

  it("leaves non-quiz scenes and the rest of the bundle untouched", () => {
    const bundle = {
      bundle_id: "x",
      scenes: [
        { id: "intro-0", type: "intro", title: "I", markdown: "hi" },
        {
          id: "s-quiz-0", type: "quiz", title: "Q", question: "?",
          choices: [{ id: "a", text: "CORRECT", correct: true }, { id: "b", text: "w", correct: false }],
          feedback_correct: "y", feedback_incorrect: "n", hints: [],
        },
      ],
    } as unknown as LessonBundle;
    const out = shuffleQuizChoices(bundle);
    expect((out as any).bundle_id).toBe("x");
    expect(out.scenes[0]).toEqual({ id: "intro-0", type: "intro", title: "I", markdown: "hi" });
  });
});
