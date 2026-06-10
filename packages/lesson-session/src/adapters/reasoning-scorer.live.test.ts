// packages/lesson-session/src/adapters/reasoning-scorer.live.test.ts
import { describe, it, expect } from "vitest";
import { LiteLLMReasoningScorer } from "./reasoning-scorer.js";

const RUN = !!process.env.LITELLM_BASE_URL;

describe.skipIf(!RUN)("LiteLLMReasoningScorer — live", () => {
  it("classifies a real turn into a valid reasoning signal", async () => {
    const s = new LiteLLMReasoningScorer({ mode: "litellm", baseUrl: process.env.LITELLM_BASE_URL!, ...(process.env.LITELLM_API_KEY !== undefined ? { apiKey: process.env.LITELLM_API_KEY } : {}) }, 8000);
    const r = await s.score("Parce que les données montrent une corrélation forte, j'en conclus que X.", "causalité");
    expect(r === null || ["justification", "hypothesis", "question", "counterexample", "synthesis"].includes(r.signal)).toBe(true);
  });
});
