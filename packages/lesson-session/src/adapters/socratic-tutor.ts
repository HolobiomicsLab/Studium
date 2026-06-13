import type { SocraticTutor } from "../ports.js";
import type { TutorInput, TutorMove } from "../socratic-tutor/types.js";
import { moveKindForSignal, FADED_FALLBACK } from "../socratic-tutor/contingency.js";

/** Deterministic, LLM-free tutor: returns the contingency-table move for the signal
 * (scaffold_hint under low confidence), using the canned faded text. Never reveals.
 * Used by all default tests and as the offline driver. */
export class StubSocraticTutor implements SocraticTutor {
  async respond(input: TutorInput): Promise<TutorMove | null> {
    const kind = moveKindForSignal(input.signal, input.confidence);
    if (kind === "scaffold_hint") {
      return { move_kind: "scaffold_hint", revealed: false,
        text: "Avance d'un pas : qu'est-ce que tu sais déjà qui pourrait t'aider, sans donner la réponse ?" };
    }
    const fallback = FADED_FALLBACK[input.signal];
    return { move_kind: kind, revealed: false, text: fallback.text };
  }
}
