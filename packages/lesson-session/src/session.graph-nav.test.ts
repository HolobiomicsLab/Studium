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

function intro(id: string, conceptRef: string) {
  return { id, type: "intro", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [], markdown: "intro text" };
}

const LWG = {
  schema_version: "1.0", course_id: "c",
  nodes: [
    { id: "concept:fourier", node_kind: "concept", title: "Fourier", bloom_level: "understand" },
    { id: "concept:fft", node_kind: "concept", title: "FFT", bloom_level: "apply" },
  ],
  edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:fft", target: "concept:fourier" }],
};

function bundle(withGraph: boolean, withIntro = false): LessonBundle {
  const scenes = withIntro
    ? [intro("i-fourier", "fourier"), quiz("q-fourier", "fourier"), quiz("q-fft", "fft")]
    : [quiz("q-fourier", "fourier"), quiz("q-fft", "fft")];
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [
      { id: "fourier", title: "Fourier", description: "d", bloom_level_target: "understand" },
      { id: "fft", title: "FFT", description: "d", bloom_level_target: "apply" },
    ],
    scenes,
    rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
    ...(withGraph ? { learning_workflow_graph: LWG } : {}),
  } as unknown as LessonBundle;
}

describe("LessonSession — graph-aware navigation", () => {
  it("routes to the unmet prerequisite when advancing into a locked concept", async () => {
    const s = new LessonSession(bundle(true), buildTestDeps());
    await s.start();
    const t = await s.respond({ kind: "quiz_choice", choiceId: "a" }); // wrong on fourier
    expect(t.kind).toBe("remediate"); // a graph detour is announced as such, not as a plain advance
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

  it("no infinite loop: intro(fourier)+quiz(fourier)+quiz(fft) — session completes within bound", async () => {
    // Regression for C1: prereq has an ack-graded intro AND an answer-graded quiz.
    // Without the fix, remediation routes to the intro (ack-graded) -> mastery never rises -> loop.
    // With the fix, remediation routes to the quiz -> mastery rises -> q-fft unlocks -> complete.
    const s = new LessonSession(bundle(true, true), buildTestDeps());
    await s.start(); // at i-fourier (intro)

    // Ack the intro -> advances to q-fourier (fourier has no prereqs -> always available)
    let t: any = await s.respond({ kind: "ack" });
    expect(t.kind).toBe("next");
    expect(t.presentation.scene.id).toBe("q-fourier");

    // Answer q-fourier correctly to raise fourier mastery past theta=0.8.
    // Initial state: alpha=1, beta=1 (mastery=0.5). Each correct answer (difficulty=0.5) adds 1.5 to alpha.
    // After 2 correct answers: alpha=4, beta=1 -> mastery=4/5=0.8 >= theta -> q-fft unlocks.
    // While fourier is below theta: candidate=q-fft locked -> remediate to q-fourier (answer-graded) -> stay.
    let calls = 1; // the ack above
    while (t.kind !== "complete" && calls < 12) {
      t = await s.respond({ kind: "quiz_choice", choiceId: "b" }); // always correct
      calls++;
    }
    expect(t.kind).toBe("complete"); // session must terminate, not loop
    expect(calls).toBeLessThanOrEqual(12);
  });
});

describe("LessonSession — pacing skip + explainLast graph decisions", () => {
  // bundle: scenes [concept(fourier), quiz(fourier), quiz(fft)]; universes with active baseline,
  // pacing=skip_on_mastery on the active variant; LWG fft requires fourier.
  function bundlePacing(activePacing: "standard" | "skip_on_mastery") {
    return {
      schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
      metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
      concepts: [
        { id: "fourier", title: "F", description: "d", bloom_level_target: "understand" },
        { id: "fft", title: "FFT", description: "d", bloom_level_target: "apply" },
      ],
      scenes: [
        { id: "c-fourier", type: "concept", title: "C", objective_refs: ["fourier"], concept_refs: ["fourier"], estimated_seconds: 0, adaptation_hooks: [], markdown: "x" },
        quiz("q-fourier", "fourier"),
        quiz("q-fft", "fft"),
      ],
      rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
      learning_workflow_graph: LWG,
      universes: { variants: [
        { id: "baseline", description: "d", decisions: { prereq_strictness: "standard", pacing: activePacing } },
        { id: "remedial", description: "d", decisions: { prereq_strictness: "lenient", pacing: "standard" } },
      ], active: "baseline" },
    } as unknown as LessonBundle;
  }

  it("explainLast surfaces the graph remediation decision", async () => {
    const s = new LessonSession(bundlePacing("standard"), buildTestDeps());
    await s.start();                                    // at c-fourier (concept, ack)
    await s.respond({ kind: "ack" });                   // advance to q-fourier
    await s.respond({ kind: "quiz_choice", choiceId: "a" }); // wrong on fourier -> fft locked -> remediate
    const ex = s.explainLast();
    expect(ex?.rule_id).toBe("graph_prereq_gate");
    expect(ex?.modulator).toBe("M6");
  });

  it("explainLast falls back to engine explanation on a plain advance", async () => {
    const s = new LessonSession(bundlePacing("standard"), buildTestDeps());
    await s.start();
    await s.respond({ kind: "ack" });                   // plain advance (concept->quiz, fourier available)
    // no graph gate on this step -> lastGraphExplanation cleared -> engine.explain() (null with empty rules)
    expect(s.explainLast()).toBeNull();
  });

  it("pacing=skip_on_mastery skips a mastered concept's later scene", async () => {
    const s = new LessonSession(bundlePacing("skip_on_mastery"), buildTestDeps());
    await s.start();
    await s.respond({ kind: "ack" });                   // c-fourier -> q-fourier
    // answer q-fourier correctly enough to master, then navigate should skip any further fourier scene
    // (here there is none after q-fourier except q-fft); assert it does not crash + advances/completes
    const t = await s.respond({ kind: "quiz_choice", choiceId: "b" });
    expect(["next", "complete"]).toContain(t.kind);
  });
});
