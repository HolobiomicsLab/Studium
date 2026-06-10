import { describe, it, expect } from "vitest";
import { LLM_ALIASES, makeLLMClient } from "./index.js";

describe("runtime-tutor alias", () => {
  it("is part of LLM_ALIASES", () => {
    expect(LLM_ALIASES).toContain("studium/runtime-tutor");
  });
  it("mock client accepts the alias", async () => {
    const c = makeLLMClient({ mode: "mock" });
    await expect(c.complete("hi", "studium/runtime-tutor")).resolves.toContain("studium/runtime-tutor");
  });
});
