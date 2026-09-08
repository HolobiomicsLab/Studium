// judgment-generator.ts — server-side per-run judgment REGENERATION port.
//
// When the learner runs a capsule, the host regenerates a downstream spot_the_flaw's flawed reading +
// answer key FROM THE LEARNER'S OWN run, so the planted flaws match the learner's real numbers — sound
// even for a STOCHASTIC capsule (lifts the determinism caveat on reference_from_run grounding). The
// regenerated claims ARE the answer key, so they stay SERVER-SIDE (publicScene still strips them). The
// LIVE generator is LLM-backed (needs an API key); the stub is deterministic for key-free tests + demos.
import { z } from "zod";
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

const GenReplySchema = z.object({
  flawed_content: z.string().min(1),
  claims: z.array(z.object({
    id: z.string().min(1), text: z.string().min(1), flaws_expected: z.array(z.string().min(1)).min(1),
  })).min(1).max(5),
  model_correction: z.string().min(1),
  rubric: z.object({ completeness: z.number(), evidence_quality: z.number(), tone: z.number() }).optional(),
});

/** LLM-backed per-run judgment generator over an OpenAI-compatible /v1/chat/completions endpoint
 * (LiteLLM proxy or OpenRouter directly). It writes a deliberately-flawed AI READING of the learner's
 * OWN run (anchored on their real landmark) plus the answer key (claims + flaws_expected keywords the
 * offline matcher scores against) and a model_correction. Validated with zod (rule 002); ANY failure
 * (transport, non-JSON, schema) degrades to the deterministic StubJudgmentGenerator so a flaky model can
 * never ship an unparseable / answer-key-less judgment scene. The generated key stays SERVER-SIDE
 * (publicScene strips claims/sound_claims/model_correction). */
export class HttpLlmJudgmentGenerator implements JudgmentGenerator {
  private readonly stub = new StubJudgmentGenerator();
  constructor(
    private readonly baseUrl: string,
    private readonly opts: { apiKey?: string; model?: string; timeoutMs?: number } = {},
  ) {}
  async generateFlaw(input: JudgmentGenInput): Promise<GeneratedFlaw> {
    const lm = input.reference_run.landmark ?? "(aucun landmark)";
    const n = input.n_flaws ?? 2;
    try {
      const prompt = [
        "Tu fabriques une LECTURE IA DÉLIBÉRÉMENT FAUSSE d'un résultat scientifique réellement exécuté,",
        "que l'apprenant devra ensuite AUDITER. Ancre-toi STRICTEMENT sur le résultat réel ci-dessous —",
        "n'invente aucune valeur ; les fautes doivent porter sur l'INTERPRÉTATION, pas sur des nombres inventés.",
        `Objectif pédagogique : ${input.objective_text}`,
        `Concept : ${input.concept_id}`,
        `Résultat réel (landmark) : ${lm}`,
        input.reference_run.figure_path ? `Figure : ${input.reference_run.figure_path}` : "",
        "",
        `Renvoie UNIQUEMENT un JSON : {"flawed_content": "<la lecture IA fausse, en français>",`,
        `"claims": [${n} objets {"id":"f-...","text":"<l'affirmation fausse>","flaws_expected":["<mot-clé>", ...]}],`,
        `"model_correction": "<la lecture correcte ancrée sur le résultat réel>"}.`,
        "Chaque claim DOIT avoir au moins un flaws_expected (les mots-clés que la critique de l'apprenant",
        "doit contenir pour être créditée). Exactement " + n + " claims, fautes distinctes.",
      ].filter(Boolean).join("\n");
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.opts.model ?? "studium/judgment-generator",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000), // a hanging endpoint must not stall the run-ingest → degrade
      });
      if (!res.ok) throw new Error(`judgment-gen ${res.status}`);
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = j.choices?.[0]?.message?.content ?? "{}";
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const parsed = GenReplySchema.parse(JSON.parse((m?.[1] ?? raw).trim()));
      return {
        flawed_content: parsed.flawed_content,
        claims: parsed.claims,
        model_correction: parsed.model_correction,
        ...(parsed.rubric ? { rubric: parsed.rubric } : {}),
      };
    } catch {
      return this.stub.generateFlaw(input); // degrade: a valid deterministic key, never an invalid scene
    }
  }
}
