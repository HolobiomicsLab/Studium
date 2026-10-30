/**
 * The Beta mastery update (alpha = evidence of knowing, beta = evidence of not knowing).
 *
 * Per graded answer at difficulty w ∈ [0, 1] with h hints:
 *   correct:  alpha += c / (1 + 2h)           c = (1 - w) + 1, the credit of an unhinted success (M5:
 *                                             each hint shrinks it, anti-offloading)
 *   wrong:    beta  += w + 1
 *
 * Two corrections (RT-2, sprint 2026-10-30):
 *
 * 1. CORRECTION FOR GUESSING on a choice item with guess rate g (k right choices out of n ⇒ g = k/n).
 *    Formula scoring: a guesser answers right g/(1 - g) times for every miss, so on average each wrong
 *    answer stands for g/(1 - g) lucky successes. A wrong answer therefore also MOVES
 *        τ = min(alpha - 1, c · g / (1 - g))
 *    from alpha to beta. For a learner who knows a fraction p of the items and guesses the rest, the
 *    expected posterior then tends to p instead of p + (1 - p)·g — exactly at w = 0.5, the quiz default,
 *    where a success and a miss weigh the same; other difficulties tilt it only by their own weighting
 *    (p = 0.5, g = 0.5: 0.53 at w = 0.3, 0.42 at w = 0.9, against 0.80 and 0.64 uncorrected). A
 *    coin-flipper on true/false items no longer reads 0.50. Correct answers are untouched (two clean answers on any quiz still reach
 *    0.8), and only credit already earned can move: alpha never drops below its prior of 1, so a miss
 *    before any success counts as one miss. Signals without a guess rate (free text graded by a judge,
 *    a verdict deck scored by identity, legacy history) update exactly as before.
 *
 * 2. PSEUDO-COUNT CAP: when alpha + beta exceeds PSEUDO_COUNT_CAP both are scaled down by the same
 *    factor, which keeps the posterior mean and bounds the weight of old evidence. Without it, mastery
 *    0.94 after ten successes still read 0.55 after eight further misses (the 2026-10-30 probe); with it
 *    an unhinted answer (weight 1 to 2) always carries at least 1/21 (about 5 %) of the total.
 *    Attempt and success COUNTS are not scaled: they are what the minimum-attempts floor and the
 *    flawless-record gate read.
 */
import type { ConceptState, Signal } from "@studium/learner-state";

type AnswerSubmitted = Extract<Signal, { kind: "answer_submitted" }>;

/** Upper bound on alpha + beta (see the header): the uniform prior (2) plus 12 answers at difficulty 0.5. */
export const PSEUDO_COUNT_CAP = 20;

/** Scale alpha and beta down together when their sum exceeds the cap (mean preserved). */
function capPseudoCounts(state: ConceptState): ConceptState {
  const total = state.alpha + state.beta;
  if (total <= PSEUDO_COUNT_CAP + 1e-9) return state; // tolerance: 1 + 18 × 1.0 is not "above 20"
  const k = PSEUDO_COUNT_CAP / total;
  return { ...state, alpha: state.alpha * k, beta: state.beta * k };
}

/** Credit an unhinted correct answer at difficulty w earns, and so the credit a lucky guess earned. */
function successCredit(difficulty: number): number {
  return (1 - difficulty) + 1;
}

/** τ of the header: the expected lucky-guess credit a wrong answer reclassifies, never below the prior. */
function guessTransfer(state: ConceptState, signal: AnswerSubmitted): number {
  const g = signal.guess_rate ?? 0;
  if (g <= 0 || g >= 1) return 0;
  return Math.min(Math.max(0, state.alpha - 1), successCredit(signal.difficulty) * (g / (1 - g)));
}

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
    return capPseudoCounts({
      ...state,
      // M5 anti-offloading hint discount — STRENGTHENED: each hint halves the marginal credit
      // (/(1+2h)), so hinted-correct answers cannot drive certification as cheaply as autonomous ones
      // (0 hints -> full 1.5; 1 hint -> 0.5; 2 hints -> 0.3 at w=0.5).
      alpha: state.alpha + successCredit(w) / (1 + 2 * signal.hint_count),
      consecutive_errors: 0,
      total_attempts: state.total_attempts + 1,
      total_correct: state.total_correct + 1,
    });
  }
  const transfer = guessTransfer(state, signal);
  return capPseudoCounts({
    ...state,
    alpha: state.alpha - transfer,
    beta: state.beta + w + 1 + transfer,
    consecutive_errors: state.consecutive_errors + 1,
    total_attempts: state.total_attempts + 1,
  });
}
