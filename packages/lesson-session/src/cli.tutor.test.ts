// cli.tutor.test.ts
import { describe, it, expect } from "vitest";
import { buildNodeDeps } from "./cli.js";

describe("buildNodeDeps — tutor flag", () => {
  it("omits socraticTutor unless BOTH live and liveTutor are set", () => {
    expect(buildNodeDeps("/tmp/x", false, false).socraticTutor).toBeUndefined();
    expect(buildNodeDeps("/tmp/x", true, false).socraticTutor).toBeUndefined(); // --live-llm alone
    expect(buildNodeDeps("/tmp/x", true, true).socraticTutor).toBeDefined();    // both
  });

  it("--stub-tutor wires the deterministic StubSocraticTutor without any LLM", () => {
    // stubTutor=true, live=false -> a non-LLM tutor is wired (for CI + the BEA live-text demo)
    expect(buildNodeDeps("/tmp/x", false, false, true).socraticTutor).toBeDefined();
    // a real live-tutor takes precedence when both are requested
    expect(buildNodeDeps("/tmp/x", false, false, false).socraticTutor).toBeUndefined();
  });
});
