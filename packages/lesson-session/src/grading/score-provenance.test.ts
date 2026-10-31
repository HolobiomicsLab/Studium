// packages/lesson-session/src/grading/score-provenance.test.ts
//
// A DEGRADED GRADE MUST SAY SO. `HttpCritiqueEvaluator` catches ANY failure — service down,
// 500, unparseable body — and returns the substring-matcher fallback in the same shape as a real
// evaluation. That is a deliberate design (spec §8.3), but it was SILENT: the grader, the
// telemetry and the dashboard received a number with no way to tell which of the two produced
// it, so a keyword-graded cohort and an LLM-graded one arrived indistinguishable. The teacher
// has no other surface — `events.ts:96` forbids transmitting the learner's text — so if the
// provenance is not on the event, it exists nowhere.
//
// These tests pin the tag end to end: the adapters state their source, and every free-text
// grader carries it onto `critique_submitted`. What the keyword path is WORTH is INT-STUDIUM-035
// and is the owner's decision; this is only the part that makes it visible.
import { describe, it, expect } from "vitest";
import { grade } from "./graders";
import { HttpCritiqueEvaluator, StubCritiqueEvaluator } from "../adapters/critique-evaluator";
import { buildTestDeps } from "../testing";
import type { Scene } from "@studium/lesson-bundle-schema";
import type { CritiqueEvaluator, CritiqueEvaluation } from "../ports";

const claims = [{ id: "c1", text: "n=3 suffit", flaws_expected: ["echantillon"] }];
const rubric = { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 };

const critiqueScene = {
  id: "s-crit", type: "ai_critique", title: "T", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [], claims, rubric,
} as unknown as Extract<Scene, { type: "ai_critique" }>;

const explainScene = {
  id: "s-exp", type: "explain_back", title: "T", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [], prompt: "explique",
  key_points: [{ id: "k1", text: "le plan nodal", cues: ["nodal"] }], rubric,
} as unknown as Extract<Scene, { type: "explain_back" }>;

/** An evaluator that answers like a live one. */
class LlmLike implements CritiqueEvaluator {
  async evaluate(): Promise<CritiqueEvaluation> {
    return { score: 0.9, feedback: "[live]", source: "llm" };
  }
}

function sourceOf(telemetry: readonly unknown[]): unknown {
  const ev = telemetry.find((e) => (e as { type: string }).type === "critique_submitted");
  return (ev as { score_source?: unknown }).score_source;
}

describe("the adapters state where a score came from", () => {
  it("the offline stub is keyword-graded and says so", async () => {
    const r = await new StubCritiqueEvaluator().evaluate({ claims, rubric, critique: "echantillon trop petit" });
    expect(r.source).toBe("keyword");
  });

  it("a real evaluator response is tagged llm", async () => {
    const fetchOk = async () => new Response(JSON.stringify({ score: 0.75, feedback: "ok" }), { status: 200 });
    const original = globalThis.fetch;
    globalThis.fetch = fetchOk as unknown as typeof fetch;
    try {
      const r = await new HttpCritiqueEvaluator("http://x/eval").evaluate({ claims, rubric, critique: "x" });
      expect(r).toMatchObject({ score: 0.75, source: "llm" });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("the silent fallback is no longer silent — an unreachable service grades by keyword, tagged", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    try {
      const r = await new HttpCritiqueEvaluator("http://x/eval").evaluate({ claims, rubric, critique: "echantillon" });
      expect(r.source).toBe("keyword");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("an HTTP error degrades the same way, and is tagged the same way", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    try {
      const r = await new HttpCritiqueEvaluator("http://x/eval").evaluate({ claims, rubric, critique: "echantillon" });
      expect(r.source).toBe("keyword");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("the graders carry the tag onto the telemetry", () => {
  it("ai_critique: offline → keyword", async () => {
    const deps = { ...buildTestDeps(), critiqueEvaluator: new StubCritiqueEvaluator() };
    const out = await grade(critiqueScene, { kind: "critique", text: "echantillon trop petit" }, deps);
    expect(sourceOf(out.telemetry)).toBe("keyword");
  });

  it("ai_critique: live → llm, on the same scene and the same answer", async () => {
    const deps = { ...buildTestDeps(), critiqueEvaluator: new LlmLike() };
    const out = await grade(critiqueScene, { kind: "critique", text: "echantillon trop petit" }, deps);
    expect(sourceOf(out.telemetry)).toBe("llm");
  });

  it("explain_back carries it too — every free-text grader, not just the first", async () => {
    const deps = { ...buildTestDeps(), critiqueEvaluator: new StubCritiqueEvaluator() };
    const out = await grade(explainScene, { kind: "explanation", text: "il y a un plan nodal" }, deps);
    expect(sourceOf(out.telemetry)).toBe("keyword");
  });

  it("an evaluator that does not say leaves the field ABSENT rather than guessing", async () => {
    // buildTestDeps' double returns no `source`. Unknown provenance must stay unknown: defaulting
    // it to "llm" would invent a claim, and to "keyword" would libel a live run.
    const out = await grade(critiqueScene, { kind: "critique", text: "echantillon" }, buildTestDeps());
    const ev = out.telemetry.find((e) => (e as { type: string }).type === "critique_submitted");
    expect("score_source" in (ev as object)).toBe(false);
  });
});
