// packages/lesson-session/src/grading/ai-audit-matcher.test.ts
import { describe, it, expect } from "vitest";
import { matchClaimsAgainstCritique } from "./ai-audit-matcher.js";

const claims = [{ id: "c1", flaws_expected: ["small_sample", "no_control"] }];

describe("matchClaimsAgainstCritique", () => {
  it("counts direct substring matches", () => {
    const r = matchClaimsAgainstCritique(claims, "the small sample and no control are issues");
    expect(r).toEqual({ planted_errors: 2, true_positives: 2, false_positives: 0, missed: 0 });
  });
  it("matches reordered tokens", () => {
    const r = matchClaimsAgainstCritique(claims, "the sample is too small");
    expect(r.true_positives).toBe(1);
    expect(r.missed).toBe(1);
  });
  it("zero claims → zero planted", () => {
    expect(matchClaimsAgainstCritique([], "anything")).toEqual({
      planted_errors: 0, true_positives: 0, false_positives: 0, missed: 0,
    });
  });
});
