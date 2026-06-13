// cli.tutor.test.ts
import { describe, it, expect } from "vitest";
import { buildNodeDeps } from "./cli.js";

describe("buildNodeDeps — tutor flag", () => {
  it("omits socraticTutor unless BOTH live and liveTutor are set", () => {
    expect(buildNodeDeps("/tmp/x", false, false).socraticTutor).toBeUndefined();
    expect(buildNodeDeps("/tmp/x", true, false).socraticTutor).toBeUndefined(); // --live-llm alone
    expect(buildNodeDeps("/tmp/x", true, true).socraticTutor).toBeDefined();    // both
  });
});
