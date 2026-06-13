// contingency.test.ts
import { describe, it, expect } from "vitest";
import { moveKindForSignal, FADED_FALLBACK } from "./contingency.js";

describe("moveKindForSignal", () => {
  it("maps each signal to its ideal move at normal confidence", () => {
    expect(moveKindForSignal("hypothesis", 0.9)).toBe("invite_test");
    expect(moveKindForSignal("counterexample", 0.9)).toBe("acknowledge_extend");
    expect(moveKindForSignal("question", 0.9)).toBe("redirect_question");
    expect(moveKindForSignal("justification", 0.9)).toBe("probe_justification");
    expect(moveKindForSignal("synthesis", 0.9)).toBe("probe_synthesis");
  });
  it("forces scaffold_hint when confidence < 0.4 regardless of signal", () => {
    expect(moveKindForSignal("synthesis", 0.39)).toBe("scaffold_hint");
    expect(moveKindForSignal("hypothesis", 0.1)).toBe("scaffold_hint");
  });
  it("FADED_FALLBACK has a non-revealing canned move for every signal", () => {
    for (const s of ["justification", "hypothesis", "question", "counterexample", "synthesis"] as const) {
      expect(FADED_FALLBACK[s].revealed).toBe(false);
      expect(FADED_FALLBACK[s].text.length).toBeGreaterThan(0);
    }
  });
});
