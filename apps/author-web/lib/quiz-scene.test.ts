import { describe, expect, it } from "vitest";
import { QuizSceneSchema, gradeQuizChoice, type QuizScene } from "./quiz-scene";

function base(): QuizScene {
  return {
    id: "q1",
    type: "quiz",
    title: "T",
    objective_refs: [],
    concept_refs: ["c-orbitales-formes"],
    estimated_seconds: 30,
    adaptation_hooks: [],
    question: "Q ?",
    choices: [
      { id: "a", text: "A", correct: true },
      { id: "b", text: "B", correct: false },
    ],
    feedback_correct: "bravo",
    feedback_incorrect: "raté",
    hints: [],
  };
}

describe("QuizSceneSchema exactly-one-correct refine", () => {
  it("accepts a scene with exactly one correct choice", () => {
    expect(QuizSceneSchema.safeParse(base()).success).toBe(true);
  });

  it("rejects zero correct choices", () => {
    const s = base();
    s.choices[0].correct = false;
    const r = QuizSceneSchema.safeParse(s);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /un choix.*correct/i.test(i.message))).toBe(true);
    }
  });

  it("rejects multiple correct choices", () => {
    const s = base();
    s.choices[1].correct = true;
    expect(QuizSceneSchema.safeParse(s).success).toBe(false);
  });

  it("rejects fewer than 2 choices", () => {
    const s = base();
    s.choices = [{ id: "a", text: "A", correct: true }];
    expect(QuizSceneSchema.safeParse(s).success).toBe(false);
  });
});

describe("gradeQuizChoice (key-free self-test)", () => {
  it("returns correct + feedback_correct for the right choice", () => {
    const r = gradeQuizChoice(base(), "a");
    expect(r.correct).toBe(true);
    expect(r.feedback).toBe("bravo");
  });

  it("returns incorrect + feedback_incorrect for a wrong choice", () => {
    const r = gradeQuizChoice(base(), "b");
    expect(r.correct).toBe(false);
    expect(r.feedback).toBe("raté");
  });

  it("treats an unknown choice id as incorrect", () => {
    const r = gradeQuizChoice(base(), "zzz");
    expect(r.correct).toBe(false);
    expect(r.feedback).toBe("raté");
  });
});
