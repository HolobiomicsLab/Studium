// socratic-tutor.test.ts
import { describe, it, expect } from "vitest";
import { StubSocraticTutor } from "./socratic-tutor.js";

describe("StubSocraticTutor", () => {
  const tutor = new StubSocraticTutor();
  const baseInput = { topic: "t", seedClaim: "s", learnerTurn: "x", history: [] };
  it("returns the contingency move for the signal, never revealing", async () => {
    const m = await tutor.respond({ ...baseInput, signal: "hypothesis", confidence: 0.9 });
    expect(m).not.toBeNull();
    expect(m!.move_kind).toBe("invite_test");
    expect(m!.revealed).toBe(false);
    expect(m!.text.length).toBeGreaterThan(0);
  });
  it("returns scaffold_hint when confidence is low", async () => {
    const m = await tutor.respond({ ...baseInput, signal: "synthesis", confidence: 0.2 });
    expect(m!.move_kind).toBe("scaffold_hint");
  });
});
