import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryTelemetrySink } from "./testing.js";

// quiz scene factory (concept c1) with choice "a" wrong, "b" correct
function quizScene(id: string) {
  return { id, type: "quiz", title: "Q", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
}

const replayRule = { id: "rule_2err", when: { consecutive_errors_same_concept: ">=2" }, action: { kind: "replay_current_scene", reason: "errors_threshold" }, modulator: "M1", explanation_short: "revoir" };

function bundleWith(scenes: unknown[], rules: unknown[]): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }, { id: "c2", title: "C2", description: "d", bloom_level_target: "understand" }],
    scenes, rules, validated_by: "teacher", validated_at: "2026-05-08T10:00:00Z",
  } as unknown as LessonBundle;
}

describe("LessonSession.respond — adaptation branches", () => {
  it("2 consecutive wrong answers → replay_current_scene + adaptation_applied emitted", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundleWith([quizScene("q1"), quizScene("q2")], [replayRule]), deps);
    await s.start();
    await s.respond({ kind: "quiz_choice", choiceId: "a" });          // 1st error
    const t = await s.respond({ kind: "quiz_choice", choiceId: "a" }); // 2nd error → replay
    expect(t.kind).toBe("replay");
    // After 1st error at q1 (consecutive_errors=1 → advance_to_next_scene), session advances to q2.
    // 2nd error at q2 brings consecutive_errors_same_concept to 2 → replay fires at q2.
    // Deviation from plan: plan comment says "stays on q1" but the engine advances between errors.
    if (t.kind === "replay") expect(t.presentation.scene.id).toBe("q2");
    const sink = deps.telemetry as InMemoryTelemetrySink;
    const applied = sink.events.filter((e) => e.type === "adaptation_applied");
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied.at(-1)).toMatchObject({ rule_id: "rule_2err", modulator: "M1" });
  });
});
