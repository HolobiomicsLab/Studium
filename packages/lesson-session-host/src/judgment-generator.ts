// judgment-generator.ts — server-side per-run judgment REGENERATION port.
//
// When the learner runs a capsule, the host regenerates a downstream spot_the_flaw's flawed reading +
// answer key FROM THE LEARNER'S OWN run, so the planted flaws match the learner's real numbers — sound
// even for a STOCHASTIC capsule (lifts the determinism caveat on reference_from_run grounding). The
// regenerated claims ARE the answer key, so they stay SERVER-SIDE (publicScene still strips them). The
// LIVE generator is LLM-backed (needs an API key); the stub is deterministic for key-free tests + demos.
import type { ReferenceRun } from "@studium/lesson-bundle-schema";

export interface GeneratedFlaw {
  flawed_content: string;
  claims: Array<{ id: string; text: string; flaws_expected: string[] }>;
  model_correction: string;
  rubric?: { completeness: number; evidence_quality: number; tone: number };
}

export interface JudgmentGenInput {
  reference_run: ReferenceRun; // the learner's OWN run (landmark + checks)
  concept_id: string;
  objective_text: string;
  n_flaws?: number;
}

export interface JudgmentGenerator {
  generateFlaw(input: JudgmentGenInput): Promise<GeneratedFlaw>;
}

/** Deterministic, key-free stub: a flawed reading anchored on the learner's ACTUAL landmark (so the flaws
 * are about THEIR numbers). A real LLM generator writes richer prose; both ground on the same run. */
export class StubJudgmentGenerator implements JudgmentGenerator {
  async generateFlaw(input: JudgmentGenInput): Promise<GeneratedFlaw> {
    const lm = input.reference_run.landmark ?? "le resultat mesure";
    return {
      flawed_content: `Lecture IA de TON run (${lm}) : k serait sans dimension, donc la demi-vie depasserait une heure.`,
      claims: [
        { id: "f-unit", text: "k serait sans dimension", flaws_expected: ["unites"] },
        { id: "f-half", text: "demi-vie > 1h", flaws_expected: ["demi-vie"] },
      ],
      model_correction: `Lecture correcte ancree sur ${lm} : k est un taux (1/temps) ; la demi-vie vaut ln2/k.`,
      rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
    };
  }
}
