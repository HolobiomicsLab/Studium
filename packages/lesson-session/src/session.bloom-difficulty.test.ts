// packages/lesson-session/src/session.bloom-difficulty.test.ts
// M1 end-to-end: the session looks up the scene concept's bloom_level_target from
// bundle.concepts (by concept_refs[0]) and threads it to grade(), so the IRT weight `w`
// that reaches beta-updater is Bloom-derived. A higher-Bloom concept therefore earns
// LESS alpha per correct answer than an `understand` concept (w larger -> (1-w)+1 smaller).
import { describe, it, expect } from "vitest";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import type { BloomLevel } from "@studium/lesson-bundle-schema";

function quiz(id: string, conceptRef: string) {
  return { id, type: "quiz", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
}

function singleConceptBundle(bloom: BloomLevel | undefined): LessonBundle {
  const concept = bloom === undefined
    ? { id: "c", title: "C", description: "d" }                // no bloom_level_target -> fallback path
    : { id: "c", title: "C", description: "d", bloom_level_target: bloom };
  return { schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [concept],
    scenes: [quiz("q1", "c")], rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z" } as unknown as LessonBundle;
}

async function alphaAfterOneCorrect(bloom: BloomLevel | undefined): Promise<number> {
  const s = new LessonSession(singleConceptBundle(bloom), buildTestDeps());
  await s.start();
  await s.respond({ kind: "quiz_choice", choiceId: "b" }); // correct on concept c
  return s.getState().concept_states["c"]!.alpha;
}

describe("M1 — session threads scene-concept Bloom into the learner model", () => {
  it("a higher-Bloom concept (analyze) earns LESS alpha per correct than understand", async () => {
    const understandAlpha = await alphaAfterOneCorrect("understand");
    const analyzeAlpha = await alphaAfterOneCorrect("analyze");
    expect(analyzeAlpha).toBeLessThan(understandAlpha);
  });

  it("understand reproduces the legacy alpha (w=0.5 -> +1.5 on alpha=1 -> 2.5)", async () => {
    expect(await alphaAfterOneCorrect("understand")).toBeCloseTo(2.5, 6);
  });

  it("absent bloom_level_target falls back to the legacy 0.5 (identical to understand)", async () => {
    const noBloom = await alphaAfterOneCorrect(undefined);
    const understand = await alphaAfterOneCorrect("understand");
    expect(noBloom).toBeCloseTo(understand, 6);
  });
});
