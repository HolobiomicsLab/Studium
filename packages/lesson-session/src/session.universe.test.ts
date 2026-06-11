import { describe, it, expect } from "vitest";
import { LessonSession } from "./session";
import { buildTestDeps } from "./testing";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

function quiz(id: string, c: string) {
  return { id, type: "quiz", title: id, objective_refs: [c], concept_refs: [c], estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
}
const LWG = { schema_version: "1.0", course_id: "c",
  nodes: [{ id: "concept:fourier", node_kind: "concept", title: "F", bloom_level: "understand" },
          { id: "concept:fft", node_kind: "concept", title: "FFT", bloom_level: "apply" }],
  edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:fft", target: "concept:fourier" }] };

function bundle(active: string): LessonBundle {
  return { schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "fourier", title: "F", description: "d", bloom_level_target: "understand" },
               { id: "fft", title: "FFT", description: "d", bloom_level_target: "apply" }],
    scenes: [quiz("q-fourier", "fourier"), quiz("q-fft", "fft")],
    rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
    learning_workflow_graph: LWG,
    universes: { variants: [
      { id: "baseline", description: "d", decisions: { prereq_strictness: "standard" } },
      { id: "remedial", description: "d", decisions: { prereq_strictness: "lenient" } },
    ], active },
  } as unknown as LessonBundle;
}

describe("LessonSession — universe-driven theta", () => {
  it("emits universe_selected with the active variant's decisions", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundle("remedial"), deps);
    await s.start();
    const sink: any = deps.telemetry;
    const ev = (sink.events ?? []).find((e: any) => e.type === "universe_selected");
    expect(ev?.universe_id).toBe("remedial");
    expect(ev?.active_decisions?.prereq_strictness).toBe("lenient");
  });

  it("remedial universe (theta 0.6) unlocks the dependent earlier than baseline (theta 0.8)", async () => {
    // Mastery math: initial alpha=1, beta=1 -> mastery=0.5
    // After 1 correct (difficulty=0.5): alpha += (1-0.5)+1 = 1.5 -> alpha=2.5, beta=1 -> mastery=2.5/3.5 ≈ 0.714
    // 0.714 >= 0.6 (remedial theta) but < 0.8 (baseline theta)
    // Baseline: concept:fourier mastery ~0.714 < 0.8 -> concept:fft still locked -> routed back to q-fourier (index 0)
    // Remedial: concept:fourier mastery ~0.714 >= 0.6 -> concept:fft unlocked -> advance to q-fft (index 1)
    const sB = new LessonSession(bundle("baseline"), buildTestDeps());
    await sB.start();
    const tB = await sB.respond({ kind: "quiz_choice", choiceId: "b" }); // correct on fourier (~0.714)
    expect((tB as any).presentation.scene.id).toBe("q-fourier"); // baseline: fft still locked -> remediate to fourier

    const sR = new LessonSession(bundle("remedial"), buildTestDeps());
    await sR.start();
    const tR = await sR.respond({ kind: "quiz_choice", choiceId: "b" }); // correct on fourier (~0.714)
    expect((tR as any).presentation.scene.id).toBe("q-fft");      // remedial: 0.714 >= 0.6 -> fft unlocked
  });
});
