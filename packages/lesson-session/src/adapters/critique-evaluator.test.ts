// packages/lesson-session/src/adapters/critique-evaluator.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpCritiqueEvaluator, StubCritiqueEvaluator } from "./critique-evaluator.js";

const claims = [{ id: "c1", text: "n=3", flaws_expected: ["small_sample"] }];
const rubric = { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 };
afterEach(() => { vi.restoreAllMocks(); });

describe("critique-evaluator adapters", () => {
  it("StubCritiqueEvaluator derives score from audit ratio", async () => {
    const e = new StubCritiqueEvaluator();
    const hit = await e.evaluate({ claims, rubric, critique: "the small sample is a problem" });
    expect(hit.score).toBe(1);
    const miss = await e.evaluate({ claims, rubric, critique: "looks fine" });
    expect(miss.score).toBe(0);
  });
  it("HttpCritiqueEvaluator parses a valid eval response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ score: 0.75, feedback: "ok" }), { status: 200 })));
    const e = new HttpCritiqueEvaluator("http://localhost:8002/scenes/critique-eval");
    expect(await e.evaluate({ claims, rubric, critique: "x" })).toEqual({ score: 0.75, feedback: "ok" });
  });
  it("HttpCritiqueEvaluator degrades to audit-ratio score on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    const e = new HttpCritiqueEvaluator();
    const r = await e.evaluate({ claims, rubric, critique: "small sample issue" });
    expect(r.score).toBe(1); // fallback audit hit
  });
});
