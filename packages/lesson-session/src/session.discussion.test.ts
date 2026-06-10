import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryTelemetrySink, StubReasoningScorer } from "./testing.js";

function discussionBundle(): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "analyze" }],
    scenes: [
      { id: "d0", type: "discussion", title: "Debate", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], topic: "noise vs signal", seed_claim: "X causes Y", target_signals: ["justification"], max_turns: 2 },
      { id: "s1", type: "concept", title: "C", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "b" },
    ],
    rules: [], validated_by: "teacher", validated_at: "2026-05-08T10:00:00Z",
  } as unknown as LessonBundle;
}

describe("LessonSession.submitTurn", () => {
  it("emits one reasoning_signal per scored turn, with incrementing turn_index", async () => {
    const scorer = new StubReasoningScorer({ signal: "justification", confidence: 0.9 });
    const deps = buildTestDeps({ reasoningScorer: scorer });
    const s = new LessonSession(discussionBundle(), deps);
    await s.start();
    await s.submitTurn("because the data shows X");
    await s.submitTurn("and Y follows from it");
    const sink = deps.telemetry as InMemoryTelemetrySink;
    const sigs = sink.events.filter((e) => e.type === "reasoning_signal");
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toMatchObject({ scene_id: "d0", signal: "justification", confidence: 0.9, turn_index: 0 });
    expect(sigs[1]).toMatchObject({ turn_index: 1 });
    expect(scorer.calls).toHaveLength(2);
  });
  it("does not exceed max_turns", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(discussionBundle(), deps);
    await s.start();
    await s.submitTurn("t1"); await s.submitTurn("t2"); await s.submitTurn("t3"); // 3rd ignored (max 2)
    const sink = deps.telemetry as InMemoryTelemetrySink;
    expect(sink.events.filter((e) => e.type === "reasoning_signal")).toHaveLength(2);
  });
  it("scorer returning null emits nothing", async () => {
    const deps = buildTestDeps({ reasoningScorer: new StubReasoningScorer(null) });
    const s = new LessonSession(discussionBundle(), deps);
    await s.start();
    await s.submitTurn("weak turn");
    const sink = deps.telemetry as InMemoryTelemetrySink;
    expect(sink.events.filter((e) => e.type === "reasoning_signal")).toHaveLength(0);
  });
});
