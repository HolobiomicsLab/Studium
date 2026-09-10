// packages/lesson-session/src/adapters/critique-evaluator.ts
import { z } from "zod";
import type { CritiqueEvaluator, CritiqueEvaluation, Claim, AICritiqueRubric } from "../ports.js";
import { matchClaimsAgainstCritique } from "../grading/ai-audit-matcher.js";

const EvalResponseSchema = z.object({ score: z.number(), feedback: z.string() });

function fallbackScore(claims: Claim[], critique: string): CritiqueEvaluation {
  const audit = matchClaimsAgainstCritique(claims, critique);
  const score = audit.planted_errors === 0 ? 0 : audit.true_positives / audit.planted_errors;
  return { score: Math.max(0, Math.min(1, score)), feedback: `[stub] matched ${audit.true_positives}/${audit.planted_errors}`, source: "keyword" };
}

export class HttpCritiqueEvaluator implements CritiqueEvaluator {
  constructor(private readonly endpoint = "http://localhost:8002/scenes/critique-eval") {}
  async evaluate(input: { claims: Claim[]; rubric: AICritiqueRubric; critique: string }): Promise<CritiqueEvaluation> {
    try {
      const r = await fetch(this.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claims: input.claims, rubric: input.rubric, student_critique: input.critique }),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const parsed = EvalResponseSchema.safeParse(await r.json());
      if (!parsed.success) throw new Error("invalid eval response");
      return { score: Math.max(0, Math.min(1, parsed.data.score)), feedback: parsed.data.feedback, source: "llm" };
    } catch {
      // graceful degradation (spec §8.3) — and SAID SO. The fallback stays; what changes is that
      // the evaluation now carries `source: "keyword"`, so a degraded run is legible downstream
      // instead of being indistinguishable from a live one.
      return fallbackScore(input.claims, input.critique);
    }
  }
}

export class StubCritiqueEvaluator implements CritiqueEvaluator {
  async evaluate(input: { claims: Claim[]; rubric: AICritiqueRubric; critique: string }): Promise<CritiqueEvaluation> {
    return fallbackScore(input.claims, input.critique);
  }
}
