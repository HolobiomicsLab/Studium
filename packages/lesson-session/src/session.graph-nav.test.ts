import { describe, it, expect } from "vitest";
import { LessonSession } from "./session";
import { buildTestDeps } from "./testing";
import { InMemoryTelemetrySink } from "./adapters/in-memory";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

function quiz(id: string, conceptRef: string) {
  return { id, type: "quiz", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
}

const LWG = {
  schema_version: "1.0", course_id: "c",
  nodes: [
    { id: "concept:fourier", node_kind: "concept", title: "Fourier", bloom_level: "understand" },
    { id: "concept:fft", node_kind: "concept", title: "FFT", bloom_level: "apply" },
  ],
  edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:fft", target: "concept:fourier" }],
};

function bundle(withGraph: boolean): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [
      { id: "fourier", title: "Fourier", description: "d", bloom_level_target: "understand" },
      { id: "fft", title: "FFT", description: "d", bloom_level_target: "apply" },
    ],
    scenes: [quiz("q-fourier", "fourier"), quiz("q-fft", "fft")],
    rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
    ...(withGraph ? { learning_workflow_graph: LWG } : {}),
  } as unknown as LessonBundle;
}

describe("LessonSession — graph-aware navigation", () => {
  it("routes to the unmet prerequisite when advancing into a locked concept", async () => {
    const s = new LessonSession(bundle(true), buildTestDeps());
    await s.start();
    const t = await s.respond({ kind: "quiz_choice", choiceId: "a" }); // wrong on fourier
    expect(t.kind).toBe("next");
    expect((t as any).presentation.scene.id).toBe("q-fourier"); // remediated back to the prereq
  });

  it("no LWG → linear advance unchanged (backward compatible)", async () => {
    const s = new LessonSession(bundle(false), buildTestDeps());
    await s.start();
    const t = await s.respond({ kind: "quiz_choice", choiceId: "a" });
    expect(t.kind).toBe("next");
    expect((t as any).presentation.scene.id).toBe("q-fft"); // linear advance
  });

  it("advances past the prerequisite once mastered", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundle(true), deps);
    await s.start();
    let last: any;
    for (let i = 0; i < 8 && (last?.kind ?? "next") !== "complete"; i++) {
      last = await s.respond({ kind: "quiz_choice", choiceId: "b" }); // correct on whichever scene
    }
    // q-fft must have been entered at least once across the run (fourier eventually mastered)
    const sink = (deps.telemetry as InMemoryTelemetrySink);
    const entered = sink.events.filter((e: any) => e.type === "scene_entered").map((e: any) => e.scene_id);
    expect(entered).toContain("q-fft");
  });
});
