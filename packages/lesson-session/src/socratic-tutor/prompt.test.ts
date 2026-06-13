// prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildTutorPrompt, parseTutorMove } from "./prompt.js";

const input = { topic: "Peroxysomes", seedClaim: "Ils dégradent H2O2",
  learnerTurn: "Je pense que…", signal: "hypothesis" as const, confidence: 0.8, history: [] };

describe("buildTutorPrompt", () => {
  it("includes topic, learner turn, the signal, and an anti-offloading instruction", () => {
    const p = buildTutorPrompt(input);
    expect(p).toContain("Peroxysomes");
    expect(p).toContain("Je pense que");
    expect(p).toContain("hypothesis");
    expect(p.toLowerCase()).toContain("jamais"); // "ne révèle JAMAIS la réponse"
  });
});

describe("parseTutorMove", () => {
  it("parses strict JSON into a TutorMove", () => {
    const m = parseTutorMove('{"text":"Qu observerais-tu ?","move_kind":"invite_test","revealed":false}');
    expect(m).toEqual({ text: "Qu observerais-tu ?", move_kind: "invite_test", revealed: false });
  });
  it("returns null on malformed JSON or unknown move_kind", () => {
    expect(parseTutorMove("not json")).toBeNull();
    expect(parseTutorMove('{"text":"x","move_kind":"reveal","revealed":false}')).toBeNull();
    expect(parseTutorMove('{"text":"x","move_kind":"invite_test"}')).toBeNull(); // missing revealed
  });
});
