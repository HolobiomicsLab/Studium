import { describe, it, expect } from "vitest";
import { StubReasoningScorer, LiteLLMReasoningScorer } from "./reasoning-scorer.js";

describe("reasoning-scorer adapters", () => {
  it("StubReasoningScorer returns its canned result", async () => {
    const s = new StubReasoningScorer({ signal: "hypothesis", confidence: 0.6 });
    expect(await s.score("t", "topic")).toEqual({ signal: "hypothesis", confidence: 0.6 });
  });
  it("LiteLLMReasoningScorer degrades to null when the gateway is unreachable", async () => {
    const s = new LiteLLMReasoningScorer({ mode: "litellm", baseUrl: "http://127.0.0.1:1" }, 200);
    expect(await s.score("turn", "topic")).toBeNull();
  });
});
