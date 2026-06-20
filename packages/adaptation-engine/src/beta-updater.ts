import type { ConceptState, Signal } from "@studium/learner-state";

type AnswerSubmitted = Extract<Signal, { kind: "answer_submitted" }>;

export function updateBeta(state: ConceptState, signal: AnswerSubmitted): ConceptState {
  const w = signal.difficulty;
  if (signal.correct) {
    return {
      ...state,
      // M5 anti-offloading hint discount — STRENGTHENED: each hint halves the marginal credit
      // (/(1+2h)), so hinted-correct answers cannot drive certification as cheaply as autonomous ones
      // (0 hints -> full 1.5; 1 hint -> 0.5; 2 hints -> 0.3 at w=0.5).
      alpha: state.alpha + ((1 - w) + 1) / (1 + 2 * signal.hint_count),
      consecutive_errors: 0,
      total_attempts: state.total_attempts + 1,
      total_correct: state.total_correct + 1,
    };
  }
  return {
    ...state,
    beta: state.beta + w + 1,
    consecutive_errors: state.consecutive_errors + 1,
    total_attempts: state.total_attempts + 1,
  };
}
