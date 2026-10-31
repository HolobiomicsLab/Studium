// packages/lesson-session/src/adapters/audit-judge.ts
//
// The AuditJudge that can measure the OVER-DISTRUST direction of trust_calibration — the one thing the
// keyword matcher (ai-audit-matcher.ts) structurally cannot, because it only carries the planted-flaw
// answer key and so can't tell a wrongly-flagged SOUND claim from praise. An AuditJudge is told BOTH the
// planted flaws AND the sound claims, and reports which the critique caught vs wrongly flagged.
//
//   - StubAuditJudge : deterministic, key-free. Substring-matches the critique against each claim's text
//     tokens to decide "mentioned"; it CANNOT tell whether a mention is a flag or praise, so it never
//     reports a sound claim as wrongly-flagged (false_positives stays 0). Exists so the wiring + tests run
//     without a key — it deliberately does NOT lift the honesty boundary (only a real LLM can).
//   - HttpLlmAuditJudge : an OpenAI-compatible chat endpoint (LiteLLM proxy, OpenRouter, …) that JUDGES
//     the critique semantically and returns the two id-lists. Validated (rule 002) — a malformed reply
//     degrades to the keyword fallback (caught by tokens, no false positives) so a flaky model never
//     fabricates an over-distrust signal.
//   Each judgement carries its `source` ("llm" | "keyword") so the learner-facing feedback never shows
//   a keyword catch as a measured count (RT-1).
import { z } from "zod";
import type { AuditJudge, AuditInput, AuditJudgement } from "../ports.js";

function tokens(s: string): string[] {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-'’]/g, " ")
    .split(/\s+/).filter((t) => t.length > 2);
}
/** Best-effort offline catch detection: a claim is "caught" if the critique contains all of its
 * significant tokens. Used by the stub and as the HTTP judge's degradation path. Never flags a sound
 * claim (offline can't distinguish flag from praise) — false_positives = []. */
function keywordCatch(input: AuditInput): AuditJudgement {
  const crit = tokens(input.critique).join(" ");
  const caught_flaw_ids = input.flawed_claims
    .filter((c) => { const ts = tokens(c.text); return ts.length > 0 && ts.every((t) => crit.includes(t)); })
    .map((c) => c.id);
  return { caught_flaw_ids, wrongly_flagged_sound_ids: [], source: "keyword" };
}

export class StubAuditJudge implements AuditJudge {
  async judge(input: AuditInput): Promise<AuditJudgement> { return keywordCatch(input); }
}

const JudgeReplySchema = z.object({
  caught_flaw_ids: z.array(z.string()),
  wrongly_flagged_sound_ids: z.array(z.string()),
});

/** LLM-backed AuditJudge over an OpenAI-compatible /v1/chat/completions endpoint. Provider-agnostic:
 * point `baseUrl` at a LiteLLM proxy or directly at OpenRouter (`https://openrouter.ai/api`). */
export class HttpLlmAuditJudge implements AuditJudge {
  constructor(
    private readonly baseUrl: string,
    private readonly opts: { apiKey?: string; model?: string; timeoutMs?: number } = {},
  ) {}
  async judge(input: AuditInput): Promise<AuditJudgement> {
    const flawIds = new Set(input.flawed_claims.map((c) => c.id));
    const soundIds = new Set(input.sound_claims.map((s) => s.id));
    try {
      const prompt = [
        "Tu es un correcteur. Une lecture IA d'un résultat exécuté contient des affirmations FAUSSES",
        "(à signaler) et des affirmations CORRECTES (à NE PAS signaler). Voici la critique d'un apprenant.",
        "Renvoie UNIQUEMENT un JSON {\"caught_flaw_ids\":[...],\"wrongly_flagged_sound_ids\":[...]} où",
        "caught_flaw_ids = les FAUTES réellement identifiées par la critique, et",
        "wrongly_flagged_sound_ids = les affirmations CORRECTES que la critique qualifie À TORT de fausses.",
        "",
        `Lecture IA : ${input.flawed_content}`,
        `FAUTES (id: texte) : ${input.flawed_claims.map((c) => `${c.id}: ${c.text}`).join(" | ")}`,
        `CORRECTES (id: texte) : ${input.sound_claims.map((s) => `${s.id}: ${s.text}`).join(" | ")}`,
        `CRITIQUE de l'apprenant : ${input.critique}`,
      ].join("\n");
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.opts.model ?? "studium/audit-judge",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
        // a hanging judge endpoint must NOT block the learner's respond() — time out → degrade.
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
      });
      if (!res.ok) throw new Error(`audit-judge ${res.status}`);
      const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = j.choices?.[0]?.message?.content ?? "{}";
      const parsed = JudgeReplySchema.parse(JSON.parse(stripFence(raw)));
      // GUARD: only ids that actually exist in the scene's keys count (drop hallucinated ids).
      return {
        caught_flaw_ids: parsed.caught_flaw_ids.filter((id) => flawIds.has(id)),
        wrongly_flagged_sound_ids: parsed.wrongly_flagged_sound_ids.filter((id) => soundIds.has(id)),
        source: "llm",
      };
    } catch {
      return keywordCatch(input); // degrade: catch by keyword, never fabricate over-distrust
    }
  }
}

/** Tolerate a model that wraps JSON in a ```json fence. */
function stripFence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m?.[1] ?? s).trim();
}
