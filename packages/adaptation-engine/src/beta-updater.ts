import type { ConceptState, Signal } from "@studium/learner-state";

type AnswerSubmitted = Extract<Signal, { kind: "answer_submitted" }>;

export function updateBeta(state: ConceptState, signal: AnswerSubmitted): ConceptState {
  const w = signal.difficulty;
  if (signal.correct) {
    return {
      ...state,
      alpha: state.alpha + ((1 - w) + 1) / (1 + signal.hint_count),   // hint discount: 0 hints -> full; M5 anti-offloading
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
