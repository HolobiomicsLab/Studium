// contingency.ts
import type { ReasoningSignal } from "@studium/reasoning-scorer";
import { phrase, type Locale } from "../phrases.js";
import type { TutorMove, TutorMoveKind } from "./types.js";

export const LOW_CONFIDENCE = 0.4;

const MOVE_FOR_SIGNAL: Record<ReasoningSignal, TutorMoveKind> = {
  justification: "probe_justification",
  hypothesis: "invite_test",
  question: "redirect_question",
  counterexample: "acknowledge_extend",
  synthesis: "probe_synthesis",
};

/** Ideal move for a learner signal. Below LOW_CONFIDENCE the classifier label is
 * untrustworthy, so we fall back to the lowest-commitment scaffold_hint. */
export function moveKindForSignal(signal: ReasoningSignal, confidence: number): TutorMoveKind {
  if (confidence < LOW_CONFIDENCE) return "scaffold_hint";
  return MOVE_FOR_SIGNAL[signal];
}

/** Canned, never-revealing replies used when the live tutor is missing OR when the
 * reveal guardrail trips. move_kind carries the signal's ideal kind; text is generic. */
export function fadedFallback(locale: Locale): Record<ReasoningSignal, TutorMove> {
  return {
  justification: { move_kind: "probe_justification", revealed: false,
    text: phrase("tutor_justification", {}, locale) },
  hypothesis: { move_kind: "invite_test", revealed: false,
    text: phrase("tutor_hypothesis", {}, locale) },
  question: { move_kind: "redirect_question", revealed: false,
    text: phrase("tutor_question", {}, locale) },
  counterexample: { move_kind: "acknowledge_extend", revealed: false,
    text: phrase("tutor_counterexample", {}, locale) },
  synthesis: { move_kind: "probe_synthesis", revealed: false,
    text: phrase("tutor_synthesis", {}, locale) },
  };
}

/** Backward-compatible French default for callers that do not yet carry a Presentation locale. */
export const FADED_FALLBACK: Record<ReasoningSignal, TutorMove> = fadedFallback("fr");
