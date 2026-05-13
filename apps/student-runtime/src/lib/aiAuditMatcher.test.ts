import { describe, it, expect } from "vitest";
import { matchClaimsAgainstCritique, type MatchResult } from "./aiAuditMatcher";

describe("matchClaimsAgainstCritique", () => {
  it("identifies all true positives when critique mentions every flaw_expected keyword", () => {
    const claims = [
      { id: "c1", text: "...", flaws_expected: ["selection_bias", "small_sample"] },
      { id: "c2", text: "...", flaws_expected: ["correlation_not_causation"] },
    ];
    const critique = "There is selection bias and the sample is too small. Also correlation is not causation.";
    const result = matchClaimsAgainstCritique(claims, critique);
    expect(result).toEqual<MatchResult>({
      planted_errors: 3,
      true_positives: 3,
      false_positives: 0,
      missed: 0,
    });
  });

  it("counts missed when keyword absent from critique", () => {
    const claims = [{ id: "c1", text: "...", flaws_expected: ["bias_X", "missing_evidence_Y"] }];
    const critique = "I think bias X is concerning.";
    const result = matchClaimsAgainstCritique(claims, critique);
    expect(result.true_positives).toBe(1);
    expect(result.missed).toBe(1);
    expect(result.false_positives).toBe(0);
    expect(result.planted_errors).toBe(2);
  });

  it("returns zero counters when critique is empty", () => {
    const claims = [{ id: "c1", text: "...", flaws_expected: ["x"] }];
    expect(matchClaimsAgainstCritique(claims, "")).toEqual<MatchResult>({
      planted_errors: 1,
      true_positives: 0,
      false_positives: 0,
      missed: 1,
    });
  });

  it("handles case-insensitive matching", () => {
    const claims = [{ id: "c1", text: "...", flaws_expected: ["Selection_Bias"] }];
    const critique = "SELECTION BIAS is a problem.";
    const result = matchClaimsAgainstCritique(claims, critique);
    expect(result.true_positives).toBe(1);
  });

  it("treats keyword as substring : 'small_sample' matches 'small sample size'", () => {
    const claims = [{ id: "c1", text: "...", flaws_expected: ["small_sample"] }];
    const critique = "The small sample size is concerning.";
    expect(matchClaimsAgainstCritique(claims, critique).true_positives).toBe(1);
  });

  it("does not count duplicate mentions as multiple TPs", () => {
    const claims = [{ id: "c1", text: "...", flaws_expected: ["bias"] }];
    const critique = "There is bias and bias and bias.";
    expect(matchClaimsAgainstCritique(claims, critique).true_positives).toBe(1);
  });
});
