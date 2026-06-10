import { makeLLMClient, type LLMClientOptions } from "@studium/llm-client";
import { classifyTurn, type ClassifyResult } from "@studium/reasoning-scorer";
import type { ReasoningScorer } from "../ports.js";

const RUNTIME_ALIAS = "studium/runtime-tutor" as const;

export class LiteLLMReasoningScorer implements ReasoningScorer {
  private readonly llm: { complete: (prompt: string) => Promise<string> };
  constructor(opts: LLMClientOptions, private readonly timeoutMs = 2000) {
    const client = makeLLMClient(opts);
    this.llm = { complete: (prompt: string) => client.complete(prompt, RUNTIME_ALIAS) };
  }
  async score(turn: string, topic: string): Promise<ClassifyResult | null> {
    try { return await classifyTurn(this.llm, turn, topic, { timeoutMs: this.timeoutMs }); }
    catch { return null; }  // graceful degradation (spec §8.3)
  }
}

export class StubReasoningScorer implements ReasoningScorer {
  constructor(private readonly result: ClassifyResult | null = { signal: "justification", confidence: 0.5 }) {}
  async score(_turn: string, _topic: string): Promise<ClassifyResult | null> { return this.result; }
}
