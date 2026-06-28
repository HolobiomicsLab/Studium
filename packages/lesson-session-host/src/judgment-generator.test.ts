// The per-run judgment generators: the stub anchors flaws on the learner's landmark; the LLM generator
// parses + VALIDATES the reply (a valid answer key, or it degrades to the stub — never an invalid scene).
import { describe, it, expect, vi, afterEach } from "vitest";
import { StubJudgmentGenerator, HttpLlmJudgmentGenerator, type JudgmentGenInput } from "./judgment-generator.js";

const input: JudgmentGenInput = {
  reference_run: { ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457", checks: [], provenance: { cmd: ["python"], env: "uv" } } as never,
  concept_id: "c-kinetics",
  objective_text: "Interpréter une constante de vitesse du premier ordre",
  n_flaws: 2,
};

afterEach(() => { vi.restoreAllMocks(); });

describe("StubJudgmentGenerator", () => {
  it("anchors the flawed reading on the learner's landmark + emits a valid answer key", async () => {
    const g = await new StubJudgmentGenerator().generateFlaw(input);
    expect(g.flawed_content).toContain("k_fit=0.4212");
    expect(g.claims.length).toBeGreaterThanOrEqual(1);
    for (const c of g.claims) expect(c.flaws_expected.length).toBeGreaterThanOrEqual(1);
  });
});

describe("HttpLlmJudgmentGenerator (live, OpenAI-compatible)", () => {
  it("parses + validates a well-formed reply", async () => {
    const reply = {
      flawed_content: "Lecture IA : k=0.4212 serait sans dimension.",
      claims: [
        { id: "f-unit", text: "k sans dimension", flaws_expected: ["unites", "dimension"] },
        { id: "f-half", text: "demi-vie > 1h", flaws_expected: ["demi-vie"] },
      ],
      model_correction: "k est un taux (1/temps) ; demi-vie ≈ 1.65.",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status: 200 }));
    const g = await new HttpLlmJudgmentGenerator("http://x", { apiKey: "k", model: "m" }).generateFlaw(input);
    expect(g.claims.map((c) => c.id)).toEqual(["f-unit", "f-half"]);
    expect(g.flawed_content).toContain("0.4212");
  });

  it("DEGRADES to the stub on a non-200 (never an invalid / answer-key-less scene)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const g = await new HttpLlmJudgmentGenerator("http://x").generateFlaw(input);
    expect(g.flawed_content).toContain("k_fit=0.4212"); // stub anchored on the landmark
    expect(g.claims.length).toBe(2);
  });

  it("DEGRADES when the reply violates the schema (a claim with no flaws_expected)", async () => {
    const bad = { flawed_content: "x", claims: [{ id: "f", text: "t", flaws_expected: [] }], model_correction: "y" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(bad) } }] }), { status: 200 }));
    const g = await new HttpLlmJudgmentGenerator("http://x").generateFlaw(input);
    for (const c of g.claims) expect(c.flaws_expected.length).toBeGreaterThanOrEqual(1); // stub key, always valid
  });
});
