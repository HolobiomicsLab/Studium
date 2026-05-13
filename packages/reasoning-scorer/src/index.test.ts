import { describe, it, expect, vi } from "vitest";
import { classifyTurn, type ClassifyResult, type LLMClient } from "./index";

const fakeLLM: LLMClient = {
  complete: vi.fn(async () =>
    JSON.stringify({ signal: "justification", confidence: 0.87 }),
  ),
};

describe("classifyTurn", () => {
  it("returns parsed signal + confidence on valid LLM output", async () => {
    const result = await classifyTurn(fakeLLM, "Because X explains Y.", "topic A");
    expect(result).toEqual<ClassifyResult>({ signal: "justification", confidence: 0.87 });
  });

  it("returns null when LLM output is invalid JSON", async () => {
    const bad: LLMClient = { complete: vi.fn(async () => "not json") };
    expect(await classifyTurn(bad, "x", "t")).toBeNull();
  });

  it("returns null when signal is out of enum", async () => {
    const bad: LLMClient = {
      complete: vi.fn(async () => JSON.stringify({ signal: "garbage", confidence: 0.5 })),
    };
    expect(await classifyTurn(bad, "x", "t")).toBeNull();
  });

  it("returns null when confidence out of [0,1]", async () => {
    const bad: LLMClient = {
      complete: vi.fn(async () => JSON.stringify({ signal: "question", confidence: 1.5 })),
    };
    expect(await classifyTurn(bad, "x", "t")).toBeNull();
  });

  it("respects timeout — returns null if LLM > timeoutMs", async () => {
    const slow: LLMClient = {
      complete: vi.fn(() => new Promise(resolve => setTimeout(
        () => resolve(JSON.stringify({ signal: "synthesis", confidence: 0.9 })),
        3000,
      ))),
    };
    expect(await classifyTurn(slow, "x", "t", { timeoutMs: 100 })).toBeNull();
  });
});
