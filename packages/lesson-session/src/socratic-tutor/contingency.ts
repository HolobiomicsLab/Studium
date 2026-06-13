// contingency.ts
import type { ReasoningSignal } from "@studium/reasoning-scorer";
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
export const FADED_FALLBACK: Record<ReasoningSignal, TutorMove> = {
  justification: { move_kind: "probe_justification", revealed: false,
    text: "Quel est le maillon le plus faible de ton raisonnement ? Quel serait le meilleur argument contre ?" },
  hypothesis: { move_kind: "invite_test", revealed: false,
    text: "Qu'observerais-tu si c'était vrai ? Comment pourrais-tu le vérifier toi-même ?" },
  question: { move_kind: "redirect_question", revealed: false,
    text: "Bonne question — qu'est-ce que tu sais déjà qui pourrait t'orienter vers la réponse ?" },
  counterexample: { move_kind: "acknowledge_extend", revealed: false,
    text: "Ton contre-exemple tient. Dans quels cas l'affirmation de départ resterait-elle vraie ?" },
  synthesis: { move_kind: "probe_synthesis", revealed: false,
    text: "Formule-le comme une seule règle, puis nomme un cas qu'elle ne couvre pas." },
};
