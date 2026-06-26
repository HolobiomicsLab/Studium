// Client-side QuizScene Zod schema + a KEY-FREE pure grader.
//
// The schema mirrors QuizSceneSchema from @studium/lesson-bundle-schema
// FIELD-FOR-FIELD, PLUS the `exactly-one-correct` refine that the canonical
// schema deliberately omits (it is enforced by validate_scene() on the backend
// and must also be enforced client-side so the form's green badge is honest).
//
// gradeQuizChoice is the KEY-FREE self-test: a tiny pure function (no API key,
// no LLM, no Node-only SessionHost). It reproduces exactly the quiz branch of
// the canonical quizGrader (@studium/lesson-session): find the chosen choice,
// the answer is correct iff that choice is flagged correct. The learner answers
// their own quiz and sees the real feedback_correct / feedback_incorrect.
import { z } from "zod";

export const QuizChoiceSchema = z.object({
  id: z.string().min(1, "id requis"),
  text: z.string().min(1, "texte requis"),
  correct: z.boolean(),
});

export const QuizSceneSchema = z
  .object({
    id: z.string().min(1, "id requis"),
    type: z.literal("quiz"),
    title: z.string().min(1, "titre requis"),
    objective_refs: z.array(z.string()),
    concept_refs: z.array(z.string()),
    estimated_seconds: z.number().int().nonnegative(),
    adaptation_hooks: z.array(z.string()),
    question: z.string().min(1, "question requise"),
    choices: z.array(QuizChoiceSchema).min(2).max(6),
    feedback_correct: z.string().min(1, "feedback (correct) requis"),
    feedback_incorrect: z.string().min(1, "feedback (incorrect) requis"),
    hints: z.array(z.string()),
  })
  // exactly-one-correct — NOT in the canonical schema; enforced here AND by the
  // backend validate_scene(). A quiz with zero or several correct choices is
  // unanswerable/ambiguous.
  .refine(
    (s) => s.choices.filter((c) => c.correct).length === 1,
    { message: "Exactement un choix doit être correct.", path: ["choices"] }
  );

export type QuizScene = z.infer<typeof QuizSceneSchema>;

export type QuizGradeResult = {
  correct: boolean;
  feedback: string;
};

// KEY-FREE local grader. Mirrors the quiz branch of the canonical quizGrader:
// correct iff the chosen choice is flagged correct. Returns the authored
// feedback_correct / feedback_incorrect so the learner sees real feedback.
export function gradeQuizChoice(
  scene: Pick<QuizScene, "choices" | "feedback_correct" | "feedback_incorrect">,
  choiceId: string
): QuizGradeResult {
  const choice = scene.choices.find((c) => c.id === choiceId);
  const correct = choice?.correct ?? false;
  return {
    correct,
    feedback: correct ? scene.feedback_correct : scene.feedback_incorrect,
  };
}
