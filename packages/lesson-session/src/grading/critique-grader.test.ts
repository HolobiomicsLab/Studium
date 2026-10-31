// packages/lesson-session/src/grading/critique-grader.test.ts
import { describe, it, expect } from "vitest";
import type { Scene } from "@studium/lesson-bundle-schema";
import { grade } from "./index.js";
import type { CritiqueEvaluator } from "../ports.js";

const scene: Extract<Scene, { type: "ai_critique" }> = {
  id: "crit1", type: "ai_critique", title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [],
  claims: [{ id: "claim_a", text: "n=3 proves it", flaws_expected: ["small_sample"] }],
  rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 },
};

// These doubles stand in for a WIRED evaluator: a semantic 0.8 / 0.3 on this answer is a judgement
// only a live one can make, and since INT-STUDIUM-035 candidate 2 only a live one certifies. They
// therefore declare `source: "llm"`, as the real adapter does — a double that omitted it would be
// standing in for something the boundary cannot produce.
const passEvaluator: CritiqueEvaluator = { async evaluate() { return { score: 0.8, feedback: "good", source: "llm" as const }; } };
const failEvaluator: CritiqueEvaluator = { async evaluate() { return { score: 0.3, feedback: "weak", source: "llm" as const }; } };
// …and one that grades the way the OFFLINE path does.
const keywordEvaluator: CritiqueEvaluator = { async evaluate() { return { score: 0.8, feedback: "[stub]", source: "keyword" as const }; } };

describe("ai_critique grader", () => {
  it("score>=0.6 → correct:true; emits critique_submitted + ai_audit_result", async () => {
    const r = await grade(scene, { kind: "critique", text: "claim_a relies on a small sample" }, { critiqueEvaluator: passEvaluator });
    expect(r.signal).toMatchObject({ kind: "answer_submitted", correct: true, difficulty: 0.7 });
    const types = r.telemetry.map((e) => e.type);
    expect(types).toEqual(["critique_submitted", "ai_audit_result"]);
    expect(r.telemetry[0]).toMatchObject({ scene_type: "ai_critique", llm_score: 0.8, completion_rate: 1 }); // claim_a mentioned → 1/1
    expect(r.telemetry[1]).toMatchObject({ planted_errors: 1, true_positives: 1, missed: 0 });
  });
  it("score<0.6 → correct:false", async () => {
    const r = await grade(scene, { kind: "critique", text: "no flaws here" }, { critiqueEvaluator: failEvaluator });
    expect(r.signal).toMatchObject({ correct: false });
    expect(r.telemetry[1]).toMatchObject({ true_positives: 0, missed: 1 });
  });
  it("the SAME passing score from the keyword path certifies nothing, and still reports coverage", async () => {
    // INT-STUDIUM-035 candidate 2. Everything the teacher reads is unchanged; the mastery claim is gone.
    const r = await grade(scene, { kind: "critique", text: "claim_a relies on a small sample" }, { critiqueEvaluator: keywordEvaluator });
    expect("correct" in r.signal).toBe(false);
    expect(r.telemetry[0]).toMatchObject({ llm_score: 0.8, completion_rate: 1, score_source: "keyword" });
    expect(r.telemetry[1]).toMatchObject({ planted_errors: 1, true_positives: 1, missed: 0 });
  });
});
