// The AuditJudge adapters: the stub never fabricates over-distrust (offline can't tell flag from praise);
// the LLM judge parses + GUARDS ids and degrades to the keyword fallback on any failure.
import { describe, it, expect, vi, afterEach } from "vitest";
import { StubAuditJudge, HttpLlmAuditJudge } from "./audit-judge.js";
import type { AuditInput } from "../ports.js";

const input: AuditInput = {
  flawed_content: "k is dimensionless so the half-life exceeds an hour",
  flawed_claims: [
    { id: "f-unit", text: "k is dimensionless" },
    { id: "f-half", text: "half life exceeds an hour" },
  ],
  sound_claims: [{ id: "s-rate", text: "k is a rate" }],
  critique: "k is dimensionless is wrong",
};

afterEach(() => { vi.restoreAllMocks(); });

describe("StubAuditJudge (offline)", () => {
  it("catches a flaw by keyword but NEVER reports a wrongly-flagged sound claim (boundary held offline)", async () => {
    const r = await new StubAuditJudge().judge(input);
    expect(r.caught_flaw_ids).toContain("f-unit");
    expect(r.wrongly_flagged_sound_ids).toEqual([]);
  });
});

describe("HttpLlmAuditJudge (live, OpenAI-compatible)", () => {
  it("parses the model verdict and GUARDS ids against hallucination", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ caught_flaw_ids: ["f-unit", "f-GHOST"], wrongly_flagged_sound_ids: ["s-rate", "s-NOPE"] }) } }],
    }), { status: 200 }));
    const r = await new HttpLlmAuditJudge("http://x", { apiKey: "k", model: "m" }).judge(input);
    expect(r.caught_flaw_ids).toEqual(["f-unit"]);            // f-GHOST dropped
    expect(r.wrongly_flagged_sound_ids).toEqual(["s-rate"]);  // s-NOPE dropped
  });

  it("tolerates a ```json fenced reply", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "```json\n{\"caught_flaw_ids\":[\"f-half\"],\"wrongly_flagged_sound_ids\":[]}\n```" } }],
    }), { status: 200 }));
    const r = await new HttpLlmAuditJudge("http://x").judge(input);
    expect(r.caught_flaw_ids).toEqual(["f-half"]);
  });

  it("degrades to the keyword fallback on a non-200 (never fabricates over-distrust)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const r = await new HttpLlmAuditJudge("http://x").judge(input);
    expect(r.caught_flaw_ids).toContain("f-unit"); // keyword fallback caught it
    expect(r.wrongly_flagged_sound_ids).toEqual([]);
  });

  it("degrades on malformed JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "not json at all" } }],
    }), { status: 200 }));
    const r = await new HttpLlmAuditJudge("http://x").judge(input);
    expect(r.wrongly_flagged_sound_ids).toEqual([]);
  });
});

// RT-1: a judgement says how it was reached, so a keyword catch is never shown to the learner as a
// measured count ("1/2 planted flaws found") — the stub and every degradation say "keyword".
describe("AuditJudgement provenance", () => {
  it("the stub says keyword", async () => {
    expect((await new StubAuditJudge().judge(input)).source).toBe("keyword");
  });

  it("the HTTP judge says llm when the model's verdict parsed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ caught_flaw_ids: ["f-unit"], wrongly_flagged_sound_ids: [] }) } }],
    }), { status: 200 }));
    expect((await new HttpLlmAuditJudge("http://x").judge(input)).source).toBe("llm");
  });

  it("the HTTP judge says keyword when it degraded (non-200, malformed reply)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect((await new HttpLlmAuditJudge("http://x").judge(input)).source).toBe("keyword");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "not json at all" } }],
    }), { status: 200 }));
    expect((await new HttpLlmAuditJudge("http://x").judge(input)).source).toBe("keyword");
  });
});
