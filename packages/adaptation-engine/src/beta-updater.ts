import type { ConceptState, Signal } from "@studium/learner-state";

type AnswerSubmitted = Extract<Signal, { kind: "answer_submitted" }>;

/** Record an attempt whose correctness was NEVER MEASURED (INT-STUDIUM-035 candidate 2: a free-text
 * answer graded offline by the substring matcher). Nothing that means "the learner knows this"
 * moves: not alpha, not beta, not `total_attempts` — which is read as evidence and must not be
 * satisfiable by answers nobody graded — and not `consecutive_errors`, because failing to grade an
 * answer is not the learner failing, and an ungraded attempt does not clear a real error streak
 * either. Only the count of such attempts rises, so the absence is legible rather than invisible. */
export function recordUngradedAttempt(state: ConceptState): ConceptState {
  return { ...state, ungraded_attempts: (state.ungraded_attempts ?? 0) + 1 };
}

export function updateBeta(state: ConceptState, signal: AnswerSubmitted): ConceptState {
  const w = signal.difficulty;
  if (signal.correct === undefined) {
    // Defensive: the engine branches before calling this, but `correct` is optional at the type
    // level and `if (signal.correct)` would silently read UNMEASURED as WRONG — beta + 1 and an
    // error streak for an answer nobody graded.
    return recordUngradedAttempt(state);
  }
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
